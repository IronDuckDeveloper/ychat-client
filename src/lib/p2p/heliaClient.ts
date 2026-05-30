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
import { getPrivateKey } from './crypto';
import { bitswap } from '@helia/block-brokers'
import { all } from '@libp2p/websockets/filters';
import { peerIdFromKeys } from '@libp2p/peer-id';
import { ping } from '@libp2p/ping';
import { RelayManager } from './RelayManager';
import peersConfig from '../known-peers.json';
import { CONFIG } from './config';
import { notifyArchivist } from './connectionManager';

// 1. Явно указываем тип Promise<any>, чтобы убрать ошибку "implicitly has an 'any' type"
// Храним промис инициализации, чтобы избежать race condition в React
let initializationPromise: Promise<any> | null = null;

// Создаем менеджер (передаем туда твой сырой JSON с релеями)
export const relayManager = new RelayManager(peersConfig.relays, CONFIG.RELAY_POOL_SIZE);

export function createBrowserHelia(): Promise<any> {
  // Если нода уже создается или создана — возвращаем существующий промис
  if (initializationPromise) return initializationPromise;

  // Оборачиваем всю асинхронную логику в промис
  initializationPromise = (async () => {    
    // Достаем или генерируем PeerID (зависит от твоей реализации crypto.ts)
    const privateKey = await getPrivateKey();
    const peerId = await peerIdFromKeys(privateKey.public.bytes, privateKey.bytes);

    const blockstore = new LevelBlockstore(CONFIG.ORBITDB_BLOCKS_DIR);
    const datastore = new LevelDatastore(CONFIG.DATA_DIR);

    await blockstore.open();
    await datastore.open();

    console.log('📦 [Client IPFS] Хранилища IndexedDB успешно открыты.'); 

    let heliaNode: any = null;
    let currentRelayIndex = 0;
    
    // Достаем пул релеев для перебора (если в RelayManager есть getPool, используй его, иначе берем напрямую)
    const pool = (relayManager as any).relayPool || peersConfig.relays.slice(0, CONFIG.RELAY_POOL_SIZE);

    // Цикл перебора релеев: если один отваливается при старте, пробуем следующий
    while (!heliaNode && currentRelayIndex < pool.length) {
      const relay = pool[currentRelayIndex];
      const bootstrapAddresses = [`${relay.address}/p2p/${relay.peerId}`];
      console.log(`🚀 [HeliaInit] Пробуем запустить ноду через релей: ${relay.name || relay.peerId.slice(-6)}`);

      try {
        heliaNode = await createHelia({
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
              bootstrap({ list: bootstrapAddresses }),
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
              minConnections: 1,
              maxConnections: 5, // Максимум соединений всего
              maxParallelDials: 2 // ВАЖНО: это предотвращает "набег" на всех пиров из DHT
            },
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
                // directPeers: directPeersList,
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

        console.log(`✅ [HeliaInit] Успешный коннект к релею: ${relay.name || relay.peerId.slice(-6)}`);
        
        // Опционально: если в RelayManager есть метод для фиксации рабочего индекса, вызываем его
        if (typeof (relayManager as any).setActiveIndex === 'function') {
          (relayManager as any).setActiveIndex(currentRelayIndex);
        }

      } catch (error: any) {
        console.warn(`⚠️ [HeliaInit] Не удалось подключиться к релею ${relay.name || relay.peerId.slice(-6)}. Ошибка: ${error.message}`);
        currentRelayIndex++; // Увеличиваем индекс для следующей итерации while
        
        // Зачищаем инстанс, если он упал на полпути
        if (heliaNode) {
          try { await heliaNode.stop(); } catch (e) {}
          heliaNode = null;
        }
      }
    }

    if (!heliaNode) {
      throw new Error("🚨 [HeliaInit] ФАТАЛЬНАЯ ОШИБКА: Ни один релей из пула не доступен!");
    }

    // 4. Запускаем мониторинг!
    relayManager.startMonitoring(heliaNode.libp2p, (newRelay) => {
      // Этот коллбек вызовется при переключении.
      notifyArchivist(heliaNode.libp2p, peerId, newRelay.name);
      console.log(`📢 Оповещаем новый архивариус: ${newRelay.name}`);
    });

    // Это разрубает узел несовместимых версий PeerId/Libp2p между корневыми пакетами и недрами Helia.
    return await heliaNode;
  })();

  return initializationPromise;
}