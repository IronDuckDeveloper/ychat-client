

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
  ts: number;
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

export interface ContactItem {
  id: string;               // PeerID контакта
  profileDbAddress: string; // Адрес его OrbitDB с профилем
  chatDbAddress: string;    // Адрес вашей общей базы сообщений (eventlog)
  nickname: string;         // Кэш никнейма для моментального UI
  avatarCid: string;        // Кэш аватара для моментального UI
  updatedAt: number;        // Таймстемп (для сортировки списка чатов)
  lastMessage?: string; // Текст последнего сообщения
  lastMessageTime?: number; // Таймстемп последнего сообщения
  unreadCount?: number; // Количество непрочитанных сообщений
  isBlocked?: boolean; // Флаг блокировки
  isDeleted?: boolean; // Флаг удаления
}

export type PrivacyType = 'public' | 'contacts_only' | 'private';

export const CONFIG = {
  TOPIC_DISCOVERY: '_peer-discovery._p2p._pubsub', // Топик для обнаружения пиров
  ORBITDB_BLOCKS_DIR: './data/blocks.level', // Директория для хранения блоков OrbitDB
  DATA_DIR: './data', // Директория для хранения данных Helia (включая ключи)
  ORBITDB_DIR: './orbitdb', // Директория для хранения баз OrbitDB
      
  PROFILE: {
    DB_PROFILE: 'user-profile',// Строка 'user-profile' создаст базу локально и привяжет к текущей Identity.
    DB_CONTACTS: 'my-contacts', // Ключ для хранения списка контактов
    KEY_NICKNAME: 'nickname', // Ключ для хранения никнейма в базе профиля
    KEY_DATE_CREATED: 'createdAt', // Ключ для хранения даты создания профиля
    KEY_BIO: 'user_bio', // Ключ для хранения биографии пользователя в базе профиля
    KEY_LAST_UPDATED: 'lastUpdated', // Ключ для хранения даты последнего обновления профиля
    KEY_AVATAR_CID: 'avatarCID', // Ключ для хранения CID аватара
    KEY_PRIVACY: 'privacy_mode', // Режим приватности профиля (public, contacts_only, private)
    MSG_PROFILE_UPDATED: 'PROFILE_UPDATED', // Сообщение об обновлении профиля
    MSG_PROFILE_REQUEST: 'PROFILE_REQUEST', // Сообщение об прозьбе обновить профиль
    BLACKLIST_KEY : 'ychat_blocked_peers', // Ключ для хранения черного списка
    DB_BLACKLIST_KEY : 'encrypted_blacklist', // Ключ для хранения зашифрованного черного списка
  },

  IS_LODING: 'ychat_is_logged_in', // Ключ для хранения состояния авторизации
  
  KEY_FINGERPRINT: 'fingerprint', // Ключ для хранения отпечатка устройства
  KEY_IP_ADDRESS: 'ipAddress', // Ключ для хранения IP-адреса

  STORAGE_KEY: 'browser-private-key', // Ключ для хранилища в localStorage, где будет сохраняться seed-фраза в виде base64 строки
  SEED_LENGTH: 32,  // Длина seed для Ed25519 - 32 байта

  MAX_RETRIES: 5, // Максимальное количество попыток подключения
  RELAY_POOL_SIZE: 5, // Размер пула релеев

  SYNC_INTERVAL_MS: 10800000, // Интервал синхронизации с релеями (3 часа)
  INACTIVITY_TIMEOUT_MS: 10 * 60 * 1000, // Время для пинга на сервер (10 минут)
  COOLDOWN_TIME: 30000,   // Кулдаун 30 секунд (в течение этого времени повторные запросы в БД игнорируются)

  CHUNK_SIZE: 1, // Сколько сообщений грузить за раз

  MSG: {
    SUCCESS : 'SUCCESS',
    FORBIDDEN : 'FORBIDDEN',
    WAKEUP : 'WAKEUP_PING',
  },

  TOPICS: {
    ANNOUNCE: '/p2p-relay/v1/announce', // Топик для анонсирования адреса базы данных на сервер-Архивариус
    PEER_SYNC_REQUEST: 'peers:sync:request', // Топик для запроса синхронизации с релеями
    PEER_SYNC_RESPONSE_BASE: 'peers:sync:response:', // Базовый топик для ответа синхронизации, к которому будет добавляться ID запрашивающего пира
    PROFILE_UPDATES_TOPIC: 'ychat/profiles/updates', // Топик для обновления профилей
    RPC_PROTOCOL: '/ychat/anti-flood/1.0.0', // Протокол для RPC-метода проверки регистрации (антифрод)
    WAKEUP_SYNC_TOPIC: 'peers:wakeup:ping', // Для пробуждения соседей и синхронизации OrbitDB
    ANNOUNCE_NEW_MESSAGE: `ychat-notifications-` // Топик для анонсирования нового сообщения
  }
};