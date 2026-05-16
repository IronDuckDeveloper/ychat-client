import { multiaddr } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';
import peersConfig from '../known-peers.json';

// 1. Интерфейс должен лежать в самом верху файла, чтобы TS видел его до вызова функций
export interface RelayConfig {
  name: string;
  peerId: string;
  address: string;
}

export const CONFIG = {
  BROWSER_KEY_HEX: 'browser-private-key-raw-hex',
  TOPIC_DISCOVERY: '_peer-discovery._p2p._pubsub',
  MAX_RETRIES: 5,
  SYNC_INTERVAL_MS: 10800000, // 3 часа
  TOPICS: {
    ANNOUNCE: 'rooms:announce',
    PEER_SYNC_REQUEST: 'peers:sync:request',
    PEER_SYNC_RESPONSE_BASE: 'peers:sync:response:'
  }
};

// Валидируем и собираем bootstrapList
export const bootstrapList: string[] = (peersConfig.relays || [])
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

// Валидируем и собираем directPeersList
export const directPeersList: any[] = (peersConfig.relays || [])
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