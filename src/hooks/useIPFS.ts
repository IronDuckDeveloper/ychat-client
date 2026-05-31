import { useState, useEffect, useCallback } from 'react';
import type { Helia } from 'helia';
import { joinRoom as joinOrbitRoom } from '../lib/p2p/services/roomService';
import type { ChatMessage, RoomActions } from '../lib/p2p/services/roomService';

// Импортируем глобальный инстанс и подписку из нашего сервиса инициализации
// Убедитесь, что путь соответствует вашему расположению authService.ts (или initService.ts)
import { globalHelia, onDbReady } from '../lib/p2p/services/authService.ts';

export const useIPFS = () => {
  // Инициализируем стейт сразу правильными значениями, если нода уже успела подняться
  const [isReady, setIsReady] = useState<boolean>(!!globalHelia);
  const [nodeId, setNodeId] = useState<string | null>(
    globalHelia ? (globalHelia as any).libp2p.peerId.toString() : null
  );

  useEffect(() => {
    // Если Helia уже есть на момент монтирования компонента, ничего не делаем
    if (globalHelia) return;

    // Если нет — ждем сигнала готовности из сервиса
    onDbReady(() => {
      if (globalHelia) {
        setIsReady(true);
        setNodeId((globalHelia as any).libp2p.peerId.toString());
      }
    });
  }, []);

  const joinRoomCallback = useCallback(
    async (roomName: string, onMessage: (message: ChatMessage) => void): Promise<RoomActions> => {
      if (!globalHelia) {
        throw new Error('Helia node is not ready yet');
      }
      return await joinOrbitRoom(globalHelia, roomName, onMessage);
    },
    []
  );

  return {
    helia: globalHelia as Helia | null,
    isReady,
    nodeId,
    error: null, // Ошибки старта теперь отлавливаются глобально в initializeApp
    joinRoom: joinRoomCallback,
  };
};