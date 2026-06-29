import type { Helia } from 'helia';
import type { Libp2p, PeerId } from '@libp2p/interface';
import { getOrbitDB } from '../orbit/client.ts';
import { type ChatMessage, type RoomActions, CONFIG } from '../config.ts';
import { notifyArchivist, checkAndSyncRelays } from '../networking/connectionManager.ts';
import { relayManager } from '../networking/heliaClient.ts';
import { OrbitDBAccessController } from '@orbitdb/core';

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
      type: 'events',
      AccessController: OrbitDBAccessController({
        type: 'orbitdb',
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

  // === ВНУТРЕННЯЯ ЛОГИКА ПАГИНАЦИИ И ИСТОРИИ СЕССИИ ===
  let oldestHash: string | null = null; 
  let hasMore = true; 

  const loadHistoryChunk = async (limit: number, beforeHash: string | null = null) => {
    // Читаем базу в реверсе (от новых записей к старым)
    const options: any = { reverse: true }; 
    if (beforeHash) options.lt = beforeHash; 

    const chunk: any[] = [];
    try {
      const iterator = await db.iterator(options);
      for await (const record of iterator) {
        // 🔥 НАШ РУЧНОЙ СТОП-КРАН: принудительно останавливаемся на лимите чанка
        if (chunk.length >= limit) {
          break;
        }
        chunk.push(record);
      }
    } catch (e) {
      console.error('❌ Ошибка чтения чанка OrbitDB:', e);
    }

    // Если база вернула меньше записей, чем просили — это конец истории
    if (chunk.length < limit) {
      hasMore = false; 
    }

    if (chunk.length > 0) {
      // Последний считанный элемент — самый старый в этой пачке
      oldestHash = chunk[chunk.length - 1].hash;

      // Разворачиваем пачку обратно в хронологический порядок, как было в твоей рабочей версии
      const chronologicalChunk = [...chunk].reverse();

      for (const entry of chronologicalChunk) {
        const messageData = entry.payload?.value || entry.value;
        if (messageData && messageData.text) {
          const isMine = messageData.whoSent === orbitdb.identity.id;
          onMessage({
            id: entry.hash, 
            whoSent: messageData.whoSent,
            text: messageData.text,
            ts: messageData.ts || Date.now(),
            type: isMine ? 'sent' : 'received'
          }, true);
        }
      }
    }
  };

  // Автоматически выкачиваем первую страницу при открытии комнаты
  const chunkSize = CONFIG.CHUNK_SIZE || 15;
  await loadHistoryChunk(chunkSize);
  // ===================================================

  const onDbUpdate = (...args: any[]) => {
    const entry = args.length === 1 ? args[0] : args.find(a => a && (a.payload || a.value));
    if (!entry) return;

    const messageData = entry.payload?.value || entry.value;
    if (messageData && messageData.text) {
      const isMine = messageData.whoSent === orbitdb.identity.id;
      onMessage({
        id: entry.hash,
        whoSent: messageData.whoSent,
        text: messageData.text,
        ts: messageData.ts || Date.now(),
        type: isMine ? 'sent' : 'received',
      }, false);
    }
  };

  db.events.off('update', onDbUpdate);
  db.events.on('update', onDbUpdate);

  const onConnect = (evt: any) => {
    const peerId = evt.detail as unknown as PeerId;
    setTimeout(() => checkAndSyncRelays(helia), 2000);
    if (relayManager.isRelay(peerId.toString())) {
      notifyArchivist(libp2p, peerId, dbAddress);
    }
  };

  libp2p.addEventListener('peer:connect', onConnect);
  libp2p.getPeers().forEach((peerId: PeerId) => notifyArchivist(libp2p, peerId, dbAddress));

  return {
    sendMessage: async (text: string) => {
      try {
        await db.add({
          whoSent: orbitdb.identity.id,
          text,
          ts: Date.now(),
        });
      } catch (err: any) {
        console.error(`❌ [OrbitDB] Ошибка при записи:`, err?.message || err);
      }
    },
    leaveRoom: () => {
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
    pingRoom: () => {
      if (relayManagerInstance && typeof relayManagerInstance.announceRoom === 'function' && db) {
        relayManagerInstance.announceRoom(dbAddress);
      }
    },
    dbAddress: dbAddress,
    
    loadMoreHistory: async () => {
      if (hasMore) {
        const size = CONFIG.CHUNK_SIZE || 15;
        // 🔥 Исправлено: Передаем и размер, и указатель на прошлый хэш
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
  return `room_${hashHex}`;
};