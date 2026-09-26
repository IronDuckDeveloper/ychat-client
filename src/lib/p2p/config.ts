

export const CONFIG = {
  TOPIC_DISCOVERY: '_peer-discovery._p2p._pubsub', // Топик для обнаружения пиров
  ORBITDB_BLOCKS_DIR: './data/blocks.level', // Директория для хранения блоков OrbitDB
  DATA_DIR: './data', // Директория для хранения данных Helia (включая ключи)
  ORBITDB_DIR: './orbitdb', // Директория для хранения баз OrbitDB
  GLOBAL_REGISTRY_ADDRESS: '', // Адрес глобальной базы профилей (будет установлен при старте)
  VAPID_PUBLIC_KEY: 'BEHw3EO2DZbAL4iFwJCYdPWa9hlKN7-j4IZ6IOeGQ_aj4HyPrTw0--p-l0Gf-xuAPPeW0U82pZx05naISNiFC_0', // Публичный ключ VAPID для Push-уведомений

      
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
  KEY_PROFILE_DB_ADDRESS_PREFIX: 'ychat_profile_addr_', // + identity.id, чтобы не путать аккаунты на одном устройстве
  KEY_PENDING_NICKNAME: 'ychat_pending_nickname', // Никнейм для регистрации, ждёт App.tsx после хардредиректа
  KEY_AUTH_ERROR: 'ychat_auth_error', // Ошибка неудачной регистрации, показывается один раз на /  после отката

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

  URL: {
    PREFIX_HTTP: 'https://', // Префикс для URL-адреса
  },

  MSG: {
    SUCCESS : 'SUCCESS',
    FORBIDDEN : 'FORBIDDEN',
    WAKEUP : 'WAKEUP_PING',
    MESSAGE_DELETED : '__MESSAGE_DELETED__', // Языконезависимый маркер для БД. Текст переводится в момент рендера через t('chat.messageDeletedLabel')
    HIDDEN_MESSAGE_LABEL: '__HIDDEN_MESSAGE__', // Аналогично — маркер, не текст
  },

  TOPICS: {
    ANNOUNCE: '/p2p-relay/v1/announce', // Топик для анонсирования адреса базы данных на сервер-Архивариус
    PEER_SYNC_REQUEST: 'peers:sync:request', // Топик для запроса синхронизации с релеями
    PEER_SYNC_RESPONSE_BASE: 'peers:sync:response:', // Базовый топик для ответа синхронизации, к которому будет добавляться ID запрашивающего пира
    RPC_PROTOCOL: '/ychat/anti-flood/1.0.0', // Протокол для RPC-метода проверки регистрации (антифрод)
    WAKEUP_SYNC_TOPIC: 'peers:wakeup:ping', // Для пробуждения соседей и синхронизации OrbitDB
    PROFILE_MAILBOX_PREFIX: 'ychat/profiles/mailbox/', // Для обновления контакта + peerId получателя и анонсирования нового сообщения
    CONTACT_REQUEST_DEPOSIT: '/ychat/contact-request/1.0.0', // Положить запрос в контакты на релей
    CONTACT_REQUEST_FETCH: '/ychat/contact-requests-fetch/1.0.0', // Забрать свои запросы с релея
    PUSH_SUBSCRIBE: '/ychat/push-subscribe/1.0.0', // Подписаться на Web Push
    PUSH_UNSUBSCRIBE: '/ychat/push-unsubscribe/1.0.0', // Отписаться от Web Push
    PUSH_NOTIFY: '/ychat/push-notify/1.0.0', // Уведомление Web Push
  }
};