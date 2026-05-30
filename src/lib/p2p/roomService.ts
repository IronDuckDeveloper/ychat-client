import type { Helia } from 'helia';
import type { Libp2p, PeerId } from '@libp2p/interface';
import { createOrbitDB, OrbitDBAccessController, Identities } from '@orbitdb/core'; // Импортируем OrbitDB!
import { CONFIG } from './config';
import { notifyArchivist } from './connectionManager';
import { RelayManager } from './RelayManager';
import { relayManager } from './heliaClient.js';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

export type MessageType = 'sent' | 'received' | 'system';

export interface ChatMessage {
  id: string;
  whoSent: string;
  text: string;
  type: MessageType;
}

export interface RoomActions { // или type RoomActions = {
  sendMessage: (message: string) => Promise<void>;
  leaveRoom: () => void;
  pingRoom?: () => void;
  dbAddress: string;
  loadMoreHistory: () => Promise<void>;
  hasMoreHistory: () => boolean;
}

// 1. Создаем кастомный провайдер, который напрямую использует ключи Helia
// 1. Наш кастомный провайдер с явными типами (any)
const HeliaIdentityProvider = {
  getId: async (options: any) => options.id,
  async createIdentity(options: any) {
    const { id, helia } = options;
    const privateKey = helia.libp2p.privateKey;
    const peerIdStr = helia.libp2p.peerId.toString();
    
    const idSignatureBytes = await privateKey.sign(new TextEncoder().encode(id));
    const idSignature = uint8ArrayToString(idSignatureBytes, 'hex');

    return {
      id,
      publicKey: peerIdStr,
      signatures: {
        id: idSignature,
        publicKey: idSignature 
      },
      type: 'helia',
      sign: async (data: Uint8Array) => {
        const sig = await privateKey.sign(data);
        return uint8ArrayToString(sig, 'hex');
      },
      verify: async (_sig: string, _pub: string, _data: Uint8Array) => true
    };
  },
  async verifyIdentity(_identity: any) {
    return true;
  }
};

// Храним синглтон инстанса OrbitDB, чтобы не создавать его заново при смене комнат
let orbitdbInstance: any = null;

export async function getOrbitDB(helia: any) {
  if (orbitdbInstance) return orbitdbInstance;

  try {
    const peerIdString = helia.libp2p.peerId.toString();

    // Регистрируем провайдер напрямую в менеджере Identities
    const identities = await Identities({ 
      ipfs: helia,
      identities: {
        helia: HeliaIdentityProvider
      }
    });
    
    console.log(`🔑 [OrbitDB] Создаем Identity через Helia ключи для: ${peerIdString}`);

    const identity = await identities.createIdentity({
      id: peerIdString,
      type: 'helia',
      helia: helia
    });

    orbitdbInstance = await createOrbitDB({ 
      ipfs: helia,
      identity: identity, 
    });

    return orbitdbInstance;
  } catch (error) {
    console.error('❌ [OrbitDB] Ошибка инициализации:', error);
    throw error;
  }
}


export async function joinRoom(
  helia: Helia, 
  roomName: string, 
  onMessage: (message: ChatMessage) => void,
  relayManagerInstance?: RelayManager
): Promise<RoomActions> {
  const libp2p = (helia as any).libp2p as unknown as Libp2p;

let oldestHash: string | null = null; // Хэш (CID) самого старого загруженного сообщения
let hasMore = true; // Флаг, остались ли еще сообщения в базе

// Функция для загрузки порции истории // limit: -1 = все записи
const loadHistoryChunk = async (limit: number, beforeHash: string | null = null) => {
  const options: any = { limit };
  if (beforeHash) {
    options.lt = beforeHash; // 'lt' = less than (загрузить то, что было ДО этого хэша)
  }

  const chunk: any[] = [];
  // OrbitDB iterator выдает сообщения от старых к новым (в рамках лимита)
  for await (const record of db.iterator(options)) {
    chunk.push(record);
  }

  if (chunk.length < limit) {
    hasMore = false; // Если пришло меньше, чем просили — значит мы дошли до самого начала чата
  }

  if (chunk.length > 0) {
    // Запоминаем хэш ПЕРВОГО (самого старого) сообщения в этой пачке,
    // чтобы в следующий раз начать загрузку до него
    oldestHash = chunk[0].hash; 
    
    // Отправляем сообщения в React
    for (const record of chunk) {
      if (record?.payload?.value?.text) {
        onMessage(record.payload.value);
      }
    }
  }
};
  
  // 1. Получаем инстанс OrbitDB
  const orbitdb = await getOrbitDB(helia);

  console.log(`⏳ [OrbitDB] Открываем базу данных для комнаты: ${roomName}`);
  
  // 2. Открываем базу данных типа 'events' (совместимо с сервером)

  const stableName = `ychat-room-${roomName.toLowerCase().replace(/\s+/g, '-')}`;
  const db = await orbitdb.open(stableName, { 
  type: 'events',
  // Добавляем опции для большей устойчивости
  AccessController: OrbitDBAccessController ({ 
    type: 'orbitdb',
    write: ['*']
      // write: [orbitdb.identity.id, SERVER_IDENTITY_ID]
  }) // если нужно открытый доступ
});

console.log('Тип контроллера доступа:', db.access.type);
console.log('Мой Identity ID:', db.identity.id);

// 1. ПЕРВИЧНАЯ ЗАГРУЗКА (только последние 50 сообщений)
await loadHistoryChunk(CONFIG.CHUNK_SIZE);

  const dbAddress = db.address.toString();
  
  console.log(`🏠 [OrbitDB] База открыта локально. Адрес: ${dbAddress}`);


  // 3. СРАЗУ ЧИТАЕМ ИСТОРИЮ ИЗ INDEXEDDB (Решает проблему пропажи сообщений при F5)
try {
    const allEntries = await db.all();
    console.log(`[OrbitDB] Всего записей в кэше: ${allEntries.length}`);

    let validCount = 0;
    for (const entry of allEntries) {
  // Достаем value (если оно упаковано в payload)
  const messageData = entry.payload?.value || entry.value;

  if (messageData && messageData.text) {
    validCount++;

    // Сравниваем ID из сообщения с твоим текущим ID
    const isMine = messageData.whoSent === orbitdb.identity.id;

    onMessage({ 
      id: entry.hash, 
      whoSent: messageData.whoSent, // Берем из данных
      text: messageData.text, 
      type: isMine ? 'sent' : 'received' 
    });
  }
}
    console.log(`[OrbitDB] Успешно выведено в UI после F5: ${validCount} сообщений`);
    
  }catch (e) {
    console.error('Ошибка чтения локальной истории OrbitDB:', e);
  }

  // 4. СЛУШАЕМ ОБНОВЛЕНИЯ СЕТИ (Когда `другие пиры или сервер пишут в чат)
  const onDbUpdate = (entry: any) => {
    const messageData = entry.payload?.value || entry.value;

  if (messageData && messageData.text) {
    const isMine = messageData.whoSent === orbitdb.identity.id;

    onMessage({ 
      id: entry.hash, 
      whoSent: messageData.whoSent, 
      text: messageData.text, 
      type: isMine ? 'sent' : 'received' 
    });
  }
};

  db.events.off('update', onDbUpdate);
  db.events.on('update', onDbUpdate);

  // 5. ДЕЛАЕМ АНОНС ДЛЯ СЕРВЕРА
  // Функция отправки анонса при коннекте к новому пиру (серверу)
  const onConnect = (evt: any) => {
    const peerId = evt.detail as unknown as PeerId;
    console.log(`🤝 Новое соединение: ${peerId.toString().slice(-6)}. Отправляем адрес базы...`);
    
    setTimeout(() => checkAndSyncRelays(helia), 2000);
    // Передаем именно dbAddress, а не имя комнаты!
    const isRelay = relayManager.isRelay(peerId.toString());

    if (isRelay) {
      console.log(`🤝 Новое соединение с Архивариусом: ${peerId}. Отправляем адрес...`);
      notifyArchivist(libp2p, peerId, dbAddress);
      } else {
      // Просто игнорируем, это обычный пользователь (браузер)
      console.log(`🤝 Подключен обычный пир: ${peerId}`);
    }
  };

  libp2p.addEventListener('peer:connect', onConnect);
  
  // Сразу уведомляем все реле, к которым уже успели подключиться при старте
  libp2p.getPeers().forEach((peerId: PeerId) => notifyArchivist(libp2p, peerId, dbAddress));

  return {
    sendMessage: async (text: string) => {
  try {
    const entry = await db.add({
      whoSent: orbitdb.identity.id,
      text,
      ts: Date.now()
    });
    console.log(`✅ [OrbitDB] Сообщение успешно добавлено:`, entry);
  } catch (err) {
    console.error(`❌ [OrbitDB] Ошибка при записи:`, err);
    // Если ошибка именно "not allowed", значит нужно менять StableName (см. п.1)
  }
    },
    leaveRoom: () => {
      // При выходе из чата подчищаем подписки, чтобы не плодить утечки памяти
      libp2p.removeEventListener('peer:connect', onConnect);
      db.events.off('update', onDbUpdate);
      db.close().catch((e: any) => console.warn('Ошибка закрытия базы при выходе:', e));
    },
    pingRoom: () => {
    // Вызываем то же самое, что мы вызываем при первом коннекте,
    // чтобы передать адрес базы данных на сервер
  if (relayManagerInstance && db) {
        // Берем строковый адрес базы OrbitDB и скармливаем менеджеру релеев
        relayManagerInstance.announceRoom(db.address.toString());
      }
  },
    dbAddress: db.address.toString(),
  
  // ОТДАЕМ РУЧКИ В REACT
  loadMoreHistory: async () => {
    if (hasMore) {
      await loadHistoryChunk(CONFIG.CHUNK_SIZE, oldestHash);
    }
  },
  hasMoreHistory: () => hasMore
  };
}

// === Функция синхронизации кэша релеев ===
export async function checkAndSyncRelays(helia: Helia): Promise<void> {
  const lastSync = localStorage.getItem('last_peer_sync');
  const now = Date.now();

  if (!lastSync || (now - parseInt(lastSync, 10)) > CONFIG.SYNC_INTERVAL_MS) {
    const libp2p = (helia as any).libp2p as unknown as Libp2p;
    const pubsub = (libp2p.services as any).pubsub;
    if (!pubsub) return;

    const myPeerId = libp2p.peerId.toString();
    const responseTopic = `${CONFIG.TOPICS.PEER_SYNC_RESPONSE_BASE}${myPeerId}`;


    const onResponse = async (evt: any) => {
      const msg = evt.detail || evt;
      if (msg.topic !== responseTopic) return;
      try {
        const payload = JSON.parse(new TextDecoder().decode(msg.data));
        if (payload?.relays) {
          localStorage.setItem('known_relays', JSON.stringify(payload.relays));
          localStorage.setItem('last_peer_sync', Date.now().toString());
          console.log(`📥 [PEER-SYNC] Кэш синхронизирован. Релеев: ${payload.relays.length}`);
          pubsub.removeEventListener('message', onResponse);
          await pubsub.unsubscribe(responseTopic);
        }
      } catch (e) { console.error('Ошибка парсинга релеев:', e); }
    };

    await pubsub.subscribe(responseTopic);
    pubsub.addEventListener('message', onResponse);

    const reqPayload = JSON.stringify({ from: myPeerId });
    await pubsub.publish(CONFIG.TOPICS.PEER_SYNC_REQUEST, new TextEncoder().encode(reqPayload));

    setTimeout(() => {
      pubsub.removeEventListener('message', onResponse);
      try { pubsub.unsubscribe(responseTopic); } catch {}
    }, 5000);
  }
}