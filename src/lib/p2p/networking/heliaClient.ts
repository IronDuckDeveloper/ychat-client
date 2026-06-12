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

    const blockstore = new LevelBlockstore(CONFIG.ORBITDB_BLOCKS_DIR);
    const datastore = new LevelDatastore(CONFIG.DATA_DIR);

    await blockstore.open();
    await datastore.open();

    console.log('📦 [Client IPFS] Хранилища IndexedDB успешно открыты.');

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
            },
            connectionEncryption: [noise()],
            streamMuxers: [yamux()],
            connectionGater: { denyDialMultiaddr: () => false },
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

      } catch (error: any) {
        console.warn(`⚠️ [HeliaInit] Не удалось подключиться к релею ${relay.name || relay.peerId.slice(-6)}. Ошибка: ${error.message}`);
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
    relayManager.startMonitoring(heliaNode.libp2p, (newRelay) => {
      notifyArchivist(heliaNode.libp2p, peerId, newRelay.name);
      console.log(`📢 Оповещаем новый архивариус: ${newRelay.name}`);
    });

    return await heliaNode;
  })();

  return initializationPromise;
}