import type { Helia } from 'helia';
import type { Libp2p, PeerId } from '@libp2p/interface';
import { getOrbitDB } from '../orbit/client.ts';
import { CONFIG, type ChatMessage, type RoomActions } from '../config.ts';
import { notifyArchivist, checkAndSyncRelays } from '../networking/connectionManager.ts';
import { relayManager } from '../networking/heliaClient.ts';
import { OrbitDBAccessController } from '@orbitdb/core';

// Единное хранилище сессий комнат для защиты от двойного монтирования (React StrictMode)
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
  const stableName = `ychat-room-${roomName.toLowerCase().replace(/\s+/g, '-')}`;

  const orbitdb = await getOrbitDB(helia);

  let session = roomSessions.get(stableName);
  if (!session) {
    // Создаем сессию синхронно, чтобы идущий следом дублирующий вызов React сразу её увидел
    const openPromise = orbitdb.open(stableName, {
      type: 'events',
      AccessController: OrbitDBAccessController({
        type: 'orbitdb',
        write: ['*'],
          }),
        });
    session = {
      promise: openPromise,
      refCount: 0,
      instance: null
    };
    roomSessions.set(stableName, session);
  }

  // Синхронно занимаем место в очереди. Теперь refCount станет равен 2 при StrictMode
  session.refCount++;

  let db: any;
  try {
    db = await session.promise;
    session.instance = db;
  } catch (err) {
    session.refCount--;
    if (session.refCount <= 0) {
      roomSessions.delete(stableName);
    }
    throw err;
  }

  const dbAddress = db.address.toString();

  // Выгружаем всю локальную историю за раз
  try {
    const entries = [];
    for await (const record of db.iterator()) {
      entries.push(record);
    }
    entries.reverse();

    for (const entry of entries) {
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
  } catch (e) {
    console.error('❌ Ошибка чтения локальной истории OrbitDB:', e);
  }

  // Обработка новых сообщений в реальном времени
  const onDbUpdate = (entry: any) => {
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
      
      const currentSession = roomSessions.get(stableName);
      if (currentSession) {
        currentSession.refCount--;
        
        // 🔒 Закрываем базу и отписываемся ТОЛЬКО когда комнату покинули ВСЕ маунты
        if (currentSession.refCount <= 0) {
          roomSessions.delete(stableName);
          if (currentSession.instance) {
            currentSession.instance.events.off('update', onDbUpdate);
            currentSession.instance.close().catch(() => {});
          }
        }
      }
    },
    pingRoom: () => {
      if (relayManagerInstance && db) {
        relayManagerInstance.announceRoom(dbAddress);
      }
    },
    dbAddress: dbAddress,
    loadMoreHistory: async () => {}, 
    hasMoreHistory: () => false,
  };
}

export const getDeterministicRoomName = async (nodeId: string, peerId: string) => {
  const sorted = [nodeId, peerId].sort().join('_');
  const msgBuffer = new TextEncoder().encode(sorted);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `room_${hashHex}`;
}