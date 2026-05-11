import { createHelia } from 'helia'
import { createLibp2p } from 'libp2p'
import { webSockets } from '@libp2p/websockets'
import { webRTC } from '@libp2p/webrtc'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { privateKeyFromRaw } from '@libp2p/crypto/keys'
import { generateKeyPair } from '@libp2p/crypto/keys'
// import { floodsub } from '@libp2p/floodsub'
import { bootstrap } from '@libp2p/bootstrap'
import { peerIdFromString } from '@libp2p/peer-id'
import { multiaddr } from '@multiformats/multiaddr';
import type { Multiaddr } from '@multiformats/multiaddr';
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'

const BROWSER_KEY_HEX = 'browser-private-key-raw-hex'

const relayAddrs = [
    '/ip4/62.109.15.216/tcp/15002/ws/p2p/12D3KooWJRcBbBUGG796f1vbNrXwUhKHuL4D96quu2oPMSU4krob',
    '/ip4/38.180.0.13/tcp/15002/ws/p2p/12D3KooWEAwRLAupFG9CDjedaLAvYAsNdpbh74N41ATzEJSnHvgs'
]

// Обязательно добавляем /p2p/PeerID в конец
const addr1: Multiaddr = multiaddr('/ip4/38.180.0.13/tcp/15002/ws/p2p/12D3KooWEAwRLAupFG9CDjedaLAvYAsNdpbh74N41ATzEJSnHvgs');
const addr2: Multiaddr = multiaddr('/ip4/62.109.15.216/tcp/15002/ws/p2p/12D3KooWJRcBbBUGG796f1vbNrXwUhKHuL4D96quu2oPMSU4krob');

const id_addr1 = '12D3KooWEAwRLAupFG9CDjedaLAvYAsNdpbh74N41ATzEJSnHvgs';
const id_addr2 = '12D3KooWJRcBbBUGG796f1vbNrXwUhKHuL4D96quu2oPMSU4krob';

const topicDiscovery = '_peer-discovery._p2p._pubsub';


const toHex = (bytes: Uint8Array) => 
  Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')

const fromHex = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

let initializationPromise: Promise<any> | null = null

async function getOrCreatePrivateKey() {
  const savedPrivateKeyHex = localStorage.getItem(BROWSER_KEY_HEX)

  if (savedPrivateKeyHex) {
    try {
      const rawPrivateBytes = fromHex(savedPrivateKeyHex)
      const privateKey = privateKeyFromRaw(rawPrivateBytes)
      console.log('✅ Приватный ключ восстановлен из localStorage')
      return privateKey
    } catch (e: any) {
      console.warn('⚠️ Ошибка восстановления ключа:', e.message)
      localStorage.removeItem(BROWSER_KEY_HEX)
    }
  }

  const key = await generateKeyPair('Ed25519')
  const rawPrivateBytes = key.raw
  localStorage.setItem(BROWSER_KEY_HEX, toHex(rawPrivateBytes))
  console.log('🚀 Сгенерирован новый приватный ключ')

  return key
}

export async function createBrowserHelia() {
  if (initializationPromise) {
    return initializationPromise
  }

  initializationPromise = (async () => {
    const privateKey = await getOrCreatePrivateKey()

    const libp2p = await createLibp2p({
      privateKey,
      addresses: {
      listen: [
        '/webrtc', 
        '/p2p-circuit' // Обязательно для работы через Relay
      ]
    },
    peerDiscovery: [
      pubsubPeerDiscovery({
        interval: 10000,
        topics: [topicDiscovery], // Сервер и браузер должны иметь одинаковый топик
        listenOnly: false
      }),
      bootstrap({
        list: relayAddrs // Добавляем серверы в список начальной загрузки
      })
    ],
      transports: [
        webSockets(),
        webRTC(),
        circuitRelayTransport()
      ],
      connectionManager: {
        maxConnections: 50
      },
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      connectionGater: {
        denyDialMultiaddr: () => false,
      },
      services: {
        identify: identify(),
        // pubsub: floodsub(),
        pubsub: gossipsub({
           // ✅ Включить PX
            doPX: true,          
           // ✅ Параметры Mesh
            D: 3,
            Dlo: 2,
            Dhi: 5,
            Dscore: 1,
            heartbeatInterval: 1000,
              directPeers: [
                {
                 id: peerIdFromString(id_addr1), // ID Сервера 1
                  addrs: [addr1 as any],
                },
                  {
                  id: peerIdFromString(id_addr2), // ID Сервера 2
                    addrs: [addr2 as any]
                }
              ],
           // ✅ Отключение скоринга (браузеры не должны пессимизироваться)
            scoreThresholds: {
              gossipThreshold: -Infinity,
              publishThreshold: -Infinity,
              graylistThreshold: -Infinity,
              acceptPXThreshold: -Infinity,
              opportunisticGraftThreshold: -Infinity
            },
            scoreParams: {
              IPColocationFactorWeight: 0,
              behaviourPenaltyWeight: 0
            },
            fallbackToFloodsub: true,
            allowPublishToZeroTopicPeers: true,
        }), 
      }
    })

    // После создания ноды, но до её старта
relayAddrs.forEach(addr => {
  // Извлекаем PeerId из строки адреса
  const peerIdStr = addr.split('/p2p/')[1]
  if (peerIdStr) {
    const peerId = peerIdFromString(peerIdStr)
    
    // Помечаем сервер как "важный", чтобы ConnectionManager его не отключал
    libp2p.peerStore.merge(peerId, {
      tags: {
        'keep-alive': { value: 100 } // Приоритет выше 50 обычно защищает от обрыва
      }
    }).catch(console.error)
  }
})


  const ensureConnections = async () => {
  // 1. Получаем список тех, с кем мы УЖЕ соединены прямо сейчас
  const connectedPeers = libp2p.getPeers().map(p => p.toString());

  for (const addrStr of relayAddrs) {
    const parts = addrStr.split('/p2p/');
    const peerIdStr = parts[1];

    if (peerIdStr) {
      try {
        const peerId = peerIdFromString(peerIdStr);

        // 2. Помечаем как важного (чтобы не кикнуло при лимите соединений)
        await libp2p.peerStore.merge(peerId, {
          tags: { 'keep-alive': { value: 100 } }
        });

        // 3. САМОЕ ВАЖНОЕ: Если в списке активных соединений этого сервера нет — звоним ему!
        if (!connectedPeers.includes(peerIdStr)) {
          console.log(`🔄 Реконнект: Сервер ${peerIdStr.slice(-6)} недоступен. Пытаюсь подключиться...`);
          // Используем multiaddr из строки, чтобы libp2p знал, куда именно стучаться (IP/Порт)
          await libp2p.dial(multiaddr(addrStr)); 
        }
      } catch (e: any) {
        // Ошибки игнорируем, чтобы цикл не прерывался (например, если сервер оффлайн)
        // console.error(`Ошибка при попытке связи с ${addrStr}:`, e.message);
      }
    }
  }
};

    // Запускаем проверку каждые 10 секунд
    setInterval(ensureConnections, 10000);
    // И первый запуск чуть позже старта, чтобы дать ноде инициализироваться
    setTimeout(ensureConnections, 2000);

    return await createHelia({ libp2p })
  })()

  return initializationPromise
}