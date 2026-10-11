import type { Helia } from 'helia';
import type { Libp2p, PeerId } from '@libp2p/interface';
import { getOrbitDB } from '../orbit/client.ts';
import { CONFIG } from '../config.ts';
import { notifyArchivist, checkAndSyncRelays } from '../networking/connectionManager.ts';
import { relayManager } from '../networking/heliaClient.ts';
import { RateLimitedAccessController } from '../orbit/rateLimitedAccessController.ts';
import { type FileAttachment } from './fileService.ts';
import { isHiddenLocally, hideMessageLocally } from './hiddenMessagesService.ts';

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

export async function joinRoom(
  helia: Helia,
  roomName: string,
  onMessage: (message: ChatMessage, isBackgroundSync?: boolean) => void,
  relayManagerInstance?: any,
): Promise<RoomActions> {
  const libp2p = (helia as any).libp2p as unknown as Libp2p;
  const orbitdb = await getOrbitDB(helia);
  
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
      if (!cache.has(id)) added.push(d);
      cache.set(id, d);
      if (typeof r?.hash === 'string') known.add(r.hash);
    }
    sortedDesc = null;
    lastReloadMs = performance.now() - t0;
    return added;
  };

  const getSorted = () =>
    (sortedDesc ??= [...cache.values()].sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)));

  const loadHistoryChunk = async (limit: number, beforeHash: string | null = null) => {
    const chunk: any[] = [];
    try {
      const sorted = getSorted();

      let startIndex = 0;
      if (beforeHash) {
        const foundIdx = sorted.findIndex((m: any) => (m._id || m.id) === beforeHash);
        if (foundIdx !== -1) {
          startIndex = foundIdx + 1;
        }
      }

      const page = sorted.slice(startIndex, startIndex + limit);
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

    if (chunk.length < limit) {
      hasMore = false;
    }
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
    reloadTimer = setTimeout(async () => {
      reloadTimer = null;
      if (disposed) return;
      try {
        const added = await fullReload();
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
      } catch (e) {
        console.error('❌ Ошибка чтения БД чата:', e);
      }
    }, Math.max(1500, lastReloadMs * 3));
  };

  const onDbUpdate = (entry?: any) => {
    if (disposed) return;
    const p = entry?.payload;
    const doc = p?.op === 'PUT' ? p.value : null;
    const id = doc?._id || doc?.id;

    if (typeof id === 'string') {
      const isNew = !cache.has(id);
      cache.set(id, doc);
      sortedDesc = null;
      if (typeof entry.hash === 'string') known.add(entry.hash);
      // новый документ показываем всегда; уже известный (правка, tombstone) — только если он уже был показан
      if (isNew || seen.has(id)) emitIfChanged(doc, false);
    }

    // записи, которых мы не видели (пачка при синке), подбираем полным чтением
    const gap = typeof id !== 'string' || !Array.isArray(entry?.next) || entry.next.some((h: string) => !known.has(h));
    if (gap) scheduleReload();
  };

  db.events.off('update', onDbUpdate);
  db.events.on('update', onDbUpdate);

  const chunkSize = CONFIG.CHUNK_SIZE || 15;
  await fullReload();
  await loadHistoryChunk(chunkSize);

  const onConnect = (evt: any) => {
    const peerId = evt.detail as unknown as PeerId;

    setTimeout(() => checkAndSyncRelays(helia), 2000);

    if (relayManager.isRelay(peerId.toString())) {
      setTimeout(() => {
        notifyArchivist(libp2p, peerId, dbAddress);
      }, 1500);
    }
  };

  libp2p.addEventListener('peer:connect', onConnect);
  libp2p.getPeers().forEach((peerId: PeerId) => notifyArchivist(libp2p, peerId, dbAddress));

  return {
    sendMessage: async (
      text: string, 
      attachment?: FileAttachment, 
      hidden?: boolean, 
      replyTo?: ReplyInfo, 
      forwardedFrom?: ForwardedFrom
    ) => {
      try {
        const messageObject: any = {
          _id: `msg_${orbitdb.identity.id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          whoSent: orbitdb.identity.id,
          text,
          ts: Date.now(),
        };

        if (attachment) messageObject.attachment = attachment;
        if (hidden) messageObject.hidden = true;
        if (replyTo) messageObject.replyTo = replyTo;
        if (forwardedFrom) messageObject.forwardedFrom = forwardedFrom;

        await db.put(messageObject);
      } catch (err: any) {
        console.error(`❌ [OrbitDB] Ошибка при записи:`, err?.message || err);
      }
    },
    leaveRoom: () => {
      disposed = true;
      if (reloadTimer) clearTimeout(reloadTimer);
      db.events.off('update', onDbUpdate);
      libp2p.removeEventListener('peer:connect', onConnect);
      
      const currentSession = roomSessions.get(roomName);
      if (currentSession) {
        currentSession.refCount--;
        
        if (currentSession.refCount <= 0) {
          roomSessions.delete(roomName);
          if (currentSession.instance) {
            currentSession.instance.events.off('update', onDbUpdate);
            currentSession.instance.close().catch(() => {});
          }
        }
      }
    },
    tombstoneMessage: async (msgId: string) => {
      try {
        const result = await db.get(msgId);
        
        const doc = Array.isArray(result) ? result[0] : result;
        
        if (doc) {
          const targetDoc = doc.value || doc;
          
          await db.put({
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
      if (relayManagerInstance && typeof relayManagerInstance.announceRoom === 'function' && db) {
        relayManagerInstance.announceRoom(dbAddress);
      }
    },
    dbAddress: dbAddress,
    
    loadMoreHistory: async () => {
      if (hasMore) {
        const size = CONFIG.CHUNK_SIZE || 15;
        await loadHistoryChunk(size, oldestHash); 
        
        if (relayManagerInstance && typeof relayManagerInstance.announceRoom === 'function') {
          relayManagerInstance.announceRoom(dbAddress);
        }
      }
    },
    hasMoreHistory: () => hasMore,
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
