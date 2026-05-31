import type { Helia } from 'helia';
import type { Libp2p, PeerId } from '@libp2p/interface';
import { getOrbitDB } from '../orbit/client.ts';
import { CONFIG, type ChatMessage, type RoomActions } from '../config.ts';
import { notifyArchivist, checkAndSyncRelays } from '../networking/connectionManager.ts';
import { RelayManager } from '../networking/RelayManager.ts';
import { relayManager } from '../networking/heliaClient.ts';
import { OrbitDBAccessController } from '@orbitdb/core';
import { initProfileDB } from './profileService.ts';

// Храним не просто инстансы, а промисы открытия и счетчик активных компонентов
const dbCache = new Map<string, {
  instance: any;
  refCount: number;
}>();

const openingPromises = new Map<string, Promise<any>>();


export async function joinRoom(
  helia: Helia,
  roomName: string,
  onMessage: (message: ChatMessage) => void,
  relayManagerInstance?: RelayManager,
): Promise<RoomActions> {
  const libp2p = (helia as any).libp2p as unknown as Libp2p;
  const stableName = `ychat-room-${roomName.toLowerCase().replace(/\s+/g, '-')}`;

  let db: any;

  // === ПРЕДОХРАНИТЕЛЬ ОТ STRICT MODE / СУПЕРБЫСТРЫХ ПЕРЕХОДОВ ===
  
// 1. Если база уже полностью открыта и сидит в кэше
  if (dbCache.has(stableName)) {
    const cached = dbCache.get(stableName)!;
    cached.refCount++; // Увеличиваем счетчик пользователей базы
    db = cached.instance;
    console.log(`♻️ [RoomService] Использована уже открытая база из кэша ( refs: ${cached.refCount} )`);
  }
// 2. Если база прямо сейчас открывается параллельным потоком
  else if (openingPromises.has(stableName)) {
    console.log(`⏳ [RoomService] Подключаемся к параллельному процессу открытия...`);
    db = await openingPromises.get(stableName);
    
    const cached = dbCache.get(stableName);
    if (cached) cached.refCount++;
  }
// 3. База закрыта, открываем с нуля
  else {
    const openPromise = (async () => {
      try {
        const orbitdb = await getOrbitDB(helia);
        console.log(`⏳ [OrbitDB] Первичное открытие базы данных для комнаты: ${roomName}`);
        
        const instance = await orbitdb.open(stableName, {
          type: 'events',
          AccessController: OrbitDBAccessController({
            type: 'orbitdb',
            write: ['*'],
          }),
        });

        // Инициализируем кэш со счетчиком = 1
        dbCache.set(stableName, { instance, refCount: 1 });
        return instance;
      } finally {
        openingPromises.delete(stableName);
      }
    })();

    openingPromises.set(stableName, openPromise);
    db = await openPromise;
  }

  // Получаем инстанс OrbitDB повторно (для вытаскивания identity ниже по коду)
  const orbitdb = await getOrbitDB(helia);

  // === КОНЕЦ БЛОКА ПРЕДОХРАНИТЕЛЯ ===

  let oldestHash: string | null = null; 
  let hasMore = true; 

  // Функция для загрузки порции истории
  const loadHistoryChunk = async (
    limit: number,
    beforeHash: string | null = null,
  ) => {
    const options: any = { limit };
    if (beforeHash) {
      options.lt = beforeHash; 
    }

    const chunk: any[] = [];
    for await (const record of db.iterator(options)) {
      chunk.push(record);
    }

    if (chunk.length < limit) {
      hasMore = false; 
    }

    if (chunk.length > 0) {
      oldestHash = chunk[0].hash;
      for (const record of chunk) {
        if (record?.payload?.value?.text) {
          onMessage(record.payload.value);
        }
      }
    }
  };

  console.log('Тип контроллера доступа:', db.access.type);
  console.log('Мой Identity ID:', db.identity.id);

  // ПЕРВИЧНАЯ ЗАГРУЗКА
  await loadHistoryChunk(CONFIG.CHUNK_SIZE);

  const dbAddress = db.address.toString();
  console.log(`🏠 [OrbitDB] База открыта локально. Адрес: ${dbAddress}`);

  // ЧИТАЕМ ИСТОРИЮ ИЗ INDEXEDDB
  try {
    const allEntries = await db.all();
    console.log(`[OrbitDB] Всего записей в кэше: ${allEntries.length}`);

    let validCount = 0;
    for (const entry of allEntries) {
      const messageData = entry.payload?.value || entry.value;

      if (messageData && messageData.text) {
        validCount++;
        const isMine = messageData.whoSent === orbitdb.identity.id;

        onMessage({
          id: entry.hash,
          whoSent: messageData.whoSent, 
          text: messageData.text,
          type: isMine ? 'sent' : 'received',
        });
      }
    }
    console.log(`[OrbitDB] Успешно выведено в UI после F5: ${validCount} сообщений`);
  } catch (e) {
    console.error('Ошибка чтения локальной истории OrbitDB:', e);
  }

  // СЛУШАЕМ ОБНОВЛЕНИЯ СЕТИ
  const onDbUpdate = (entry: any) => {
    const messageData = entry.payload?.value || entry.value;

    if (messageData && messageData.text) {
      const isMine = messageData.whoSent === orbitdb.identity.id;

      onMessage({
        id: entry.hash,
        whoSent: messageData.whoSent,
        text: messageData.text,
        type: isMine ? 'sent' : 'received',
      });
    }
  };

  db.events.off('update', onDbUpdate);
  db.events.on('update', onDbUpdate);

  // ДЕЛАЕМ АНОНС ДЛЯ СЕРВЕРА
  const onConnect = (evt: any) => {
    const peerId = evt.detail as unknown as PeerId;
    console.log(`🤝 Новое соединение: ${peerId.toString().slice(-6)}. Отправляем адрес базы...`);

    setTimeout(() => checkAndSyncRelays(helia), 2000);
    const isRelay = relayManager.isRelay(peerId.toString());

    if (isRelay) {
      console.log(`🤝 Новое соединение с Архивариусом: ${peerId}. Отправляем адрес...`);
      notifyArchivist(libp2p, peerId, dbAddress);
    } else {
      console.log(`🤝 Подключен обычный пир: ${peerId}`);
    }
  };

  libp2p.addEventListener('peer:connect', onConnect);

  libp2p
    .getPeers()
    .forEach((peerId: PeerId) => notifyArchivist(libp2p, peerId, dbAddress));

  return {sendMessage: async (text: string) => {
      try {
        // Проверяем статус перед записью
        if (!db || typeof db.add !== 'function') {
          throw new Error('Database instance is undefined or destroyed');
        }
        const entry = await db.add({
          whoSent: orbitdb.identity.id,
          text,
          ts: Date.now(),
        });
        console.log(`✅ [OrbitDB] Сообщение успешно добавлено:`, entry);
      } catch (err: any) {
        console.error(`❌ [OrbitDB] Ошибка при записи:`, err?.message || err);
      }
    },
    leaveRoom: () => {
      libp2p.removeEventListener('peer:connect', onConnect);
      db.events.off('update', onDbUpdate);
      
      // === УМНОЕ ЗАКРЫТИЕ БАЗЫ ===
      const cached = dbCache.get(stableName);
      if (cached) {
        cached.refCount--;
        console.log(`📉 [RoomService] Уменьшен счетчик ссылок базы ${stableName} ( refs: ${cached.refCount} )`);
        
        // Закрываем физически ТОЛЬКО если больше ни один компонент её не держит
        if (cached.refCount <= 0) {
          console.log(`🛑 [RoomService] Ссылок нет. Закрываем базу OrbitDB: ${stableName}`);
          dbCache.delete(stableName);
          db.close().catch((e: any) =>
            console.warn('Ошибка закрытия базы при выходе:', e)
          );
        }
      }
    },
    pingRoom: () => {
      if (relayManagerInstance && db) {
        relayManagerInstance.announceRoom(db.address.toString());
      }
    },
    dbAddress: db.address.toString(),
    loadMoreHistory: async () => {
      if (hasMore) {
        await loadHistoryChunk(CONFIG.CHUNK_SIZE, oldestHash);
      }
    },
    hasMoreHistory: () => hasMore,};
}
export type { ChatMessage };

export type { RoomActions };

