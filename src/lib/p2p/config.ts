

export const CONFIG = {
  TOPIC_DISCOVERY: '_peer-discovery._p2p._pubsub', // Топик для обнаружения пиров
  ORBITDB_BLOCKS_DIR: './data/blocks.level', // Директория для хранения блоков OrbitDB
  DATA_DIR: './data', // Директория для хранения данных Helia (включая ключи)
  ORBITDB_DIR: './orbitdb', // Директория для хранения баз OrbitDB
  GLOBAL_REGISTRY_ADDRESS: '', // Адрес глобальной базы профилей (будет установлен при старте)

      
  PROFILE: {
    DB_PROFILE: 'user-profile',// Строка 'user-profile' создаст базу локально и привяжет к текущей Identity.
    DB_CONTACTS: 'my-contacts', // Ключ для хранения списка контактов
    KEY_NICKNAME: 'nickname', // Ключ для хранения никнейма в базе профиля
    KEY_DATE_CREATED: 'createdAt', // Ключ для хранения даты создания профиля
    KEY_BIO: 'user_bio', // Ключ для хранения биографии пользователя в базе профиля
    KEY_LAST_UPDATED: 'lastUpdated', // Ключ для хранения даты последнего обновления профиля
    KEY_AVATAR_CID: 'avatarCID', // Ключ для хранения CID аватара
    KEY_AVATAR_ENCRYPTION_KEY: 'avatar_encryption_key', // Ключ для хранения ключа шифрования аватара
    KEY_SERVER_RELAYS: 'serverRelays', // Ключ для хранения ключа шифрования аватара
    KEY_PRIVACY: 'privacy_mode', // Режим приватности профиля (public, contacts_only, private)
    MSG_PROFILE_UPDATED: 'PROFILE_UPDATED', // Сообщение об обновлении профиля
    BLACKLIST_KEY : 'ychat_blocked_peers', // Ключ для хранения черного списка
    DB_BLACKLIST_KEY : 'encrypted_blacklist', // Ключ для хранения зашифрованного черного списка
    KEY_AVATAR_SERVER_CID: 'avatar_server_cid', // Ключ для хранения серверного CID аватара
    DB_HIDDEN_MESSAGES: 'ychat-hidden-messages', // Ключ для хранения скрытых сообщений
  },

  PREFIX_ROOM: 'room_', // Префикс для имен комнат (для генерации детерминированных имен)

  IS_LOADING: 'ychat_is_logged_in', // Ключ для хранения состояния авторизации
  KEY_GLOBAL_REGISTRY_ADDRESS: 'YCHAT_GLOBAL_REGISTRY_ADDRESS', // Ключ для хранения состояния авторизации
  
  KEY_FINGERPRINT: 'fingerprint', // Ключ для хранения отпечатка устройства
  KEY_IP_ADDRESS: 'ipAddress', // Ключ для хранения IP-адреса
  KEY_LAST_PEER_SYNC: 'last_peer_sync', // Ключ для хранения времени последней синхронизации с релеями
  KEY_KNOWN_RELAYS: 'known_relays', // Ключ для хранения списка известных релеев
  CACHE_NAME_FILES: 'ychat-media-v1',

  STORAGE_KEY: 'browser-private-key', // Ключ для хранилища в localStorage, где будет сохраняться seed-фраза в виде base64 строки
  SEED_LENGTH: 32,  // Длина seed для Ed25519 - 32 байта

  MAX_RETRIES: 5, // Максимальное количество попыток подключения
  RELAY_POOL_SIZE: 3, // Размер пула релеев
  FILE_REPLICATION_FACTOR: 2, // сколько релеев должны подтвердить приём — независимо от RELAY_POOL_SIZE

  SYNC_INTERVAL_MS: 10800000, // Интервал синхронизации с релеями (3 часа)
  INACTIVITY_TIMEOUT_MS: 10 * 60 * 1000, // Время для пинга на сервер (10 минут)
  COOLDOWN_TIME: 30000,   // Кулдаун 30 секунд (в течение этого времени повторные запросы в БД игнорируются)

  CHUNK_SIZE: 15, // Сколько сообщений грузить за раз

  MSG: {
    SUCCESS : 'SUCCESS',
    FORBIDDEN : 'FORBIDDEN',
    WAKEUP : 'WAKEUP_PING',
    MESSAGE_DELETED : 'Сообщение удалено',
    HIDDEN_MESSAGE_LABEL: 'Скрытое сообщение',
  },

  TOPICS: {
    ANNOUNCE: '/p2p-relay/v1/announce', // Топик для анонсирования адреса базы данных на сервер-Архивариус
    PEER_SYNC_REQUEST: 'peers:sync:request', // Топик для запроса синхронизации с релеями
    PEER_SYNC_RESPONSE_BASE: 'peers:sync:response:', // Базовый топик для ответа синхронизации, к которому будет добавляться ID запрашивающего пира
    PROFILE_UPDATES_TOPIC: 'ychat/profiles/updates', // Топик для обновления профилей
    RPC_PROTOCOL: '/ychat/anti-flood/1.0.0', // Протокол для RPC-метода проверки регистрации (антифрод)
    WAKEUP_SYNC_TOPIC: 'peers:wakeup:ping', // Для пробуждения соседей и синхронизации OrbitDB
    ANNOUNCE_NEW_MESSAGE: `ychat-notifications-`, // Топик для анонсирования нового сообщения
  }
};