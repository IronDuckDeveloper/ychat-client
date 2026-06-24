// Добавляем импорт relayManager из твоего клиента!
import { createBrowserHelia, relayManager } from '../networking/heliaClient.ts';
import { getOrbitDB } from '../orbit/client.ts';
import { initProfileDB } from './profileService.ts';
import { generateDeviceFingerprint, getClientIpAddress } from '../utils/fingerprint.ts';
import { CONFIG } from '../config.ts';
import { RelayManager } from '../networking/RelayManager.ts';
import { addContactIfMissing, initContactsDB, getContact, saveContact } from './contactsService.ts';

export let globalHelia: any = null;
export let globalOrbitDB: any = null;
export let globalProfileDb: any = null;
export let globalContactsDb: any = null;
export let globalRelayManager: RelayManager | null = null;

let dbReadyCallbacks: (() => void)[] = [];
export const onDbReady = (callback: () => void) => {
  if (globalProfileDb) {
    callback();
  } else {
    dbReadyCallbacks.push(callback);
  }
};

let isInitializing = false;

const activeDbs = new Map();

export async function getOrOpenDb(address: string | undefined | null) {
  // 1. Броня от битых адресов
  if (!address || typeof address !== 'string' || !address.startsWith('/orbitdb/')) {
    console.warn(`⚠️ getOrOpenDb: Пропущен некорректный адрес базы: ${address}`);
    return null;
  }

  // 2. Проверяем кэш
  if (activeDbs.has(address)) {
    const cachedDb = activeDbs.get(address);
    // Если база по какой-то причине закрыта (например, из-за React Strict Mode cleanup)
    // удаляем её из кэша, чтобы открыть заново
    if (cachedDb.closed) {
      activeDbs.delete(address);
    } else {
      return cachedDb;
    }
  }

  try {
    // 3. Открытие базы. 
    // Убираем { type: 'keyvalue' }! OrbitDB автоматически определит правильный тип 
    // (events для чата, keyvalue для профиля) на основе манифеста базы.
    const db = await globalOrbitDB.open(address);

    // Слушаем событие закрытия базы, чтобы вовремя вычищать её из нашего кэша
    if (db.events) {
      db.events.on('close', () => {
        console.log(`🧹 [Кэш БД] База ${address} была закрыта, удаляем из кэша.`);
        activeDbs.delete(address);
      });
    }

    activeDbs.set(address, db);
    return db;
  } catch (e) {
    console.error(`❌ getOrOpenDb: Ошибка при открытии базы ${address}:`, e);
    return null;
  }
}

/**
 * Рассылает текущий профиль пользователя (ник и аватар) в общую сеть PubSub.
 * Используется как при обновлении своего профиля, так и в ответ на PROFILE_REQUEST.
 */
export async function broadcastMyProfile() {
  if (!globalHelia || !globalProfileDb) {
    console.warn('⚠️ broadcastMyProfile: Нода или база профиля не инициализированы.');
    return;
  }

  try {
    const myPeerId = globalHelia.libp2p.peerId.toString();
    
    // Достаем актуальные данные из OrbitDB
    const nickname = await globalProfileDb.get(CONFIG.PROFILE.KEY_NICKNAME);
    const avatarCid = await globalProfileDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);

    const updateMsg = {
      type: CONFIG.PROFILE.MSG_PROFILE_UPDATED,
      senderId: myPeerId,
      nickname: nickname || 'Аноним',
      avatarCid: avatarCid || '' // Если авы нет, шлем пустую строку
    };

    const encoded = new TextEncoder().encode(JSON.stringify(updateMsg));
    
    await globalHelia.libp2p.services.pubsub.publish(
      CONFIG.TOPICS.PROFILE_UPDATES_TOPIC, 
      encoded
    );
    
    console.log('🚀 [PubSub] Профиль успешно опубликован в сеть.');
  } catch (error) {
    console.error('❌ Ошибка при публикации профиля:', error);
  }
}

export async function initializeApp(nicknameForRegistration?: string) {
  if (globalHelia && globalProfileDb) {
    console.log('⚡️ [Init] P2P узел уже запущен, пропускаем повторную инициализацию.');
    return { helia: globalHelia, orbitdb: globalOrbitDB, profileDb: globalProfileDb };
  }

  if (isInitializing) {
    console.log('⏳ [Init] Инициализация уже в процессе, блокируем дублирующий вызов...');
    return;
  }

  isInitializing = true;

  try {
    console.log('🚀 [Init] Запуск IPFS узла и баз данных...');

    // 1. Просто привязываем готовый инстанс из heliaClient
    globalRelayManager = relayManager;

    // 2. Поднимаем IPFS (внутри createBrowserHelia уже происходит перебор релеев и запуск мониторинга!)
    globalHelia = await createBrowserHelia();
    
    const libp2p = (globalHelia as any).libp2p as any;

    // 3. Поднимаем OrbitDB и профиль
    globalOrbitDB = await getOrbitDB(globalHelia);
    globalProfileDb = await initProfileDB(globalOrbitDB);
    globalContactsDb = await initContactsDB(globalOrbitDB);

    const pubsub = libp2p.services.pubsub;
    if (!pubsub) {
      throw new Error('PubSub service is not available on libp2p node');
    }

    await pubsub.subscribe(CONFIG.TOPICS.PROFILE_UPDATES_TOPIC);   // Подписываемся на обновления профилей
    await pubsub.subscribe(CONFIG.TOPICS.WAKEUP_SYNC_TOPIC);  // Подписываемся на пинги пробуждения от других клиентов

    // ==========================================
    // ЛОГИКА ОБРАБОТКИ СООБЩЕНИЙ (ОБНОВЛЕНИЯ ПРОФИЛЯ И ПРОБУЖДЕНИЯ)
    // ==========================================
    pubsub.addEventListener('message', async (evt: any) => {
      const currentTopic = evt.detail.topic;

      // 1. Пропускаем только те топики, которые умеем обрабатывать
      if (
        currentTopic !== CONFIG.TOPICS.PROFILE_UPDATES_TOPIC && 
        currentTopic !== CONFIG.TOPICS.WAKEUP_SYNC_TOPIC
      ) return;
      
      let msg;
      try {
        msg = JSON.parse(new TextDecoder().decode(evt.detail.data));
      } catch (e) {
        console.warn('⚠️ Ошибка парсинга сообщения PubSub:', e);
        return; 
      }

      const myPeerId = globalHelia.libp2p.peerId.toString();
      const senderId = evt.detail.from.toString();
      
      // Игнорируем эхо от собственных сообщений
      if (senderId === myPeerId) return;

      // 👇 БЛОК ФАЕРВОЛА: Проверяем, не в черном ли списке отправитель
      const { isPeerBlocked } = await import('./contactsService.ts');
      const isBlocked = await isPeerBlocked(globalContactsDb, senderId);
      
      if (isBlocked) {
        console.log(`🚫 [Фаервол] Отклонено PubSub-сообщение (${currentTopic}) от заблокированного: ${senderId.slice(0, 8)}`);
        return; // Полностью игнорируем любые чихи от этого пира
      }

      // 2. Обработка WAKEUP_PING (Кто-то проснулся)
      if (currentTopic === CONFIG.TOPICS.WAKEUP_SYNC_TOPIC) {
        try {
          if (msg.type === CONFIG.MSG.WAKEUP) {
            console.log(`🔔 [PubSub] Пир ${senderId.slice(-6)} проснулся! Синхронизация превью делегирована топику ANNOUNCE_NEW_MESSAGE.`);
          }
        } catch (e) {
          console.error('❌ Ошибка при обработке WAKEUP_PING:', e);
        }
        return; // Выходим из слушателя, так как этот топик обработан
      }

      // 3. Обработка PROFILE_UPDATED
      if (msg.type === CONFIG.PROFILE.MSG_PROFILE_UPDATED) {  
        console.log(`📩 [PubSub Сеть] Получено обновление профиля от ${msg.senderId.slice(0,8)}`);
        
        const contact = await getContact(globalContactsDb, msg.senderId);
        
        if (contact) {
          let isChanged = false;

          // Проверяем исключительно данные профиля: ник и аватар
          if (contact.avatarCid !== msg.avatarCid || contact.nickname !== msg.nickname) {
            contact.avatarCid = msg.avatarCid;
            contact.nickname = msg.nickname;
            isChanged = true;
          }

          if (isChanged) {
            console.log(`🔄 [PubSub] Обновляем локальную базу для контакта ${msg.nickname}`);
            contact.updatedAt = Date.now();
            await saveContact(globalContactsDb, contact);
            window.dispatchEvent(new Event('onContactsUpdated'));
          }
        }
      }

      // 4. Кто-то просит НАС представиться (PROFILE_REQUEST)
      if (msg.type === CONFIG.PROFILE.MSG_PROFILE_REQUEST) {
        if (msg.targetId === myPeerId) {
          console.log(`📡 [PubSub] Получен PROFILE_REQUEST. Отправляю свой актуальный профиль в сеть...`);
          await broadcastMyProfile(); 

          if (globalContactsDb && senderId) {
            addContactIfMissing(globalContactsDb, globalHelia, senderId);
          }
        }
      }
    });

    // ==========================================
    // ЛОГИКА ОБРАБОТКИ ПУЛЬСА СЕТИ (PubSub)
    // ==========================================

    // Оригинальный логгер сети
    setInterval(() => {
      if (globalHelia) {
        const allPeers = libp2p.getPeers();
        const pubsubPeers = pubsub.getPeers();
        const topics = pubsub.getTopics();

        console.log(
          `📊 Network: Peers=${allPeers.length} | PubSub=${pubsubPeers.length} | Topics=${JSON.stringify(topics)}`
        );
      }
    }, 5000);

    // ==========================================
    // 4. Логика регистрации С ЧЕСТНЫМ КУВЫРКОМ ПО РЕЛЕЯМ
    // ==========================================
    if (nicknameForRegistration) {
      console.log(`📝 [Init] Сохраняем никнейм: ${nicknameForRegistration}`);

      const fingerprint = await generateDeviceFingerprint();
      const ipAddress = await getClientIpAddress();
      
      await globalProfileDb.put(CONFIG.PROFILE.KEY_NICKNAME, nicknameForRegistration);
      await globalProfileDb.put(CONFIG.PROFILE.KEY_DATE_CREATED, Date.now());
      await globalProfileDb.put(CONFIG.KEY_FINGERPRINT, fingerprint);
      await globalProfileDb.put(CONFIG.KEY_IP_ADDRESS, ipAddress);

      const profileAddressStr = globalProfileDb.address.toString();
      
      const relays = globalRelayManager.getPool();
      let registrationSuccess = false;

      // Бежим по нашему пулу надежности
      for (const relay of relays) {
        try {
          console.log(`⏳ [Init] Пробуем зарегистрироваться через релей: ${relay.name}...`);

          const actionType = nicknameForRegistration ? 'REGISTER' : 'LOGIN';   
          
          // Шлем запрос именно на текущий в итерации relay.peerId
          const isRegistered = await globalRelayManager.registerWithRelay(
            libp2p,
            relay.peerId,
            profileAddressStr,
            fingerprint,
            ipAddress,
            actionType
          );

          // Если регистрация прошла успешно, выходим из цикла и фиксируем этот релей как активный в менеджере
          if (isRegistered) {
            registrationSuccess = true;
            
            // Фиксируем этот рабочий релей как активный в менеджере
            const activeIdx = relays.indexOf(relay);
            globalRelayManager.setActiveIndex(activeIdx);
            
            console.log(`🎉 [Init] Сетевой антифрод успешно пройден на релее ${relay.name}!`);
            break; // Успех! Выходим из цикла перебора релеев
          } else {
            console.warn(`⚠️ [Init] Релей ${relay.name} отклонил регистрацию (лимит), проверяем следующий...`);
          }

        } catch (relayError: any) {
          // Если сервер лежит (как твой старый IP 62.x) — ловим ошибку связи ЗДЕСЬ
          // Цикл НЕ прерывается, код спокойно идет к следующему релею в списке
          console.warn(`⚠️ [Init] Релей ${relay.name} недоступен по сети: ${relayError.message || relayError}`);
        }
      }

      // Если прошли весь цикл и ни один сервер не ответил успехом
      if (!registrationSuccess) {
        throw new Error('Не удалось зарегистрироваться: все релеи сети недоступны или превышен лимит устройств.');
      }
    }

    console.log('✅ [Init] Инициализация успешно завершена!');

    dbReadyCallbacks.forEach(cb => cb());
    dbReadyCallbacks = []; 

    return { helia: globalHelia, orbitdb: globalOrbitDB, profileDb: globalProfileDb };

  } catch (error) {
    console.error('❌ [Init] Ошибка инициализации:', error);

    try {
      console.log('🧹 [Init] Откат изменений: останавливаем базы и узел...');
      if (globalContactsDb) await globalContactsDb.close();
      if (globalProfileDb) await globalProfileDb.close();
      if (globalOrbitDB) await globalOrbitDB.stop();
      if (globalHelia) await globalHelia.stop();
    } catch (cleanupError) {
      console.error('⚠️ [Init] Ошибка при очистке мусора:', cleanupError);
    }

    // Сбрасываем стейт
    globalHelia = null;
    globalOrbitDB = null;
    globalProfileDb = null;
    globalRelayManager = null;
    isInitializing = false;

    throw error;  // Пробрасываем ошибку дальше в Auth.tsx
  } finally {
    isInitializing = false;
  }
}

// Добавь в конец файла инициализации P2P-ноды (например, authService.ts)

if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    console.log('🧹 [HMR] Очистка перед перезапуском: глушим старые инстансы...');
    try {
      if (globalOrbitDB) {
        await globalOrbitDB.stop().catch(() => {});
      }
      if (globalHelia) {
        await globalHelia.stop().catch(() => {});
      }
    } catch (e) {
      console.error('❌ Ошибка очистки HMR:', e);
    }
  });
}