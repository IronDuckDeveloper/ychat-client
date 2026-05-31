import type { Helia } from 'helia';
import type { Libp2p, PeerId } from '@libp2p/interface';
import { getOrbitDB } from '../orbit/client.ts';
import { CONFIG, type ChatMessage, type RoomActions } from '../config.ts';
import { notifyArchivist, checkAndSyncRelays } from '../networking/connectionManager.ts';
import { RelayManager } from '../networking/RelayManager.ts';
import { relayManager } from '../networking/heliaClient.ts';
import { OrbitDBAccessController } from '@orbitdb/core';
import { initProfileDB } from './profileService.ts';

export async function joinRoom(
  helia: Helia,
  roomName: string,
  onMessage: (message: ChatMessage) => void,
  relayManagerInstance?: RelayManager,
): Promise<RoomActions> {
  const libp2p = (helia as any).libp2p as unknown as Libp2p;

  let oldestHash: string | null = null; // Хэш (CID) самого старого загруженного сообщения
  let hasMore = true; // Флаг, остались ли еще сообщения в базе

  // Функция для загрузки порции истории // limit: -1 = все записи
  const loadHistoryChunk = async (
    limit: number,
    beforeHash: string | null = null,
  ) => {
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
    AccessController: OrbitDBAccessController({
      type: 'orbitdb',
      write: ['*'],
    }),
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
          type: isMine ? 'sent' : 'received',
        });
      }
    }
    console.log(
      `[OrbitDB] Успешно выведено в UI после F5: ${validCount} сообщений`,
    );
  } catch (e) {
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
        type: isMine ? 'sent' : 'received',
      });
    }
  };

  db.events.off('update', onDbUpdate);
  db.events.on('update', onDbUpdate);

  // 5. ДЕЛАЕМ АНОНС ДЛЯ СЕРВЕРА
  // Функция отправки анонса при коннекте к новому пиру (серверу)
  const onConnect = (evt: any) => {
    const peerId = evt.detail as unknown as PeerId;
    console.log(
      `🤝 Новое соединение: ${peerId.toString().slice(-6)}. Отправляем адрес базы...`,
    );

    setTimeout(() => checkAndSyncRelays(helia), 2000);
    // Передаем именно dbAddress, а не имя комнаты!
    const isRelay = relayManager.isRelay(peerId.toString());

    if (isRelay) {
      console.log(
        `🤝 Новое соединение с Архивариусом: ${peerId}. Отправляем адрес...`,
      );
      notifyArchivist(libp2p, peerId, dbAddress);
    } else {
      // Просто игнорируем, это обычный пользователь (браузер)
      console.log(`🤝 Подключен обычный пир: ${peerId}`);
    }
  };

  libp2p.addEventListener('peer:connect', onConnect);

  // Сразу уведомляем все реле, к которым уже успели подключиться при старте
  libp2p
    .getPeers()
    .forEach((peerId: PeerId) => notifyArchivist(libp2p, peerId, dbAddress));

  return {
    sendMessage: async (text: string) => {
      try {
        const entry = await db.add({
          whoSent: orbitdb.identity.id,
          text,
          ts: Date.now(),
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
      db.close().catch((e: any) =>
        console.warn('Ошибка закрытия базы при выходе:', e),
      );
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
    hasMoreHistory: () => hasMore,
  };
}
export type { ChatMessage };

export type { RoomActions };

