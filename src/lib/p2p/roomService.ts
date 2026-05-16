import { pipe } from 'it-pipe';
import type { Helia } from 'helia';
import type { Libp2p, PeerId } from '@libp2p/interface';
import { CONFIG } from './config';

export interface RoomActions {
  sendMessage: (text: string) => Promise<void>;
  leaveRoom: () => void;
}

// Извлекаем тип для сервиса pubsub, чтобы не писать везде any
// interface PubSubMessageEvent {
//   detail: {
//     topic: string;
//     data: Uint8Array;
//   };
// }

async function notifyPeer(libp2p: Libp2p, peerId: PeerId, roomName: string): Promise<void> {
  try {
    const stream = await libp2p.dialProtocol(peerId, '/p2p-relay/v1/announce');
    const data = new TextEncoder().encode(JSON.stringify(roomName));
    await pipe([data], stream);
    console.log(`🚀 [Protocol] Анонс ${roomName} улетел к ${peerId.toString().slice(-6)}`);
  } catch (err: any) {
    console.error('❌ Ошибка отправки анонса:', err.message);
  }
}

export async function checkAndSyncRelays(helia: Helia): Promise<void> {
  const lastSync = localStorage.getItem('last_peer_sync');
  const now = Date.now();

  if (!lastSync || (now - parseInt(lastSync, 10)) > CONFIG.SYNC_INTERVAL_MS) {
    console.log('🔄 [SYNC] Кэш пуст/устарел. Запрашиваем узлы...');
    
    const libp2p = helia.libp2p as unknown as Libp2p;
    // Используем встроенный в libp2p сервис pubsub
    const pubsub = (libp2p.services as any).pubsub;
    if (!pubsub) return;

    const myPeerId = libp2p.peerId.toString();
    const responseTopic = `${CONFIG.TOPICS.PEER_SYNC_RESPONSE_BASE}${myPeerId}`;

    const onResponse = async (evt: any) => {
      const msg = evt.detail || evt;
      if (msg.topic !== responseTopic) return;
      try {
        const payload = JSON.parse(new TextDecoder().decode(msg.data));
        if (payload?.relays) {
          localStorage.setItem('known_relays', JSON.stringify(payload.relays));
          localStorage.setItem('last_peer_sync', Date.now().toString());
          console.log(`📥 [PEER-SYNC] Кэш синхронизирован. Релеев: ${payload.relays.length}`);
          
          pubsub.removeEventListener('message', onResponse);
          await pubsub.unsubscribe(responseTopic);
        }
      } catch (e) { 
        console.error('Ошибка парсинга релеев:', e); 
      }
    };

    await pubsub.subscribe(responseTopic);
    pubsub.addEventListener('message', onResponse);

    const reqPayload = JSON.stringify({ from: myPeerId });
    await pubsub.publish(CONFIG.TOPICS.PEER_SYNC_REQUEST, new TextEncoder().encode(reqPayload));

    setTimeout(() => {
      pubsub.removeEventListener('message', onResponse);
      try { pubsub.unsubscribe(responseTopic); } catch {}
    }, 5000);

  } else {
    const remainMin = Math.round((CONFIG.SYNC_INTERVAL_MS - (now - parseInt(lastSync, 10))) / 60000);
    console.log(`⏳ [SYNC] Кэш релеев актуален. Обновление через ~${remainMin} мин.`);
  }
}

export async function joinRoom(
  helia: Helia, 
  roomName: string, 
  onMessage: (message: string) => void
): Promise<RoomActions> {
  const libp2p = helia.libp2p as unknown as Libp2p;
  const pubsub = (libp2p.services as any).pubsub;

  if (!pubsub) {
    throw new Error('PubSub service is not available on libp2p node');
  }

  await pubsub.subscribe(roomName);
  console.log(`📡 Браузер подписан на топик: ${roomName}`);

  const onConnect = (evt: any) => {
    const peerId = evt.detail as unknown as PeerId;
    console.log(`🤝 Новое соединение: ${peerId.toString().slice(-6)}. Синкаем...`);
    setTimeout(() => checkAndSyncRelays(helia), 2000);
    notifyPeer(libp2p, peerId, roomName);
  };

  libp2p.addEventListener('peer:connect', onConnect);
  libp2p.getPeers().forEach((peerId: PeerId) => notifyPeer(libp2p, peerId, roomName));

  const announcementPayload = new TextEncoder().encode(JSON.stringify({ room: roomName, ts: Date.now() }));
  await pubsub.publish(CONFIG.TOPICS.ANNOUNCE, announcementPayload);

  const handler = (evt: any) => {
    const message = evt.detail || evt;
    if (message?.topic === roomName) {
      try {
        const text = new TextDecoder().decode(message.data);
        const decoded = JSON.parse(text);
        onMessage(decoded.text);
      } catch (e) { 
        console.error('Ошибка парсинга сообщения:', e); 
      }
    }
  };

  pubsub.addEventListener('message', handler);

  return {
    sendMessage: async (text: string) => {
      const encoded = new TextEncoder().encode(JSON.stringify({ text, ts: Date.now() }));
      await pubsub.publish(roomName, encoded);
      console.log(`✅ Отправлено: ${text}`);
    },
    leaveRoom: () => {
      libp2p.removeEventListener('peer:connect', onConnect);
      pubsub.removeEventListener('message', handler);
      try {
        pubsub.unsubscribe(roomName);
      } catch {}
    }
  };
}