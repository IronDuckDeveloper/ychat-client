import { useState, useEffect, useCallback } from 'react';
import type { Helia } from 'helia';
import { createBrowserHelia } from '../lib/p2p/heliaClient';
import { pipe } from 'it-pipe';

// Фиксируем глобальный инстанс, чтобы он не пересоздавался при ререндерах React
let heliaInstance: Helia | null = null;

const PEER_SYNC_REQUEST_TOPIC = 'peers:sync:request';
const PEER_SYNC_RESPONSE_TOPIC_BASE = 'peers:sync:response:';
const SYNC_INTERVAL_MS = 10800000; // 3 часа в миллисекундах

export interface RoomActions {
  sendMessage: (text: string) => Promise<void>;
  leaveRoom: () => void;
}

export const useIPFS = () => {
  const [isReady, setIsReady] = useState<boolean>(false);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let interval: NodeJS.Timeout;

    const init = async () => {
      try {
        if (heliaInstance) {
          if (isMounted) {
            setIsReady(true);
            setNodeId(heliaInstance.libp2p.peerId.toString());
          }
          return;
        }

        const helia = await createBrowserHelia();
        if (!isMounted) return;

        // Прокидываем в window для удобного дебага в консоли разработчика
        (window as any).helia = helia;
        heliaInstance = helia;

        const libp2p = helia.libp2p as any;
        const pubsub = libp2p.services.pubsub;

        // Подписываем клиента на входящие запросы синхронизации
        await pubsub.subscribe(PEER_SYNC_REQUEST_TOPIC);

        if (isMounted) {
          setNodeId(libp2p.peerId.toString());
          setIsReady(true);
        }

        // Каждые 5 секунд выводим в консоль статус сети
        interval = setInterval(() => {
          if (heliaInstance) {
            const allPeers = libp2p.getPeers();
            const pubsubPeers = pubsub.getPeers();
            const topics = pubsub.getTopics();
            
            console.log(
              `📊 Network: Peers=${allPeers.length} | PubSub=${pubsubPeers.length} | Topics=${JSON.stringify(topics)}`
            );
          }
        }, 5000);

      } catch (err: any) {
        console.error('Ошибка инициализации Helia:', err);
        if (isMounted) {
          setError(err?.message ? err.message : String(err));
          setIsReady(false);
        }
      }
    };

    init();

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, []);

  // Оборачиваем в useCallback, чтобы React не пересоздавал функцию при каждом рендере
  const joinRoomCallback = useCallback(
    async (roomName: string, onMessage: (message: string) => void): Promise<RoomActions> => {
      if (!heliaInstance) {
        throw new Error('Helia node is not ready yet');
      }
      return await joinRoom(heliaInstance, roomName, onMessage);
    },
    []
  );

  return {
    helia: heliaInstance,
    isReady,
    nodeId,
    error,
    joinRoom: joinRoomCallback
  };
};

// === ТВОЯ ОРИГИНАЛЬНАЯ ЛОГИКА СЕТЕВЫХ КОМНАТ ===

export const joinRoom = async (
  helia: Helia,
  roomName: string,
  onMessage: (message: string) => void
): Promise<RoomActions> => {
  const libp2p = helia.libp2p as any;
  const pubsub = libp2p.services.pubsub;
  const ANNOUNCE_TOPIC = 'rooms:announce';

  const notifyPeer = async (peerId: any) => {
    try {
      const stream = await libp2p.dialProtocol(peerId, '/p2p-relay/v1/announce');
      const data = new TextEncoder().encode(JSON.stringify(roomName));
      
      await pipe(
        [data], 
        stream  
      );
      
      console.log(`🚀 [Protocol] Анонс ${roomName} отправлен пиру ${peerId.toString().slice(-6)}`);
    } catch (err) {
      console.error('❌ Ошибка отправки анонса:', err);
    }
  };

  // 1. Сразу подписываемся сами
  await pubsub.subscribe(roomName);
  console.log(`📡 Браузер подписан на: ${roomName}`);

  // 2. СЛУШАЕМ НОВЫЕ ПОДКЛЮЧЕНИЯ
  const onConnect = (evt: any) => {
    const peerId = evt.detail;
    console.log(`🤝 Новое соединение: ${peerId.toString().slice(-6)}. Отправляю анонс...`);
    
    setTimeout(async () => {
      await checkAndSyncRelays(helia);
    }, 2000);
    
    notifyPeer(peerId);
  };
  libp2p.addEventListener('peer:connect', onConnect);

  // 3. Уведомляем тех, кто уже подключен к нам
  libp2p.getPeers().forEach((peerId: any) => notifyPeer(peerId));

  // 4. Публикуем в общий топик анонсов комнат
  const announcementPayload = new TextEncoder().encode(JSON.stringify({ room: roomName, ts: Date.now() }));
  await pubsub.publish(ANNOUNCE_TOPIC, announcementPayload);

  // Обработчик входящих сообщений в чате
  const handler = (evt: any) => {
    const message = evt.detail || evt;
    if (message?.topic === roomName) {
      try {
        const text = new TextDecoder().decode(message.data);
        const decoded = JSON.parse(text);
        onMessage(decoded.text);
      } catch (e) { 
        console.error('Ошибка парсинга:', e); 
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
      } catch (e) {
        console.warn('Ошибка при отписке от комнаты:', e);
      }
    }
  };
};

// === ТВОИ СЕРВИСНЫЕ ФУНКЦИИ СИНХРОНИЗАЦИИ КЭША ===

async function requestRelaysSync(helia: Helia): Promise<boolean> {
  const node = helia.libp2p as any;
  const pubsub = node.services.pubsub;
  const myPeerId = node.peerId.toString();
  const responseTopic = `${PEER_SYNC_RESPONSE_TOPIC_BASE}${myPeerId}`;

  return new Promise(async (resolve) => {
    const onResponse = async (evt: any) => {
      const msg = evt.detail || evt;
      if (msg.topic !== responseTopic) return;

      try {
        const payload = JSON.parse(new TextDecoder().decode(msg.data));
        if (payload?.relays) {
          localStorage.setItem('known_relays', JSON.stringify(payload.relays));
          localStorage.setItem('last_peer_sync', Date.now().toString());
          
          console.log(`📥 [PEER-SYNC] Получено и сохранено релеев: ${payload.relays.length}`);
          
          pubsub.removeEventListener('message', onResponse);
          await pubsub.unsubscribe(responseTopic);
          resolve(true);
        }
      } catch (e) {
        console.error('Ошибка парсинга списка релеев:', e);
      }
    };

    await pubsub.subscribe(responseTopic);
    pubsub.addEventListener('message', onResponse);

    const reqPayload = JSON.stringify({ from: myPeerId });
    console.log('📢 [PEER-SYNC] Запрашиваю список узлов у сети...');
    await pubsub.publish(PEER_SYNC_REQUEST_TOPIC, new TextEncoder().encode(reqPayload));

    setTimeout(() => {
      pubsub.removeEventListener('message', onResponse);
      try {
        pubsub.unsubscribe(responseTopic);
      } catch (e) {
        console.warn('Ошибка при отписке по таймауту:', e);
      }
      resolve(false);
    }, 5000);
  });
}

async function checkAndSyncRelays(helia: Helia): Promise<void> {
  const lastSync = localStorage.getItem('last_peer_sync');
  const now = Date.now();

  if (!lastSync || (now - parseInt(lastSync, 10)) > SYNC_INTERVAL_MS) {
    console.log('🔄 [SYNC] Кэш устарел или пуст. Начинаем синхронизацию...');
    await requestRelaysSync(helia);
  } else {
    const remainingMs = SYNC_INTERVAL_MS - (now - parseInt(lastSync, 10));
    const remainingMinutes = Math.round(remainingMs / 1000 / 60);
    console.log(`⏳ [SYNC] Кэш релеев актуален. Следующее обновление через ~${remainingMinutes} мин.`);
  }
}