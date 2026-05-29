

// 1. Интерфейс должен лежать в самом верху файла, чтобы TS видел его до вызова функций
export interface RelayConfig {
  name: string;
  peerId: string;
  address: string;
}

export const CONFIG = {
  BROWSER_KEY_HEX: 'browser-private-key-raw-hex',
  TOPIC_DISCOVERY: '_peer-discovery._p2p._pubsub',
  ORBITDB_BLOCKS_DIR: './data/blocks.level',
  DATA_DIR: './data',
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