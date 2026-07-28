import type { Helia } from 'helia';
import type { Libp2p, PeerId } from '@libp2p/interface';
import { getOrbitDB } from '../orbit/client.ts';
import { CONFIG } from '../config.ts';
import { notifyArchivist, checkAndSyncRelays } from '../networking/connectionManager.ts';
import { relayManager } from '../networking/heliaClient.ts';
import { OrbitDBAccessController } from '@orbitdb/core';
import { type FileAttachment } from './fileService.ts';

// Конфигурация приложения и интерфейсы для типов сообщений и значений в комнате чата.
export type MessageType = 'sent' | 'received' | 'system';

// Интерфейс для сообщений в чате
export interface ChatMessage {
  id: string;
  whoSent: string;
  text: string; // Может быть пустым, если отправили только фото
  type: MessageType;
  ts: number;
  attachment?: FileAttachment;
}

// Интерфейс для действий в комнате, который возвращается при присоединении к комнате
export interface RoomActions {
  sendMessage: (text: string, attachment?: FileAttachment) => Promise<void>;
  tombstoneMessage: (msgId: string) => Promise<void>;
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
    const chunk: any[] = [];
    try {
      const allRecords = await db.all();
      const sorted = allRecords
        .map((r: any) => r.value || r)
        .sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0));

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
        // 🔥 Исправлено: проверяем наличие текста ИЛИ вложения, чтобы не пропускать пустые текстовые сообщения с файлами
        if (messageData && (messageData.text || messageData.attachment)) {
          const isMine = messageData.whoSent === orbitdb.identity.id;
          onMessage({
            id: messageData._id || entry.hash, 
            whoSent: messageData.whoSent,
            text: messageData.text || '',
            attachment: messageData.attachment, // 🔥 Передаем вложение в UI
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
    if (messageData && (messageData.text || messageData.attachment)) {
      const isMine = messageData.whoSent === orbitdb.identity.id;
      onMessage({
        id: messageData._id || entry.hash || entry.key,
        whoSent: messageData.whoSent,
        text: messageData.text || '',
        attachment: messageData.attachment, // Передаем вложение в UI при "живом" обновлении базы
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
      setTimeout(() => {
        notifyArchivist(libp2p, peerId, dbAddress);
      }, 1500);
    }
  };

  libp2p.addEventListener('peer:connect', onConnect);
  libp2p.getPeers().forEach((peerId: PeerId) => notifyArchivist(libp2p, peerId, dbAddress));

  return {
    sendMessage: async (text: string, attachment?: FileAttachment) => {
      try {
        const messageObject: any = {
          _id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          whoSent: orbitdb.identity.id,
          text,
          ts: Date.now(),
        };

        if (attachment) {
          messageObject.attachment = attachment; // 🔥 Сохраняем структуру файла в OrbitDB
        }

        await db.put(messageObject);
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
tombstoneMessage: async (msgId: string) => {
      try {
        const result = await db.get(msgId);
        
        // В OrbitDB documents метод get() возвращает МАССИВ
        const doc = Array.isArray(result) ? result[0] : result;
        
        if (doc) {
          const targetDoc = doc.value || doc;
          
          await db.put({
            ...targetDoc,
            _id: msgId,
            text: 'Сообщение удалено',
            attachment: null
          });
        }
      } catch (err: any) {
        console.error(`❌ [OrbitDB] Ошибка обновления сообщения:`, err?.message || err);
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
    
    // Метод drop() полностью удаляет локальную базу данных в OrbitDB
    await db.drop();
    
    console.log('✅ База чата успешно и безвозвратно удалена локально');
  } catch (error) {
    console.error('❌ Ошибка при удалении базы чата:', error);
  }
};