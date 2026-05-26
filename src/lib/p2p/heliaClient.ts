import { createHelia } from 'helia';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { bootstrap } from '@libp2p/bootstrap';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { LevelBlockstore } from 'blockstore-level'; // Точно так же, как на сервере!
import { LevelDatastore } from 'datastore-level';
import { CONFIG, bootstrapList, directPeersList } from './config';
import { getOrCreatePrivateKey } from './crypto';
import { startKeepAliveLoop } from './connectionManager';
import { bitswap } from '@helia/block-brokers'
import { all } from '@libp2p/websockets/filters';
import { peerIdFromKeys } from '@libp2p/peer-id';
import { ping } from '@libp2p/ping';


// 1. Явно указываем тип Promise<any>, чтобы убрать ошибку "implicitly has an 'any' type"
// Храним промис инициализации, чтобы избежать race condition в React
let initializationPromise: Promise<any> | null = null;


export function createBrowserHelia(): Promise<any> {
  // Если нода уже создается или создана — возвращаем существующий промис
  if (initializationPromise) return initializationPromise;

// Оборачиваем всю асинхронную логику в промис
  initializationPromise = (async () => {
    
  // Достаем или генерируем PeerID (зависит от твоей реализации crypto.ts)
    const privateKey = await getOrCreatePrivateKey();
    const peerId = await peerIdFromKeys(privateKey.public.bytes, privateKey.bytes);

    const blockstore = new LevelBlockstore(CONFIG.ORBITDB_BLOCKS_DIR);
    const datastore = new LevelDatastore(CONFIG.DATA_DIR);

    await blockstore.open();
    await datastore.open();

    console.log('📦 [Client IPFS] Хранилища IndexedDB успешно открыты.'); 

    const heliaNode = await createHelia({
      blockstore: blockstore,
      datastore: datastore as any,
      blockBrokers: [
        bitswap() // Сервер и клиент оба используют bitswap
      ],
      libp2p: {
        privateKey: privateKey,
        peerId: peerId,
        addresses: {
        listen: ['/webrtc'], //, '/p2p-circuit' - ошибка!
      },
      peerDiscovery: [
        pubsubPeerDiscovery({
          interval: 10000,
          topics: [CONFIG.TOPIC_DISCOVERY],
          listenOnly: false,
        }),
        bootstrap({ list: bootstrapList }),
      ],
      transports: [
        webSockets( {
          filter: all
        }),
        webRTC(),
        // Настраиваем транспорт релея на автоматический поиск слота:
        circuitRelayTransport({
          discoverRelays: 1 // Искать 1 релей среди подключенных бутстрап-нод
        })
],
      connectionManager: { 
        maxConnections: 50 },
        connectionEncryption: [noise()],
        streamMuxers: [yamux()],
        connectionGater: { denyDialMultiaddr: () => false },
        services: {
          identify: identify(),
          ping: ping(),
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
          allowPublishToZeroPeers: true,
        }),
      },
      }
      
    });

    // Передаем инстанс в цикл удержания соединений
    startKeepAliveLoop(heliaNode.libp2p as any);

    // Это разрубает узел несовместимых версий PeerId/Libp2p между корневыми пакетами и недрами Helia.
    return await heliaNode;
  })();

  return initializationPromise;
}