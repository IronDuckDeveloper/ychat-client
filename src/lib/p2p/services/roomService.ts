import type { Helia } from 'helia';
import type { Libp2p, PeerId } from '@libp2p/interface';
import { getOrbitDB } from '../orbit/client.ts';
import { CONFIG } from '../config.ts';
import { notifyArchivist, checkAndSyncRelays } from '../networking/connectionManager.ts';
import { relayManager } from '../networking/heliaClient.ts';
import { RateLimitedAccessController } from '../orbit/rateLimitedAccessController.ts';
import { type FileAttachment } from './fileService.ts';
import { isHiddenLocally, hideMessageLocally } from './hiddenMessagesService.ts';
import { acquireShared, releaseShared, createDocCache, trackClose, waitClosed, type DocCache } from './periodDb.ts';

export type MessageType = 'sent' | 'received' | 'system';

export interface ReplyInfo {
  id: string;
  text?: string;
  attachmentName?: string;
  attachmentMime?: string;
  attachment?: FileAttachment;
  whoSent?: string;
  senderName?: string;
  forwardedFrom?: ForwardedFrom;
}

export interface ForwardedFrom {
    senderId: string;
    senderName: string;
}

export interface ChatMessage {
  id: string;
  whoSent: string;
  text: string;
  type: MessageType;
  ts: number;
  attachment?: FileAttachment;
  hidden?: boolean;
  replyTo?: ReplyInfo;
  forwardedFrom?: ForwardedFrom;
}

// Строит денормализованный снимок сообщения для "Ответить"/"Переслать".
// Важно: не присваивать полям undefined — IPLD (dag-cbor), в отличие от
// JSON.stringify, не дропает такие ключи молча, а роняет db.put() с ошибкой
// "`undefined` is not supported by the IPLD Data Model". Поэтому добавляем
// поле только тогда, когда значение реально есть.
export const buildReplyInfo = (message: {
  id: string;
  text?: string;
  attachment?: FileAttachment;
  whoSent?: string;
  senderName?: string;
  forwardedFrom?: ForwardedFrom;
}): ReplyInfo => {
  const info: ReplyInfo = { id: message.id };
  
  if (message.text) info.text = message.text;
  if (message.attachment?.name) info.attachmentName = message.attachment.name;
  if (message.attachment?.type) info.attachmentMime = message.attachment.type;
  if (message.attachment) info.attachment = message.attachment;
  
  // 🔥 Сохраняем данные об отправителе для пересылки
  if (message.whoSent) info.whoSent = message.whoSent;
  if ((message as any).senderName) info.senderName = (message as any).senderName;
  if (message.forwardedFrom) info.forwardedFrom = message.forwardedFrom;

  return info;
};

export interface RoomActions {
  sendMessage: (
    text: string, 
    attachment?: FileAttachment, 
    hidden?: boolean, 
    replyTo?: ReplyInfo,
    forwardedFrom?: { senderId: string; senderName: string }
  ) => Promise<void>;
  tombstoneMessage: (msgId: string) => Promise<void>;
  deleteMessageLocally: (msgId: string) => void;
  leaveRoom: () => void;
  pingRoom?: () => void;
  dbAddress: string;
  loadMoreHistory: () => Promise<void>;
  hasMoreHistory: () => boolean;
}

const roomSessions = new Map<string, {
  promise: Promise<any>;
  refCount: number;
  instance: any | null;
}>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DAY_MS = 86_400_000;
/** Месячный период 1:1 по UTC: 'YYYYMM'. */
export const monthOf = (ts: number): string => new Date(ts).toISOString().slice(0, 7).replace('-', '');

export const isRoomInUse = (roomName: string) =>
  (roomSessions.get(roomName)?.refCount ?? 0) > 0;

/** Документ индекса месяцев в базовой БД комнаты (не сообщение). */
export const isMonthIndexDoc = (d: any): boolean =>
  typeof d?._id === 'string' && d._id.includes('_month_') && typeof d.month === 'string';

// firstMs: сколько ждать первого события; idleMs: тишина после каждого события; maxMs: жёсткий потолок
const settle = (pdb: any, firstMs: number, idleMs: number, maxMs: number) =>
  new Promise<void>((resolve) => {
    let t: ReturnType<typeof setTimeout>;
    let cap: ReturnType<typeof setTimeout>;
    const done = () => { clearTimeout(t); clearTimeout(cap); pdb.events.off('update', onUpd); resolve(); };
    const onUpd = () => { clearTimeout(t); t = setTimeout(done, idleMs); };
    pdb.events.on('update', onUpd);
    t = setTimeout(done, firstMs);
    cap = setTimeout(done, maxMs);
  });

const readTop = async (pdb: any, amount: number) => {
  const rows: any[] = [];
  for await (const e of pdb.iterator({ amount })) rows.push(e.value ?? e);
  return rows;
};

/**
 * Последние сообщения комнаты для превью в списке контактов. Идёт по месячным периодам от нового к старому
 * (текущий месяц + месяцы из индекса, не больше 3) и останавливается на первом непустом.
 * БД берутся из общего пула: если чат открыт, период остаётся у него, иначе release его закрывает.
 */
export async function readRecentFromPeriods(
  helia: Helia,
  roomName: string,
  indexMonths: string[],
  amount = 10,
): Promise<any[]> {
  const libp2p = (helia as any).libp2p as unknown as Libp2p;
  const orbitdb = await getOrbitDB(helia);
  const months = [...new Set([monthOf(Date.now()), ...indexMonths])].sort().reverse().slice(0, 3);

  for (const m of months) {
    const name = `${roomName}_${m}`;
    let pdb: any;
    try {
      pdb = await acquireShared(name, () =>
        orbitdb.open(name, {
          type: 'documents',
          docIndex: '_id',
          AccessController: RateLimitedAccessController({ write: ['*'] }),
        }),
      );
    } catch (err) {
      console.warn(`[Room] Превью: не открылся период ${m}:`, err);
      continue;
    }
    try {
      const addr = pdb.address.toString();
      libp2p.getPeers().forEach((p: PeerId) => notifyArchivist(libp2p, p, addr));
      if (m === months[0]) await settle(pdb, 2500, 1500, 6000); // текущий месяц: даём досинкаться
      let rows = await readTop(pdb, amount);
      if (rows.length === 0 && m !== months[0] && indexMonths.includes(m)) {
        await settle(pdb, 2500, 1500, 6000); // индекс говорит, что месяц непустой, а данных ещё нет
        rows = await readTop(pdb, amount);
      }
      if (rows.length > 0) return rows;
    } finally {
      releaseShared(name, pdb);
    }
  }
  return [];
}

export async function joinRoom(
  helia: Helia,
  roomName: string,
  onMessage: (message: ChatMessage, isBackgroundSync?: boolean) => void,
  relayManagerInstance?: any,
): Promise<RoomActions> {
  const libp2p = (helia as any).libp2p as unknown as Libp2p;
  const orbitdb = await getOrbitDB(helia);
  
  await waitClosed(roomName);
  let session = roomSessions.get(roomName);
  
  if (!session) {
    const openPromise = orbitdb.open(roomName, {
      type: 'documents',
      docIndex: '_id',
      AccessController: RateLimitedAccessController({
        write: ['*'],
      }),
    });
    session = { promise: openPromise, refCount: 0, instance: null };
    roomSessions.set(roomName, session);
  }

  session.refCount++;

  let db: any;
  try {
    db = await session.promise;
    session.instance = db;
  } catch (err) {
    session.refCount--;
    if (session.refCount <= 0) roomSessions.delete(roomName);
    throw err;
  }

const dbAddress = db.address.toString();

  let oldestHash: string | null = null;
  let hasMore = true;
  let disposed = false;

  // msgId -> снепшот контента, чтобы не терять и не дублировать события 'update'
  const seen = new Map<string, string>();

  // Кэш документов: db.all() декодирует весь лог (секунды на тысячах записей), поэтому читаем его
  // целиком только при открытии и когда в событии виден пропуск; обычные обновления берём из самого события.
  const cache = new Map<string, any>();
  const known = new Set<string>();
  let sortedDesc: any[] | null = null;
  let windowStartTs = 0; // ts самого старого загруженного сообщения; старее показываем только при прокрутке вверх
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let lastReloadMs = 0;
  let lastReloadAt = 0;

    // ---------- суточные периоды ----------
  // Базовая БД = архив старых сообщений + индекс дней; новые сообщения лежат в `${roomName}_${day}`
  const myId: string = orbitdb.identity.id;
  type Period = { name: string; db: any; cache: DocCache };
  const isIndexDoc = isMonthIndexDoc;
  const indexMonths = new Set<string>();   // месяцы из индекса (любого участника)
  const myIndexMonths = new Set<string>(); // месяцы, которые в индекс записал я
  const addresses = new Set<string>([dbAddress]);
  const periods = new Map<string, Period>();
  const periodPromises = new Map<string, Promise<Period>>();
  let ready = false;
  let mergeTimer: ReturnType<typeof setTimeout> | null = null;
  let rollTimer: ReturnType<typeof setInterval> | null = null;
  const chunkSize = CONFIG.CHUNK_SIZE || 15;

  const addIndexDoc = (d: any): boolean => {
    const isNew = !indexMonths.has(d.month);
    indexMonths.add(d.month);
    if (d.whoSent === myId) myIndexMonths.add(d.month);
    return isNew;
  };

  const hasUnopened = () => [...indexMonths].some((m) => !periods.has(m));

  const announceAddr = (addr: string) => libp2p.getPeers().forEach((p: PeerId) => notifyArchivist(libp2p, p, addr));
  const announceAll = () => {
    if (relayManagerInstance && typeof relayManagerInstance.announceRoom === 'function') {
      addresses.forEach((a) => relayManagerInstance.announceRoom(a));
    }
  };

  // обязательные периоды: текущий месяц и, в последние сутки месяца, следующий
  const isRequired = (m: string) => m === monthOf(Date.now()) || m === monthOf(Date.now() + DAY_MS);
  const monthsDesc = () =>
    [...new Set([monthOf(Date.now()), monthOf(Date.now() + DAY_MS), ...indexMonths])].sort().reverse();

  const scheduleMerge = () => {
    if (mergeTimer || disposed) return;
    mergeTimer = setTimeout(() => {
      mergeTimer = null;
      if (disposed || !ready) return;
      sortedDesc = null;
      const batch: any[] = [];
      for (const d of getSorted()) {
        if ((d.ts || 0) < windowStartTs) break;
        batch.push(d);
      }
      batch.reverse().forEach((d) => emitIfChanged(d, false));
    }, 80);
  };

  const ensurePeriod = (month: string): Promise<Period> => {
    let p = periodPromises.get(month);
    if (!p) {
      p = (async () => {
        const name = `${roomName}_${month}`;
        const pdb = await acquireShared(name, () =>
          orbitdb.open(name, {
            type: 'documents',
            docIndex: '_id',
            AccessController: RateLimitedAccessController({ write: ['*'] }),
          }),
        );
        const pcache = createDocCache(pdb, scheduleMerge);
        try {
          await pcache.init();
        } catch (e) {
          pcache.dispose();
          releaseShared(name, pdb);
          throw e;
        }
        if (disposed) {
          pcache.dispose();
          releaseShared(name, pdb);
          throw new Error('disposed');
        }
        const addr = pdb.address.toString();
        addresses.add(addr);
        announceAddr(addr);
        const entry: Period = { name, db: pdb, cache: pcache };
        periods.set(month, entry);
        sortedDesc = null;
        return entry;
      })();
      periodPromises.set(month, p);
      p.catch(() => periodPromises.delete(month));
    }
    return p;
  };

  // Открывает сегодня и завтра всегда, остальные от новых к старым, пока не наберётся need сообщений
  const ensureEnough = async (need: number) => {
    for (const m of monthsDesc()) {
      if (disposed) return;
      if (periods.has(m)) continue;
      const required = isRequired(m);
      if (!required && getSorted().length >= need) break;
      try {
        const p = await ensurePeriod(m);
        if (!required && indexMonths.has(m)) {
          // индекс говорит, что день непустой: ждём данные до 6 с
          const t0 = Date.now();
          while (p.cache.size() === 0 && Date.now() - t0 < 6000 && !disposed) await sleep(300);
        }
      } catch (err) {
        if (!disposed) console.warn(`[Room] Не удалось открыть период ${m}:`, err);
        break;
      }
    }
  };

  // Живое обновление окна: новый день в индексе, смена суток. Старше загруженного окна не открываем
  const openLive = async () => {
    if (getSorted().length < chunkSize) {
      await loadHistoryChunk(chunkSize); // мало сообщений (индекс приехал позже): добираем страницу
      return;
    }
    const lo = windowStartTs ? monthOf(windowStartTs) : '';
    for (const m of monthsDesc()) {
      if (disposed) return;
      if (periods.has(m)) continue;
      if (!isRequired(m) && m < lo) break;
      try {
        await ensurePeriod(m);
      } catch (err) {
        if (!disposed) console.warn(`[Room] Не удалось открыть период ${m}:`, err);
        break;
      }
    }
    scheduleMerge();
  };

  let windowRun: Promise<void> | null = null;
  let windowAgain = false;
  const runWindow = (): Promise<void> => {
    if (windowRun) { windowAgain = true; return windowRun; }
    windowRun = (async () => {
      do {
        windowAgain = false;
        if (ready && !disposed) await openLive();
      } while (windowAgain && !disposed);
    })().finally(() => { windowRun = null; });
    return windowRun;
  };

  const disposePeriods = () => {
    if (mergeTimer) clearTimeout(mergeTimer);
    if (rollTimer) clearInterval(rollTimer);
    for (const p of periods.values()) {
      p.cache.dispose();
      releaseShared(p.name, p.db);
    }
    periods.clear();
  };

  const emitIfChanged = (messageData: any, isBackgroundSync: boolean) => {
    if (!messageData?._id && !messageData?.id) return;
    if (!(messageData.text || messageData.attachment || messageData.replyTo)) return;

    const msgId = messageData._id || messageData.id;
    const hiddenLocally = isHiddenLocally(msgId);
    const snapshot = JSON.stringify({
      t: hiddenLocally ? CONFIG.MSG.MESSAGE_DELETED : messageData.text,
      a: !!messageData.attachment,
      h: messageData.hidden === true,
    });

    if (seen.get(msgId) === snapshot) return;
    seen.set(msgId, snapshot);

    const isMine = messageData.whoSent === orbitdb.identity.id;

    onMessage({
      id: msgId,
      whoSent: messageData.whoSent,
      text: hiddenLocally ? CONFIG.MSG.MESSAGE_DELETED : (messageData.text || ''),
      attachment: hiddenLocally ? undefined : messageData.attachment,
      ts: messageData.ts || Date.now(),
      type: isMine ? 'sent' : 'received',
      hidden: messageData.hidden === true,
      replyTo: hiddenLocally ? undefined : messageData.replyTo,
      forwardedFrom: hiddenLocally ? undefined : messageData.forwardedFrom,
    }, isBackgroundSync);
  };

  // Возвращает документы, которых в кэше ещё не было
  const fullReload = async (): Promise<any[]> => {
    const t0 = performance.now();
    const rows: any[] = await db.all();
    const added: any[] = [];
    for (const r of rows) {
      const d = r?.value ?? r;
      const id = d?._id || d?.id;
      if (typeof id !== 'string') continue;
      if (isIndexDoc(d)) {
        addIndexDoc(d);
        if (typeof r?.hash === 'string') known.add(r.hash);
        continue;
      }
      if (!cache.has(id)) added.push(d);
      cache.set(id, d);
      if (typeof r?.hash === 'string') known.add(r.hash);
    }
    sortedDesc = null;
    lastReloadMs = performance.now() - t0;
    return added;
  };

  const getSorted = () => {
    if (sortedDesc) return sortedDesc;
    const all = new Map<string, any>(cache); // старые сообщения из базовой БД
    for (const p of periods.values()) for (const d of p.cache.docs()) all.set(d._id, d);
    return (sortedDesc = [...all.values()].sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)));
  };

  const loadHistoryChunk = async (limit: number, beforeHash: string | null = null) => {
    const chunk: any[] = [];
    try {
      const startOf = () => {
        if (!beforeHash) return 0;
        const i = getSorted().findIndex((m: any) => (m._id || m.id) === beforeHash);
        return i !== -1 ? i + 1 : 0;
      };
      await ensureEnough(startOf() + limit);
      const startIndex = startOf();
      const page = getSorted().slice(startIndex, startIndex + limit);
      for (const doc of page) {
        chunk.push({
          hash: doc._id || doc.id,
          value: doc,
          payload: { value: doc }
        });
      }
    } catch (e) {
      console.error('❌ Ошибка чтения чанка OrbitDB:', e);
    }

    hasMore = chunk.length >= limit || hasUnopened();

    windowStartTs = hasMore && chunk.length > 0 ? (chunk[chunk.length - 1].value.ts || 0) : 0;

    if (chunk.length > 0) {
      oldestHash = chunk[chunk.length - 1].hash;

      const chronologicalChunk = [...chunk].reverse();

      for (const entry of chronologicalChunk) {
        const messageData = entry.payload?.value || entry.value;
        emitIfChanged(messageData, true);
      }
    }
  };

  // Полное чтение не чаще раза в 1,5 с и не чаще, чем раз в тройное время самого чтения (нагрузка ~25%)
  const scheduleReload = () => {
    if (reloadTimer || disposed) return;
    const wait = Math.max(100, lastReloadAt + Math.max(1500, lastReloadMs * 3) - Date.now());
    reloadTimer = setTimeout(async () => {
      reloadTimer = null;
      if (disposed) return;
      try {
        const added = await fullReload();
        lastReloadAt = Date.now();
        if (disposed) return;
        // окно загруженных сообщений (правки, tombstone) + всё новое; старее окна появится при прокрутке вверх
        const batch = new Map<string, any>();
        for (const d of getSorted()) {
          if ((d.ts || 0) < windowStartTs) break;
          batch.set(d._id || d.id, d);
        }
        for (const d of added) batch.set(d._id || d.id, d);
        [...batch.values()]
          .sort((a, b) => (a.ts || 0) - (b.ts || 0))
          .forEach((d) => emitIfChanged(d, false));
          void runWindow(); // в полном чтении мог появиться новый день индекса
      } catch (e) {
        console.error('❌ Ошибка чтения БД чата:', e);
      }
    }, wait);
  };

  const onDbUpdate = (entry?: any) => {
    if (disposed) return;
    const p = entry?.payload;
    const doc = p?.op === 'PUT' ? p.value : null;
    const id = doc?._id || doc?.id;

    if (typeof id === 'string') {
      if (typeof entry.hash === 'string') known.add(entry.hash);
      if (isIndexDoc(doc)) {
        if (addIndexDoc(doc)) void runWindow(); // новый день: открываем период
      } else {
        const isNew = !cache.has(id);
        cache.set(id, doc);
        sortedDesc = null;
        // новый документ показываем всегда; уже известный (правка, tombstone) — только если он уже был показан
        if (isNew || seen.has(id)) emitIfChanged(doc, false);
      }
    }

    // записи, которых мы не видели (пачка при синке), подбираем полным чтением
    const gap = typeof id !== 'string' || !Array.isArray(entry?.next) || entry.next.some((h: string) => !known.has(h));
    if (gap) scheduleReload();
  };

  db.events.off('update', onDbUpdate);
  db.events.on('update', onDbUpdate);

  try {
    await fullReload();
    await loadHistoryChunk(chunkSize);
    ready = true;
  } catch (err) {
    disposed = true;
    db.events.off('update', onDbUpdate);
    disposePeriods();
    const s = roomSessions.get(roomName);
    if (s && --s.refCount <= 0) roomSessions.delete(roomName);
    throw err;
  }

  const onConnect = (evt: any) => {
    const peerId = evt.detail as unknown as PeerId;

    setTimeout(() => checkAndSyncRelays(helia), 2000);

    if (relayManager.isRelay(peerId.toString())) {
      [...addresses].forEach((addr, i) => setTimeout(() => notifyArchivist(libp2p, peerId, addr), 1500 + i * 150));
    }
  };

  libp2p.addEventListener('peer:connect', onConnect);
  libp2p.getPeers().forEach((peerId: PeerId) => notifyArchivist(libp2p, peerId, dbAddress));
  rollTimer = setInterval(() => void runWindow(), 30_000); // граница суток без событий
  void runWindow();

  return {
    sendMessage: async (
      text: string, 
      attachment?: FileAttachment, 
      hidden?: boolean, 
      replyTo?: ReplyInfo, 
      forwardedFrom?: ForwardedFrom
    ) => {
      try {
        const ts = Date.now();
        const month = monthOf(ts);
        const messageObject: any = {
          _id: `msg_${myId}_${ts}_${Math.random().toString(36).substring(2, 9)}`,
          whoSent: myId,
          text,
          ts,
        };

        if (attachment) messageObject.attachment = attachment;
        if (hidden) messageObject.hidden = true;
        if (replyTo) messageObject.replyTo = replyTo;
        if (forwardedFrom) messageObject.forwardedFrom = forwardedFrom;

        const p = await ensurePeriod(month);
        await p.db.put(messageObject);
        // первое моё сообщение дня: день в индекс (он же сообщает собеседнику, что открылась новая БД)
        if (!myIndexMonths.has(month)) {
          await db.put({ _id: `msg_${myId}_month_${month}`, whoSent: myId, month, ts });
          myIndexMonths.add(month);
        }
      } catch (err: any) {
        console.error(`❌ [OrbitDB] Ошибка при записи:`, err?.message || err);
      }
    },
    leaveRoom: () => {
      disposed = true;
      if (reloadTimer) clearTimeout(reloadTimer);
      db.events.off('update', onDbUpdate);
      disposePeriods();
      libp2p.removeEventListener('peer:connect', onConnect);
      
      const currentSession = roomSessions.get(roomName);
      if (currentSession) {
        currentSession.refCount--;
        
        if (currentSession.refCount <= 0) {
          roomSessions.delete(roomName);
          if (currentSession.instance) {
            currentSession.instance.events.off('update', onDbUpdate);
            trackClose(roomName, currentSession.instance);
          }
        }
      }
    },
    tombstoneMessage: async (msgId: string) => {
      try {
        let targetDb: any = null;
        let targetDoc: any = cache.get(msgId); // старое сообщение из базовой БД
        if (targetDoc) targetDb = db;
        else {
          for (const p of periods.values()) {
            const d = p.cache.get(msgId);
            if (d) { targetDoc = d; targetDb = p.db; break; }
          }
        }
        if (targetDoc && targetDb) {
          await targetDb.put({
            ...targetDoc,
            _id: msgId,
            text: CONFIG.MSG.MESSAGE_DELETED,
            attachment: null,
            replyTo: null,
            forwardedFrom: null,
            hidden: false, 
          });
        }
      } catch (err: any) {
        console.error(`❌ [OrbitDB] Ошибка обновления сообщения:`, err?.message || err);
      }
    },
    deleteMessageLocally: (msgId: string) => {
      hideMessageLocally(msgId);
    },
    pingRoom: () => {
      announceAll();
    },
    dbAddress: dbAddress,
    
    loadMoreHistory: async () => {
      if (hasMore || hasUnopened()) {
        const size = CONFIG.CHUNK_SIZE || 15;
        await loadHistoryChunk(size, oldestHash); 
        announceAll();
      }
    },
    hasMoreHistory: () => hasMore || hasUnopened(),
  };
}

export const getDeterministicRoomName = async (nodeId: string, peerId: string) => {
  const sorted = [nodeId, peerId].sort().join('_');
  const msgBuffer = new TextEncoder().encode(sorted);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${CONFIG.PREFIX_ROOM}${hashHex}`;
};

export const clearEntireChat = async (db: any) => {
  if (!db) {
    console.error('❌ База данных не передана');
    return;
  }
  
  try {
    console.log(`🗑️ Запуск полного удаления базы: ${db.address.toString()}`);
    
    await db.drop();
    
    console.log('✅ База чата успешно и безвозвратно удалена локально');
  } catch (error) {
    console.error('❌ Ошибка при удалении базы чата:', error);
  }
};
