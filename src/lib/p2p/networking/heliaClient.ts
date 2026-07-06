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
import { LevelBlockstore } from 'blockstore-level'; 
import { LevelDatastore } from 'datastore-level';
import { getPrivateKey } from '../crypto/crypto';
import { bitswap } from '@helia/block-brokers';
import { all } from '@libp2p/websockets/filters';
import { peerIdFromKeys } from '@libp2p/peer-id';
import { ping } from '@libp2p/ping';
import { RelayManager } from './RelayManager.ts';
import peersConfig from '../../known-peers.json';
import { CONFIG } from '../config.ts';
import { notifyArchivist } from './connectionManager.ts';
import { kadDHT } from '@libp2p/kad-dht';
import { broadcastMyProfile } from '../services/authService.ts';

let initializationPromise: Promise<any> | null = null;

// Экспортируем СИНГЛТОН менеджера, чтобы другие сервисы (initService) могли к нему обращаться
export const relayManager = new RelayManager(
  peersConfig.relays,
  CONFIG.RELAY_POOL_SIZE
);

export function createBrowserHelia(): Promise<any> {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    const privateKey = await getPrivateKey();
    const peerId = await peerIdFromKeys(
      privateKey.public.bytes,
      privateKey.bytes,
    );
    
    // Получаем строковое представление PeerID для создания уникальных папок
    const peerIdStr = peerId.toString();

    // ИЗОЛЯЦИЯ: Добавляем PeerID к путям хранилищ, чтобы аккаунты не конфликтовали
    const blockstore = new LevelBlockstore(`${CONFIG.ORBITDB_BLOCKS_DIR}-${peerIdStr}`);
    const datastore = new LevelDatastore(`${CONFIG.DATA_DIR}-${peerIdStr}`);

    await blockstore.open();
    await datastore.open();

    console.log(`📦 [Client IPFS] Хранилища IndexedDB (${peerIdStr.slice(-6)}) успешно открыты.`);

    let heliaNode: any = null;
    let currentRelayIndex = 0;

    // Забираем пул напрямую из публичного метода или свойства RelayManager
    const pool = relayManager.getPool();

    while (!heliaNode && currentRelayIndex < pool.length) {
      const relay = pool[currentRelayIndex];
      const bootstrapAddresses = [`${relay.address}/p2p/${relay.peerId}`];
      console.log(`🚀 [HeliaInit] Пробуем запустить ноду через релей: ${relay.name || relay.peerId.slice(-6)}`);

      try {
        heliaNode = await createHelia({
          blockstore: blockstore,
          datastore: datastore as any,
          blockBrokers: [bitswap()],
          libp2p: {
            privateKey: privateKey,
            peerId: peerId,
            addresses: { listen: ['/webrtc'] },
            peerDiscovery: [
              pubsubPeerDiscovery({
                interval: 10000,
                topics: [CONFIG.TOPIC_DISCOVERY],
                listenOnly: false,
              }),
              bootstrap({ list: bootstrapAddresses }),
            ],
            transports: [
              webSockets({ filter: all }),
              webRTC(),
              circuitRelayTransport({ discoverRelays: 5 }),
            ],
            connectionManager: {
              minConnections: 1,
              maxConnections: 5,
              maxParallelDials: 2,
              dialTimeout: 10000,
            },
            connectionEncryption: [noise()],
            streamMuxers: [yamux()],
            
            // 🟢 ИЗМЕНЕНО: Подключаем вахтера (Connection Gater) к нашему карантину
            connectionGater: { 
              denyDialMultiaddr: (multiaddr) => {
                const targetPeerId = multiaddr.getPeerId();
                if (targetPeerId && relayManager.isRelayFailed(targetPeerId)) {
                  // Отменяем дозвон до релея, который сейчас в карантине
                  return true; 
                }
                return false; 
              } 
            },
            
            services: {
              identify: identify(),
              ping: ping(),
              dht: kadDHT({
                clientMode: true,
                kBucketSize: 20,
                validators: {},
                selectors: {},
              }),
              pubsub: gossipsub({
                doPX: true,
                D: 3,
                Dlo: 2,
                Dhi: 5,
                Dscore: 1,
                heartbeatInterval: 1000,
                scoreThresholds: {
                  gossipThreshold: -Infinity,
                  publishThreshold: -Infinity,
                  graylistThreshold: -Infinity,
                  acceptPXThreshold: -Infinity,
                  opportunisticGraftThreshold: -Infinity,
                },
                scoreParams: {
                  IPColocationFactorWeight: 0,
                  behaviourPenaltyWeight: 0,
                },
                fallbackToFloodsub: true,
                allowPublishToZeroPeers: true,
              }),
            },
          },
        });

        console.log(`✅ [HeliaInit] Успешный коннект к релею: ${relay.name || relay.peerId.slice(-6)}`);

        // Фиксируем успешный индекс в менеджере
        relayManager.setActiveIndex(currentRelayIndex);
        // Размораживаем UI
        window.dispatchEvent(new CustomEvent('networkStatus', { detail: { stable: true } }));

      } catch (error: any) {
        console.warn(`⚠️ [HeliaInit] Не удалось подключиться к релею ${relay.name || relay.peerId.slice(-6)}. Ошибка: ${error.message}`);
        
        // 🟢 ДОБАВЛЕНО: Если при старте релей лежит, сразу кидаем его в карантин
        relayManager.markRelayFailed(relay.peerId);
        
        currentRelayIndex++; 

        if (heliaNode) {
          try { await heliaNode.stop(); } catch (e) {}
          heliaNode = null;
        }
      }
    }

    if (!heliaNode) {
      throw new Error('🚨 [HeliaInit] ФАТАЛЬНАЯ ОШИБКА: Ни один релей из пула не доступен!');
    }

    // Запускаем мониторинг именно здесь, один раз
    relayManager.startMonitoring(heliaNode.libp2p, async (newRelay) => {
      notifyArchivist(heliaNode.libp2p, peerId, newRelay.name);
      console.log(`📢 Оповещаем новый архивариус: ${newRelay.name}`);

      if (heliaNode) {
        try {
          const pubsub = heliaNode.libp2p.services.pubsub;
          
          // 1. Принудительно публикуем запрос синхронизации пиров
          await pubsub.publish( 
            CONFIG.TOPICS.WAKEUP_SYNC_TOPIC,
            new TextEncoder().encode(JSON.stringify({ type: CONFIG.MSG.WAKEUP }))
          );

          // 2. Дергаем публикацию профиля. 
          await broadcastMyProfile(); 
          
          console.log('🔄 [Network Fix] Меш PubSub и базы OrbitDB успешно переинициализированны на новом релее.');
        } catch (pubSubRefreshError) {
          console.error('❌ [Network Fix] Не удалось обновить меш подписок или базы:', pubSubRefreshError);
        }
      }
    });
    return await heliaNode;
  })();

  return initializationPromise;
}