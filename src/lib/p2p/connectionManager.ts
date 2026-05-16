import { multiaddr } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';
import type { Libp2p } from '@libp2p/interface';
import { CONFIG, bootstrapList } from './config';

const retryMap = new Map<string, number>();

export function startKeepAliveLoop(libp2p: Libp2p): () => void {
  // Защита серверов сразу при старте
  bootstrapList.forEach((addr: string) => {
    const peerIdStr = addr.split('/p2p/')[1];
    if (peerIdStr) {
      try {
        // Пробрасываем как any, чтобы подружить разные версии интерфейса PeerId
        const parsedId = peerIdFromString(peerIdStr) as any;
        libp2p.peerStore.merge(parsedId, {
          tags: { 'keep-alive': { value: 100 } },
        }).catch(() => {});
      } catch {}
    }
  });

  const ensureConnections = async (): Promise<void> => {
    const connectedPeers = libp2p.getPeers().map((p: any) => p.toString());

    for (const addrStr of bootstrapList) {
      const peerIdStr = addrStr.split('/p2p/')[1];
      if (!peerIdStr) continue;

      const currentRetry = retryMap.get(peerIdStr) || 0;

      try {
        // Здесь тоже принудительно глушим панику TypeScript через as any
        const peerId = peerIdFromString(peerIdStr) as any;

        await libp2p.peerStore.merge(peerId, {
          tags: { 'keep-alive': { value: 100 } },
        });

        if (connectedPeers.includes(peerIdStr)) {
          retryMap.set(peerIdStr, 0);
          continue;
        }

        if (currentRetry >= CONFIG.MAX_RETRIES) {
          console.log(`🚫 [Dial] Превышено число попыток для ${peerIdStr.slice(-6)}. Игнорируем.`);
          continue;
        }

        try {
          console.log(`📡 [Dial] Попытка ${currentRetry + 1}: Стучимся к ${peerIdStr.slice(-6)}...`);
          await libp2p.dial(multiaddr(addrStr), { signal: AbortSignal.timeout(5000) });
          
          await new Promise((r) => setTimeout(r, 500)); // Даем время на Identify

          if (libp2p.getPeers().some((p: any) => p.toString() === peerIdStr)) {
            console.log(`✅ [Success] Узел ${peerIdStr.slice(-6)} подтвержден в сети`);
            retryMap.set(peerIdStr, 0);
          } else {
            throw new Error('PeerID mismatch or connection dropped during handshake');
          }
        } catch (err: any) {
          const nextRetry = currentRetry + 1;
          retryMap.set(peerIdStr, nextRetry);
          const delay = Math.min(1000 * Math.pow(2, nextRetry), 30000);
          console.warn(`⚠️ [Dial] Ошибка связи с ${peerIdStr.slice(-6)}: ${err.message}. Ждем ${delay / 1000}с`);
          await new Promise((r) => setTimeout(r, delay));
        }
      } catch (e) {
        // Тихое подавление битых пиров
      }
    }
  };

  const intervalId = setInterval(ensureConnections, 10000);
  const timeoutId = setTimeout(ensureConnections, 2000);

  return () => {
    clearInterval(intervalId);
    clearTimeout(timeoutId);
  };
}