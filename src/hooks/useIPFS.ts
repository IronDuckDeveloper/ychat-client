import { useState, useEffect, useCallback } from 'react';
import type { Helia } from 'helia';
import { createBrowserHelia } from '../lib/p2p/heliaClient';
import { joinRoom as joinOrbitRoom } from '../lib/p2p/roomService'; 
import type { ChatMessage, RoomActions } from '../lib/p2p/roomService';
import { CONFIG } from '../lib/p2p/config';


// Фиксируем глобальный инстанс, чтобы он не пересоздавался при ререндерах React
let heliaInstance: Helia | null = null;
let heliaInitPromise: Promise<Helia> | null = null;

export const useIPFS = () => {
  const [isReady, setIsReady] = useState<boolean>(false);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let interval: NodeJS.Timeout;

    const init = async () => {
      try {

        // 1. Если инициализация ЕЩЕ НЕ НАЧИНАЛАСЬ ни разу в приложении
        if (!heliaInitPromise) {
          heliaInitPromise = createBrowserHelia()
            .then((node) => {
              heliaInstance = node;
              return node;
            })
            .catch((err) => {
              // Если запуск упал, сбрасываем промис, чтобы можно было попробовать снова
              heliaInitPromise = null;
              throw err;
            });
        }
        // 2. Все вызовы (включая двойной Strict Mode) будут ждать ОДИН И ТОТ ЖЕ промис
        const node = await heliaInitPromise;

        // Прокидываем в window для удобного дебага в консоли разработчика
        (window as any).helia = node;
        heliaInstance = node;

        const libp2p = (node as any).libp2p as any;
        const pubsub = libp2p.services.pubsub;

        if (!pubsub) {
          throw new Error('PubSub service is not available on libp2p node');
        }

        // Подписываем клиента на входящие запросы синхронизации релеев
        await pubsub.subscribe(CONFIG.TOPICS.PEER_SYNC_REQUEST_TOPIC);

       // 3. Обновляем стейт React только один раз, если компонент жив
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

  // Перенаправляем вызов на правильную функцию из roomService.ts
  const joinRoomCallback = useCallback(
    async (roomName: string, onMessage: (message: ChatMessage) => void): Promise<RoomActions> => {
      if (!heliaInstance) {
        throw new Error('Helia node is not ready yet');
      }
      return await joinOrbitRoom(heliaInstance, roomName, onMessage);
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