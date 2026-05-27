

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
  MAX_RETRIES: 5,
  RELAY_POOL_SIZE: 5,
  SYNC_INTERVAL_MS: 10800000, // 3 часа
  TOPICS: {
    ANNOUNCE: '/p2p-relay/v1/announce',
    PEER_SYNC_REQUEST: 'peers:sync:request',
    PEER_SYNC_RESPONSE_BASE: 'peers:sync:response:',
  }
};