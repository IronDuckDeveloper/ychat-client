import type { Helia } from 'helia';
import type { Libp2p, PeerId } from '@libp2p/interface';
import { getOrbitDB } from '../orbit/client.ts';
import { GroupAccessController } from '../orbit/groupAccessController.ts';
import { notifyArchivist, checkAndSyncRelays } from '../networking/connectionManager.ts';
import { relayManager } from '../networking/heliaClient.ts';
import { CONFIG } from '../config.ts';
import { isHiddenLocally } from './hiddenMessagesService.ts';
import type { ChatMessage, ReplyInfo, ForwardedFrom } from './roomService.ts';
import type { FileAttachment } from './fileService.ts';
import {
  computeGroupState, isVisible, canWrite, roleOf, buildAct, writerSlots, MAX_WRITERS, groupContactId, dayOf, nextDayOf,
  type GroupState, type GroupRole, type GroupActType, type GroupActField,
} from './groupState.ts';

export type GroupTarget =
  | { address: string }
  | { create: { name: string; description?: string; writeMode?: 'all' | 'allowed'; members?: string[] } };

export interface GroupSnapshot {
  messages: ChatMessage[];   // видимые, новые первыми
  state: GroupState;
  hasMore: boolean;
  myRole: GroupRole | null;  // null = не участник (кикнут/забанен/не добавлен)
  canWrite: boolean;
}

export interface GroupActions {
  dbAddress: string;
  owner: string;
  myId: string;
  sendMessage: (
    text: string, attachment?: FileAttachment, hidden?: boolean,
    replyTo?: ReplyInfo, forwardedFrom?: ForwardedFrom,
  ) => Promise<boolean>;
  act: (type: GroupActType, fields?: Record<string, GroupActField>) => Promise<void>;
  deleteMessage: (msgId: string) => Promise<void>; // своё — tombstone, чужое (admin/owner) — событие del_msg
  loadMoreHistory: () => Promise<void>;
  hasMoreHistory: () => boolean;
  leaveRoom: () => void;
}

export interface JoinGroupOptions {
  messages?: boolean; // false: только управляющая БД (вступление по ссылке), периоды с сообщениями не открываются
  maxDays?: number;   // сколько прошлых дней максимум открыть (фоновый синк берёт 2)
}

const PAGE = CONFIG.CHUNK_SIZE || 15;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Общий пул БД с подсчётом ссылок: управляющая БД (ключ — адрес) и периоды (ключ — имя)
const sharedDbs = new Map<string, { promise: Promise<any>; refCount: number }>();

async function acquireShared(key: string, open: () => Promise<any>): Promise<any> {
  let s = sharedDbs.get(key);
  if (!s) {
    s = { promise: open(), refCount: 0 };
    sharedDbs.set(key, s);
  }
  s.refCount++;
  try {
    return await s.promise;
  } catch (err) {
    s.refCount--;
    if (s.refCount <= 0) sharedDbs.delete(key);
    throw err;
  }
}

function releaseShared(key: string, db: any) {
  const s = sharedDbs.get(key);
  if (s && --s.refCount <= 0) {
    sharedDbs.delete(key);
    db.close().catch(() => {});
  }
}

/**
 * Кэш документов одной БД. db.all() декодирует весь лог, поэтому читаем его целиком только при открытии
 * и когда в событии виден пропуск; обычные обновления берём из самого события.
 */
function createDocCache(db: any, onChange: () => void) {
  const cache = new Map<string, any>();
  const known = new Set<string>();
  let ready = false;
  let dirty = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastReloadMs = 0;

  const fullReload = async () => {
    const t0 = performance.now();
    const rows: any[] = await db.all();
    for (const r of rows) {
      const d = r?.value ?? r;
      if (d && typeof d._id === 'string') cache.set(d._id, d);
      if (typeof r?.hash === 'string') known.add(r.hash);
    }
    lastReloadMs = performance.now() - t0;
  };

  const scheduleReload = () => {
    if (timer || disposed) return;
    // не чаще раза в 1,5 с и не чаще, чем раз в тройное время самого чтения: нагрузка ограничена ~25%
    timer = setTimeout(async () => {
      timer = null;
      if (disposed) return;
      try { await fullReload(); } catch (err) { console.error('❌ [Group] Ошибка чтения БД:', err); }
      if (!disposed) onChange();
    }, Math.max(1500, lastReloadMs * 3));
  };

  const onUpdate = (entry: any) => {
    if (disposed) return;
    if (!ready) { dirty = true; return; }
    const p = entry?.payload;
    const doc = p?.op === 'PUT' ? p.value : null;
    if (doc && typeof doc._id === 'string') {
      cache.set(doc._id, doc);
      if (typeof entry.hash === 'string') known.add(entry.hash);
    }
    // записи, которых мы не видели (пачка при синке), подбираем полным чтением
    const gap = !doc || !Array.isArray(entry.next) || entry.next.some((h: string) => !known.has(h));
    if (gap) scheduleReload();
    onChange();
  };

  db.events.on('update', onUpdate);

  return {
    docs: () => cache.values(),
    get: (id: string) => cache.get(id),
    size: () => cache.size,
    async init() {
      await fullReload();
      ready = true;
      if (dirty) scheduleReload(); // события, пришедшие во время первого чтения
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      db.events.off('update', onUpdate);
    },
  };
}
type DocCache = ReturnType<typeof createDocCache>;

export async function joinGroup(
  helia: Helia,
  target: GroupTarget,
  onSnapshot: (snap: GroupSnapshot) => void,
  opts: JoinGroupOptions = {},
): Promise<GroupActions> {
  const withMessages = opts.messages !== false;
  const maxDays = opts.maxDays ?? Infinity;
    // открытый чат держит БД следующего периода открытой заранее; фоновый синк (maxDays) этого не делает
  const keepNext = withMessages && opts.maxDays === undefined;
  const libp2p = (helia as any).libp2p as Libp2p;
  const orbitdb = await getOrbitDB(helia);
  const myId: string = orbitdb.identity.id;

  let db: any;
  if ('address' in target) {
    db = await acquireShared(target.address, () => orbitdb.open(target.address));
  } else {
    db = await orbitdb.open(`group_${Math.random().toString(36).slice(2, 12)}_${Date.now()}`, {
      type: 'documents',
      docIndex: '_id',
      AccessController: GroupAccessController(),
    });
    sharedDbs.set(db.address.toString(), { promise: Promise.resolve(db), refCount: 1 });
  }
  const dbAddress: string = db.address.toString();
  const releaseCtrl = () => releaseShared(dbAddress, db);

  if (db.access?.type !== 'ychat-group' || !db.access.write?.[0]) {
    releaseCtrl();
    throw new Error('Not a ychat group database');
  }
  const owner: string = db.access.write[0];
  const gid = groupContactId(dbAddress);

  let state = computeGroupState([], owner);
  let limit = PAGE;
  let hasMore = false;
  let disposed = false;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let lastActTs = 0;
  let rollTimer: ReturnType<typeof setInterval> | null = null;

  const scheduleEmit = () => {
    if (emitTimer || disposed) return;
    emitTimer = setTimeout(() => { emitTimer = null; void emit(); }, 80);
  };

  const ctrl = createDocCache(db, scheduleEmit);

  // ---------- периоды (суточные БД сообщений) ----------
  const addresses = new Set<string>([dbAddress]);
  const announce = (addr: string) => libp2p.getPeers().forEach((p: PeerId) => notifyArchivist(libp2p, p, addr));

  const periods = new Map<string, { name: string; db: any; cache: DocCache }>();
  const periodPromises = new Map<string, Promise<{ name: string; db: any; cache: DocCache }>>();

  const ensurePeriod = (day: string) => {
    let p = periodPromises.get(day);
    if (!p) {
      p = (async () => {
        const name = `${gid}_${day}`;
        const pdb = await acquireShared(name, () =>
          orbitdb.open(name, {
            type: 'documents',
            docIndex: '_id',
            AccessController: GroupAccessController({ owner }), // владелец явный: адрес одинаков у всех участников
          }),
        );
        const cache = createDocCache(pdb, scheduleEmit);
        await cache.init();
        if (disposed) {
          cache.dispose();
          releaseShared(name, pdb);
          throw new Error('disposed');
        }
        const addr = pdb.address.toString();
        addresses.add(addr);
        announce(addr);
        const entry = { name, db: pdb, cache };
        periods.set(day, entry);
        return entry;
      })();
      periodPromises.set(day, p);
      p.catch(() => periodPromises.delete(day));
    }
    return p;
  };

  const toMessage = (d: any): ChatMessage => {
    const hiddenLocally = isHiddenLocally(d._id);
    return {
      id: d._id,
      whoSent: d.whoSent,
      text: hiddenLocally ? CONFIG.MSG.MESSAGE_DELETED : (d.text || ''),
      attachment: hiddenLocally ? undefined : (d.attachment ?? undefined),
      ts: d.ts || 0,
      type: d.whoSent === myId ? 'sent' : 'received',
      hidden: d.hidden === true,
      replyTo: hiddenLocally ? undefined : (d.replyTo ?? undefined),
      forwardedFrom: hiddenLocally ? undefined : (d.forwardedFrom ?? undefined),
    };
  };

  const collectVisible = (): ChatMessage[] => {
    const out: ChatMessage[] = [];
    const push = (d: any) => {
      if (typeof d?._id !== 'string' || !d._id.startsWith('msg_') || !(d.text || d.attachment || d.replyTo)) return;
      const m = toMessage(d);
      if (!isVisible(state, m.whoSent, m.ts)) return;
      out.push(
        state.deletedMsgIds.has(m.id)
          ? { ...m, text: CONFIG.MSG.MESSAGE_DELETED, attachment: undefined, replyTo: undefined, forwardedFrom: undefined, hidden: false }
          : m,
      );
    };
    for (const d of ctrl.docs()) push(d);                                  // старые группы: сообщения лежали в управляющей БД
    for (const p of periods.values()) for (const d of p.cache.docs()) push(d);
    return out.sort((a, b) => b.ts - a.ts);
  };

    const windowDays = () =>
    [...new Set([dayOf(Date.now()), ...(keepNext ? [nextDayOf(Date.now())] : []), ...state.days])].sort().reverse(); // новые первыми

  // Открывает текущий и следующий периоды всегда, остальные от новых к старым, пока не наберётся страница
  const ensureWindow = async (): Promise<boolean> => {
    if (!withMessages) return false;
    const today = dayOf(Date.now());
    const next = nextDayOf(Date.now());
    let loadedAny = false;
    let opened = 0;
    for (const d of windowDays()) {
      if (disposed) break;
      if (periods.has(d)) continue;
      const required = d === today || d === next;
      if (!required && (collectVisible().length >= limit || opened >= maxDays)) break;
      try {
        const p = await ensurePeriod(d);
        loadedAny = true;
        if (!required) {
          opened++;
          if (state.days.has(d)) {
            // индекс говорит, что день непустой: ждём, пока данные приедут (до 6 с)
            const t0 = Date.now();
            while (p.cache.size() === 0 && Date.now() - t0 < 6000 && !disposed) await sleep(300);
          }
        }
      } catch (err) {
        if (!disposed) console.warn(`[Group] Не удалось открыть период ${d}:`, err);
        break; // повторим при следующем обновлении или по таймеру
      }
    }
    return loadedAny;
  };

  let windowRun: Promise<void> | null = null;
  let windowAgain = false;
  const runWindow = (): Promise<void> => {
    if (windowRun) { windowAgain = true; return windowRun; }
    windowRun = (async () => {
      do {
        windowAgain = false;
        if (await ensureWindow()) scheduleEmit();
      } while (windowAgain && !disposed);
    })().finally(() => { windowRun = null; });
    return windowRun;
  };

  const emit = async () => {
    if (disposed) return;
    try {
      state = computeGroupState([...ctrl.docs()], owner);
      const visible = collectVisible();
      hasMore = visible.length > limit || (withMessages && [...state.days].some((d) => !periods.has(d)));
      onSnapshot({
        messages: visible.slice(0, limit),
        state,
        hasMore,
        myRole: roleOf(state, myId),
        canWrite: canWrite(state, myId),
      });
      void runWindow();
    } catch (err) {
      if (!disposed) console.error('❌ [Group] Ошибка сборки снимка:', err);
    }
  };

  const onConnect = (evt: any) => {
    const peerId = evt.detail as PeerId;
    setTimeout(() => checkAndSyncRelays(helia), 2000);
    if (relayManager.isRelay(peerId.toString())) {
      [...addresses].forEach((addr, i) => setTimeout(() => notifyArchivist(libp2p, peerId, addr), 1500 + i * 150));
    }
  };
  libp2p.addEventListener('peer:connect', onConnect);
  announce(dbAddress);

  const actions: GroupActions = {
    dbAddress,
    owner,
    myId,

    sendMessage: async (text, attachment, hidden, replyTo, forwardedFrom) => {
      if (!withMessages || !canWrite(state, myId)) return false;
      const ts = Date.now();
      const day = dayOf(ts);
      const msg: any = {
        _id: `msg_${myId}_${ts}_${Math.random().toString(36).slice(2, 9)}`,
        whoSent: myId,
        text,
        ts,
      };
      if (attachment) msg.attachment = attachment;
      if (hidden) msg.hidden = true;
      if (replyTo) msg.replyTo = replyTo;
      if (forwardedFrom) msg.forwardedFrom = forwardedFrom;

      const p = await ensurePeriod(day);
      await p.db.put(msg);
      // первое сообщение дня: записываем день в индекс (он же сообщает остальным об открытии новой БД)
      if (!state.days.has(day)) await actions.act('day', { d: day }).catch(() => {});
      return true;
    },

    // ts строго растёт: иначе add и role в одну миллисекунду могут поменяться местами при реплее
    act: async (type, fields = {}) => {
      const ts = Math.max(Date.now(), lastActTs + 1);
      lastActTs = ts;
      await db.put({ ...buildAct(myId, type, fields), ts });
    },

    deleteMessage: async (msgId) => {
      let targetDb: any = null;
      let doc: any = ctrl.get(msgId);
      if (doc) targetDb = db;
      else {
        for (const p of periods.values()) {
          const d = p.cache.get(msgId);
          if (d) { doc = d; targetDb = p.db; break; }
        }
      }
      if (!doc || !targetDb) return;
      if (doc.whoSent === myId) {
        await targetDb.put({
          ...doc, _id: msgId, text: CONFIG.MSG.MESSAGE_DELETED,
          attachment: null, replyTo: null, forwardedFrom: null, hidden: false,
        });
      } else {
        await actions.act('del_msg', { target: msgId });
      }
    },

    loadMoreHistory: async () => {
      if (!hasMore) return;
      limit += PAGE;
      await runWindow();
      await emit();
    },
    hasMoreHistory: () => hasMore,

    leaveRoom: () => {
      disposed = true;
      if (rollTimer) clearInterval(rollTimer);
      if (emitTimer) clearTimeout(emitTimer);
      libp2p.removeEventListener('peer:connect', onConnect);
      ctrl.dispose();
      for (const p of periods.values()) {
        p.cache.dispose();
        releaseShared(p.name, p.db);
      }
      periods.clear();
      releaseCtrl();
    },
  };

  await ctrl.init();

  if ('create' in target) {
    const c = target.create;
    const list: [GroupActType, Record<string, string | undefined>][] = [
      ['group', { name: c.name, description: c.description, writeMode: c.writeMode ?? 'all' }],
      ...(c.members ?? []).filter((id) => id !== myId).map((id): [GroupActType, Record<string, string>] => ['add', { target: id }]),
    ];
    for (let i = 0; i < list.length; i++) {
      if (i > 0 && i % 10 === 0) await sleep(10_500); // лимит AC: 15 записей за 10 с
      await actions.act(list[i][0], list[i][1]);
    }
  }

  // сообщения подгружаются фоном (emit запускает окно периодов): снимок со state приходит сразу
  await emit();
  // граница периода: окно переключается по таймеру, даже если событий нет
  if (keepNext && !disposed) rollTimer = setInterval(() => void runWindow(), 30_000);
  return actions;
}

export async function sendGroupInvites(
  helia: any, g: { dbAddress: string; name: string }, memberIds: string[],
) {
  const pubsub = helia.libp2p.services.pubsub;
  const data = new TextEncoder().encode(JSON.stringify({
    type: CONFIG.MSG.GROUP_INVITE,
    senderId: helia.libp2p.peerId.toString(),
    groupAddress: g.dbAddress,
    name: g.name,
  }));
  for (const id of memberIds) {
    await pubsub.publish(`${CONFIG.TOPICS.PROFILE_MAILBOX_PREFIX}${id}`, data).catch(() => {});
  }
}

export const groupPingTopic = (groupId: string) =>
  `${CONFIG.TOPICS.GROUP_PING_PREFIX}${groupId}${CONFIG.TOPICS.GROUP_PING_SUFFIX}`;

export const GROUP_LINK_PARAM = 'join';

export const buildGroupLink = (address: string): string =>
  `${window.location.origin}${import.meta.env.BASE_URL}?${GROUP_LINK_PARAM}=${address.replace('/orbitdb/', '')}`;

/** Хэш из ссылки → адрес БД; null, если формат неверный. */
export const parseGroupHash = (raw: string | null): string | null =>
  raw && /^zdpu[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(raw) ? `/orbitdb/${raw}` : null;

export type LinkJoinResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'unavailable' | 'disabled' | 'banned' | 'full' | 'closed' | 'rejected' };

export async function joinGroupByLink(helia: Helia, address: string): Promise<LinkJoinResult> {
  const holder: { snap: GroupSnapshot | null } = { snap: null };
  let handle: GroupActions | null = null;
  let keepOpen = false;
  try {
    const joined = joinGroup(helia, { address }, (s) => { holder.snap = s; }, { messages: false });
    handle = await Promise.race([joined, sleep(45_000).then(() => null)]);
    if (!handle) {
      console.warn('⏱️ [Group] joinGroup не завершился за 45 с:', address);
      joined.then((h) => h.leaveRoom()).catch(() => {}); // открылась позже таймаута: сразу отпускаем
      return { ok: false, reason: 'unavailable' };
    }

    // ждём, пока название приедет с репликацией (до 30 с)
    for (let i = 0; i < 60 && !holder.snap?.state.name; i++) await sleep(500);
    const s = holder.snap;
    if (!s?.state.name) {
      console.warn('⏱️ [Group] имя группы не пришло за 30 с. snap:', !!s, 'members:', s?.state.members.size);
      return { ok: false, reason: 'unavailable' };
    }

    const me = s.state.members.get(handle.myId);
    if (s.state.closed) return { ok: false, reason: 'closed' };
    if (me?.status === 'banned') return { ok: false, reason: 'banned' };
    if (!me) {
      if (s.state.joinMode !== 'link') return { ok: false, reason: 'disabled' };
      if (s.state.writeMode === 'all' && writerSlots(s.state) >= MAX_WRITERS) return { ok: false, reason: 'full' };
      await handle.act('join');
      // проверяем, что группа приняла вступление при пересчёте состояния
      for (let i = 0; i < 20 && holder.snap?.state.members.get(handle.myId)?.status !== 'active'; i++) await sleep(250);
      if (holder.snap?.state.members.get(handle.myId)?.status !== 'active') {
        console.warn('⏱️ [Group] join записан, но не принят. members:', holder.snap?.state.members.size);
        return { ok: false, reason: 'rejected' };
      }
    }
    keepOpen = true;
    return { ok: true, name: s.state.name };
  } catch (err) {
    console.error('❌ [Group] Вступление по ссылке не удалось:', err);
    return { ok: false, reason: 'unavailable' };
  } finally {
    if (handle) {
      const h = handle;
      // при успехе держим БД ещё 15 с: запись join должна уйти на релей, а чат группы возьмёт свою сессию
      if (keepOpen) setTimeout(() => h.leaveRoom(), 15_000);
      else h.leaveRoom();
    }
  }
}