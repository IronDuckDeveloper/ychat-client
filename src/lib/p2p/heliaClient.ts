import { createHelia } from 'helia';
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { bootstrap } from '@libp2p/bootstrap';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';

import { CONFIG, bootstrapList, directPeersList } from './config';
import { getOrCreatePrivateKey } from './crypto';
import { startKeepAliveLoop } from './connectionManager';

// 1. Явно указываем тип Promise<any>, чтобы убрать ошибку "implicitly has an 'any' type"
let initializationPromise: Promise<any> | null = null;

export function createBrowserHelia(): Promise<any> {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    const privateKey = await getOrCreatePrivateKey();

    const libp2p = await createLibp2p({
      // 2. Пробрасываем ключ через as any, так как у createLibp2p и crypto разъехались интерфейсы ключей
      privateKey: privateKey, 
      addresses: {
        listen: ['/webrtc', '/p2p-circuit'],
      },
      peerDiscovery: [
        pubsubPeerDiscovery({
          interval: 10000,
          topics: [CONFIG.TOPIC_DISCOVERY],
          listenOnly: false,
        }),
        bootstrap({ list: bootstrapList }),
      ],
      transports: [webSockets(), webRTC(), circuitRelayTransport()],
      connectionManager: { maxConnections: 50 },
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      connectionGater: { denyDialMultiaddr: () => false },
      services: {
        identify: identify(),
        pubsub: gossipsub({
          doPX: true,
          D: 3, Dlo: 2, Dhi: 5, Dscore: 1,
          heartbeatInterval: 1000,
          directPeers: directPeersList,
          scoreThresholds: {
            gossipThreshold: -Infinity,
            publishThreshold: -Infinity,
            graylistThreshold: -Infinity,
            acceptPXThreshold: -Infinity,
            opportunisticGraftThreshold: -Infinity,
          },
          scoreParams: { IPColocationFactorWeight: 0, behaviourPenaltyWeight: 0 },
          fallbackToFloodsub: true,
          allowPublishToZeroTopicPeers: true,
        }),
      },
    });

    // Передаем инстанс в цикл удержания соединений
    startKeepAliveLoop(libp2p as any);

    // 3. САМОЕ ВАЖНОЕ: Передаем libp2p как any внутрь createHelia. 
    // Это разрубает узел несовместимых версий PeerId/Libp2p между корневыми пакетами и недрами Helia.
    return await createHelia({ libp2p: libp2p as any });
  })();

  return initializationPromise;
}