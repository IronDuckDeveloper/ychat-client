import { createHelia } from 'helia';
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { privateKeyFromRaw } from '@libp2p/crypto/keys';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { bootstrap } from '@libp2p/bootstrap';
import { peerIdFromString } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import peersConfig from './known-peers.json'; // Путь к твоему файлу

const BROWSER_KEY_HEX = 'browser-private-key-raw-hex';
const topicDiscovery = '_peer-discovery._p2p._pubsub';
// Хранилище счетчиков вне функции, чтобы они не обнулялись
const retryMap = new Map();
const MAX_RETRIES = 5;

// Формируем список для bootstrap (просто массив полных multiaddr с ID)
const bootstrapList = (peersConfig.relays || [])
  .map((r) => {
    const fullAddr = `${r.address}/p2p/${r.peerId}`;
    try {
      // ПРОВЕРКА 1: Валидность всей multiaddr строки
      multiaddr(fullAddr);

      // ПРОВЕРКА 2: Валидность только PeerID (именно тут падает Bootstrap сервис)
      // Если тут лишний символ, функция выбросит "Incorrect length"
      peerIdFromString(r.peerId);

      // Если обе проверки прошли — адрес "здоров"
      return fullAddr;
    } catch (e: any) {
      // Если хоть одна проверка упала — выкидываем этот адрес нафиг
      console.error(`❌ [Config Error] Релей "${r.name}" удален из списка: ${e.message}`);
      return null;
    }
  })
  .filter((addr): addr is string => addr !== null);

// Формируем список для directPeers (массив объектов {id, addrs})
const directPeersList = (peersConfig.relays || [])
  .map((r) => {
    try {
      // Проверяем оба компонента
      const id = peerIdFromString(r.peerId);
      const maddr = multiaddr(r.address);
      
      return { id, addrs: [maddr] };
    } catch (e) {
      return null; // Ошибку мы уже залогировали выше
    }
  })
  .filter((p): p is { id: any; addrs: any[] } => p !== null);

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const fromHex = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

let initializationPromise: Promise<any> | null = null;

async function getOrCreatePrivateKey() {
  const savedPrivateKeyHex = localStorage.getItem(BROWSER_KEY_HEX);

  if (savedPrivateKeyHex) {
    try {
      const rawPrivateBytes = fromHex(savedPrivateKeyHex);
      const privateKey = privateKeyFromRaw(rawPrivateBytes);
      console.log('✅ Приватный ключ восстановлен из localStorage');
      return privateKey;
    } catch (e: any) {
      console.warn('⚠️ Ошибка восстановления ключа:', e.message);
      localStorage.removeItem(BROWSER_KEY_HEX);
    }
  }

  const key = await generateKeyPair('Ed25519');
  const rawPrivateBytes = key.raw;
  localStorage.setItem(BROWSER_KEY_HEX, toHex(rawPrivateBytes));
  console.log('🚀 Сгенерирован новый приватный ключ');

  return key;
}

export async function createBrowserHelia() {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const privateKey = await getOrCreatePrivateKey();

    const libp2p = await createLibp2p({
      privateKey,
      addresses: {
        listen: [
          '/webrtc',
          '/p2p-circuit', // Обязательно для работы через Relay
        ],
      },
      peerDiscovery: [
        pubsubPeerDiscovery({
          interval: 10000,
          topics: [topicDiscovery], // Сервер и браузер должны иметь одинаковый топик
          listenOnly: false,
        }),
        bootstrap({
          list: bootstrapList, // Добавляем серверы в список начальной загрузки
        }),
      ],
      transports: [webSockets(), webRTC(), circuitRelayTransport()],
      connectionManager: {
        maxConnections: 50,
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
          // Принудительное соединение между твоими серверами-реле
          directPeers: directPeersList,
          // ✅ Отключение скоринга (браузеры не должны пессимизироваться)
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
          allowPublishToZeroTopicPeers: true,
        }),
      },
    });

    // После создания ноды, но до её старта
    bootstrapList.forEach((addr) => {
      // Извлекаем PeerId из строки адреса
      const peerIdStr = addr.split('/p2p/')[1];
      if (peerIdStr) {
        const peerId = peerIdFromString(peerIdStr);

        // Помечаем сервер как "важный", чтобы ConnectionManager его не отключал
        libp2p.peerStore
          .merge(peerId, {
            tags: {
              'keep-alive': { value: 100 }, // Приоритет выше 50 обычно защищает от обрыва
            },
          })
          .catch(console.error);
      }
    });

    const ensureConnections = async () => {
      // 1. Получаем список тех, с кем мы УЖЕ соединены прямо сейчас
      const connectedPeers = libp2p.getPeers().map((p) => p.toString());

      for (const addrStr of bootstrapList) {
        const parts = addrStr.split('/p2p/');
        const peerIdStr = parts[1];
        const currentRetry = retryMap.get(peerIdStr) || 0;

        if (peerIdStr) {
          try {
            const peerId = peerIdFromString(peerIdStr);

            // 2. Помечаем как важного (чтобы не кикнуло при лимите соединений)
            await libp2p.peerStore.merge(peerId, {
              tags: { 'keep-alive': { value: 100 } },
            });

            // 1. Сначала проверяем, не подключены ли мы уже (чтобы не спамить)
            const alreadyConnected = libp2p
              .getPeers()
              .some((p) => p.toString() === peerIdStr);
            if (alreadyConnected) {
              // Если уже в списке пиров — сбрасываем счетчик и выходим
              retryMap.set(peerIdStr, 0);
              return;
            }

            // 2. Проверяем валидность PeerID (чтобы не было "Ф" и прочих чудес)
            try {
              // Попытка распарсить ID. Если он кривой, вылетит ошибка здесь
              peerIdFromString(peerIdStr);
            } catch (e) {
              console.error(
                `❌ [Abort] PeerID ${peerIdStr} невалиден. Проверь конфиг!`,
              );
              retryMap.set(peerIdStr, MAX_RETRIES); // Блокируем попытки
              return;
            }

            // 3. САМОЕ ВАЖНОЕ: Если в списке активных соединений этого сервера нет — звоним ему!
            if (!connectedPeers.includes(peerIdStr)) {
              // Используем multiaddr из строки, чтобы libp2p знал, куда именно стучаться (IP/Порт)
              if (currentRetry < MAX_RETRIES) {
                try {
                  const maddr = multiaddr(addrStr);
                  console.log(
                    `📡 [Dial] Попытка ${currentRetry + 1}: Стучимся к ${peerIdStr.slice(-6)}...`,
                  );

                  // dial возвращает connection. Мы ждем его.
                  await libp2p.dial(maddr, {
                    signal: AbortSignal.timeout(5000),
                  });

                  // ВАЖНО: После dial даем системе 500мс "прийти в себя"
                  // и провести Identify протокол, прежде чем объявлять успех
                  await new Promise((r) => setTimeout(r, 500));

                  if (
                    libp2p.getPeers().some((p) => p.toString() === peerIdStr)
                  ) {
                    console.log(
                      `✅ [Success] Узел ${peerIdStr.slice(-6)} полностью подтвержден в сети`,
                    );
                    retryMap.set(peerIdStr, 0);
                  } else {
                    // Если dial прошел, но в списке пиров его нет — значит Identity не прошел
                    throw new Error(
                      'PeerID mismatch or connection dropped during handshake',
                    );
                  }
                } catch (err: any) {
                  const nextRetry = currentRetry + 1;
                  retryMap.set(peerIdStr, nextRetry);

                  const delay = Math.min(1000 * Math.pow(2, nextRetry), 30000);
                  console.warn(
                    `⚠️ [Dial] Ошибка подключения к ${peerIdStr.slice(-6)}: ${err.message}. Ждем ${delay / 1000}с`,
                  );

                  await new Promise((r) => setTimeout(r, delay));
                }
              } else {
                console.log(
                  `🚫 [Dial] Превышено число попыток для ${peerIdStr.slice(-6)}. Узел игнорируется.`,
                );
              }
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

    return await createHelia({ libp2p });
  })();

  return initializationPromise;
}
