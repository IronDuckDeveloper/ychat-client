

// 1. Интерфейс должен лежать в самом верху файла, чтобы TS видел его до вызова функций
export interface RelayConfig {
  name: string;
  peerId: string;
  address: string;
}

export type MessageType = 'sent' | 'received' | 'system';

export interface ChatMessage {
  id: string;
  whoSent: string;
  text: string;
  type: MessageType;
}

export interface RoomActions {
  // или type RoomActions = {
  sendMessage: (message: string) => Promise<void>;
  leaveRoom: () => void;
  pingRoom?: () => void;
  dbAddress: string;
  loadMoreHistory: () => Promise<void>;
  hasMoreHistory: () => boolean;
}

export const CONFIG = {
  TOPIC_DISCOVERY: '_peer-discovery._p2p._pubsub', // Топик для обнаружения пиров
  ORBITDB_BLOCKS_DIR: './data/blocks.level', // Директория для хранения блоков OrbitDB
  DATA_DIR: './data', // Директория для хранения данных Helia (включая ключи)
      
  DB_PROFILE: 'user-profile',// Строка 'user-profile' создаст базу локально и привяжет к текущей Identity.
  KEY_NICKNAME: 'nickname', // Ключ для хранения никнейма в базе профиля
  KEY_DATE_CREATED: 'createdAt', // Ключ для хранения даты создания профиля

  STORAGE_KEY: 'browser-private-key', // Ключ для хранилища в localStorage, где будет сохраняться seed-фраза в виде base64 строки
  SEED_LENGTH: 32,  // Длина seed для Ed25519 - 32 байта

  MAX_RETRIES: 5, // Максимальное количество попыток подключения
  RELAY_POOL_SIZE: 5, // Размер пула релеев

  SYNC_INTERVAL_MS: 10800000, // Интервал синхронизации с релеями (3 часа)
  INACTIVITY_TIMEOUT_MS: 10 * 60 * 1000, // Время для пинга на сервер (10 минут)

  CHUNK_SIZE: 1, // Сколько сообщений грузить за раз

  TOPICS: {
    ANNOUNCE: '/p2p-relay/v1/announce',
    PEER_SYNC_REQUEST: 'peers:sync:request',
    PEER_SYNC_RESPONSE_BASE: 'peers:sync:response:',
    PEER_SYNC_REQUEST_TOPIC: 'peers:sync:request'

  }
};