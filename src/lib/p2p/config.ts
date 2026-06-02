

/* Интерфейсы должен лежать в самом верху файла, чтобы TS видел его до вызова функций */

// Интерфейс для конфигурации релея, который будет использоваться при добавлении релея в пул
export interface RelayConfig {
  name: string;
  peerId: string;
  address: string;
}

// Конфигурация приложения и интерфейсы для типов сообщений и действий в комнате чата.
export type MessageType = 'sent' | 'received' | 'system';

// Интерфейс для сообщений в чате
export interface ChatMessage {
  id: string;
  whoSent: string;
  text: string;
  type: MessageType;
}

// Интерфейс для действий в комнате, который возвращается при присоединении к комнате
export interface RoomActions {
  // или type RoomActions = {
  sendMessage: (message: string) => Promise<void>;
  leaveRoom: () => void;
  pingRoom?: () => void;
  dbAddress: string;
  loadMoreHistory: () => Promise<void>;
  hasMoreHistory: () => boolean;
}

// Интерфейс для записи контакта в базе данных контактов
export interface ContactRecord {
  peerId: string;
  roomDbAddress: string;
  profileDbAddress: string;
  nickname?: string; // Подтягивается динамически
}

export const CONFIG = {
  TOPIC_DISCOVERY: '_peer-discovery._p2p._pubsub', // Топик для обнаружения пиров
  ORBITDB_BLOCKS_DIR: './data/blocks.level', // Директория для хранения блоков OrbitDB
  DATA_DIR: './data', // Директория для хранения данных Helia (включая ключи)
      
  DB_PROFILE: 'user-profile',// Строка 'user-profile' создаст базу локально и привяжет к текущей Identity.
  DB_CONTACTS: 'my-contacts', // Ключ для хранения списка контактов
  KEY_NICKNAME: 'nickname', // Ключ для хранения никнейма в базе профиля
  KEY_DATE_CREATED: 'createdAt', // Ключ для хранения даты создания профиля
  KEY_FINGERPRINT: 'fingerprint', // Ключ для хранения отпечатка устройства
  KEY_IP_ADDRESS: 'ipAddress', // Ключ для хранения IP-адреса

  STORAGE_KEY: 'browser-private-key', // Ключ для хранилища в localStorage, где будет сохраняться seed-фраза в виде base64 строки
  SEED_LENGTH: 32,  // Длина seed для Ed25519 - 32 байта

  MAX_RETRIES: 5, // Максимальное количество попыток подключения
  RELAY_POOL_SIZE: 5, // Размер пула релеев

  SYNC_INTERVAL_MS: 10800000, // Интервал синхронизации с релеями (3 часа)
  INACTIVITY_TIMEOUT_MS: 10 * 60 * 1000, // Время для пинга на сервер (10 минут)

  CHUNK_SIZE: 1, // Сколько сообщений грузить за раз

    MSG: {
    SUCCESS : 'SUCCESS',
    FORBIDDEN : 'FORBIDDEN',
  },

  TOPICS: {
    ANNOUNCE: '/p2p-relay/v1/announce', // Топик для анонсирования адреса базы данных на сервер-Архивариус
    PEER_SYNC_REQUEST: 'peers:sync:request', // Топик для запроса синхронизации с релеями
    PEER_SYNC_RESPONSE_BASE: 'peers:sync:response:', // Базовый топик для ответа синхронизации, к которому будет добавляться ID запрашивающего пира
    PEER_SYNC_REQUEST_TOPIC: 'peers:sync:request', // Топик для запроса синхронизации релеев (можно использовать тот же, что и PEER_SYNC_REQUEST, просто обрабатывать по-разному)
    RPC_PROTOCOL: '/ychat/anti-flood/1.0.0' // Протокол для RPC-метода проверки регистрации (антифрод)
  }
};