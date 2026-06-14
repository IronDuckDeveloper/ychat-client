// Добавляем импорт relayManager из твоего клиента!
import { createBrowserHelia, relayManager } from '../networking/heliaClient.ts';
import { getOrbitDB } from '../orbit/client.ts';
import { initProfileDB } from './profileService.ts';
import { generateDeviceFingerprint, getClientIpAddress } from '../utils/fingerprint.ts';
import { CONFIG } from '../config.ts';
import { RelayManager } from '../networking/RelayManager.ts';
import { addContactIfMissing, initContactsDB } from './contactsService.ts';

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
    return null; // Возвращаем null вместо краша
  }

  // 2. Кэш
  if (activeDbs.has(address)) {
    return activeDbs.get(address);
  }

  try {
    // 3. Открытие и загрузка
    const db = await globalOrbitDB.open(address, { type: 'keyvalue' });

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
    // ЛОГИКА ОБРАБОТКИ СООБЩЕНИЙ ОБНОВЛЕНИЯ ПРОФИЛЯ
    // ==========================================
    pubsub.addEventListener('message', async (evt: any) => {
      if (evt.detail.topic !== CONFIG.TOPICS.PROFILE_UPDATES_TOPIC) return;
      
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

      // 1. Обработка WAKEUP_PING (Кто-то проснулся, надо пнуть базы!)
      if (evt.detail.topic === CONFIG.TOPICS.WAKEUP_SYNC_TOPIC) {
        try {
          const msg = JSON.parse(new TextDecoder().decode(evt.detail.data));
          const myPeerId = globalHelia.libp2p.peerId.toString();
          
          // Если это не наше собственное эхо
          if (msg.type === CONFIG.MSG.WAKEUP && evt.detail.from.toString() !== myPeerId) {
            console.log(`🔔 [PubSub] Пир ${evt.detail.from.toString().slice(-6)} проснулся! Инициирую встречную синхронизацию баз...`);
            
            // Ждем 2 секунды, пока Gossipsub соберет меш с проснувшимся пиром
            setTimeout(async () => {
              await pokeOrbitDbs();
            }, 3000);
          }
        } catch (e) {
          console.error('❌ Ошибка при обработке WAKEUP_PING:', e);
        }
        return; // Выходим, чтобы не идти в логику профилей ниже
      }

      // 1. Пришло уведомление об обновлении (PROFILE_UPDATED)
      // ЭТОТ БЛОК АВТОМАТИЧЕСКИ ПОЙМАЕТ ОТВЕТ НА НАШ ЗАПРОС И ОБНОВИТ ИМЯ/АВАТАР
      if (msg.type === CONFIG.PROFILE.MSG_PROFILE_UPDATED) {  
        console.log(`📩 [PubSub Сеть] Получено обновление профиля от ${msg.senderId.slice(0,8)}`);
        const { getContact, saveContact } = await import('./contactsService.ts');
        const contact = await getContact(globalContactsDb, msg.senderId);
        
        if (contact) {
          if (contact.avatarCid !== msg.avatarCid || contact.nickname !== msg.nickname) {
            console.log(`🔄 [PubSub] Обновляем локальную базу для контакта ${msg.nickname}`);
            contact.avatarCid = msg.avatarCid;
            contact.nickname = msg.nickname;
            contact.updatedAt = Date.now();
            await saveContact(globalContactsDb, contact);
            
            // Пинаем UI, чтобы React перерисовал список контактов
            window.dispatchEvent(new Event('onContactsUpdated'));
          } else {
            console.log(`✅ [PubSub] Профиль ${msg.nickname} уже актуален, пропускаем.`);
          }
        }
      }

      // 2. Кто-то просит НАС представиться (PROFILE_REQUEST)
      if (msg.type === CONFIG.PROFILE.MSG_PROFILE_REQUEST) {
        // Проверяем, нас ли просят обновиться?
        if (msg.targetId === myPeerId) {
          console.log(`📡 [PubSub] Получен PROFILE_REQUEST. Отправляю свой актуальный профиль в сеть...`);
          await broadcastMyProfile(); 

          // 👇 ИСПРАВЛЕНО: АВТОДОБАВЛЕНИЕ ВСТРЕЧНОГО КОНТАКТА ТОЛЬКО ЕСЛИ ЗАПРОС К НАМ 👇
          if (globalContactsDb && senderId) {
            // Вызываем добавление. Внутри contactsService.ts она сама запросит профиль!
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

// ==========================================
// 5. Пинаем базы данных (authService.ts)
// ==========================================
// В authService.ts
export async function pokeOrbitDbs() {
  if (!globalOrbitDB || !globalContactsDb) return;

  // 1. Проверяем, есть ли вообще пиры в сети, прежде чем "пинать"
  const peers = globalHelia.libp2p.getPeers();
  if (peers.length === 0) {
    console.warn('⚠️ [OrbitDB] Сеть пуста, пропускаем синхронизацию...');
    return;
  }

  console.log('🔄 [OrbitDB] Начинаем синхронизацию...');
  
  try {
    const { getAllContacts, updateLastMessage } = await import('./contactsService.ts');
    const contacts = await getAllContacts(globalContactsDb);
    
    // Используем Promise.all для параллельного открытия баз, это быстрее
    await Promise.all(contacts.map(async (contact) => {
    if (!contact.chatDbAddress) return;

    const chatDb = await getOrOpenDb(contact.chatDbAddress);
    if (!chatDb) return;

    try {
      // ВАЖНО: Добавлена проверка состояния базы
      if (chatDb.status !== 'open') {
          console.warn(`⚠️ [OrbitDB] База ${contact.chatDbAddress} закрыта, пропускаем.`);
          return;
      }

      const allRecords = await chatDb.all();
      const lastMsg = allRecords.length > 0 ? allRecords[allRecords.length - 1] : null;

      console.log(`[Debug DB] Проверка чата ${contact.nickname}. Сообщений в итераторе: ${allRecords.length}`);

      if (lastMsg && lastMsg.ts > (contact.lastMessageTime || 0)) {
        console.log(`📥 [Синхронизация после сна] Обновляем превью для ${contact.nickname}`);
        const isCurrentlyInThisChat = window.location.pathname.includes(contact.id);
        await updateLastMessage(globalContactsDb, contact.id, lastMsg.text, lastMsg.ts, !isCurrentlyInThisChat);
        window.dispatchEvent(new Event('onContactsUpdated'));
      }
    } catch (dbError) {
      // Изолируем ошибку одной базы, чтобы не упал весь цикл
      console.error(`❌ [Debug DB] Ошибка при чтении базы чата ${contact.nickname}:`, dbError);
    }
  }));

    console.log('✅ [OrbitDB] Синхронизация завершена успешно.');
  } catch (e) {
    console.error('❌ [OrbitDB] Ошибка синхронизации:', e);
  }
}
// export async function pokeOrbitDbs() {
//   if (!globalOrbitDB || !globalContactsDb) return;
  
//   console.log('⏳ [OrbitDB] Отложенный запуск синхронизации баз (ждем стабилизации сети)...');
  
//   // ДОБАВЛЕН ASYNC ВОТ СЮДА 👇
//   setTimeout(async () => {
//     console.log('🫵 [OrbitDB] Пинаем базы данных для восстановления репликации...');
//     try {
//       const { getAllContacts, updateLastMessage } = await import('./contactsService.ts');
//       const contacts = await getAllContacts(globalContactsDb);
      
//       // 👇 МАЯЧОК 1: Сколько контактов мы вообще нашли? 👇
//       console.log(`[Debug DB] Найдено контактов для проверки: ${contacts.length}`);
      
//       const reconnectDatabases = async () => {
//         for (const contact of contacts) {
//           // 👇 МАЯЧОК 2: Есть ли у контакта адрес базы чата? 👇
//           console.log(`[Debug DB] Контакт ${contact.nickname}: chatDbAddress = ${contact.chatDbAddress}`);

//           if (contact.chatDbAddress) {
//             const chatDb = await getOrOpenDb(contact.chatDbAddress);
            
//             // 👇 МАЯЧОК 3: Удалось ли открыть базу? 👇
//             console.log(`[Debug DB] Статус открытия базы для ${contact.nickname}: ${chatDb ? 'УСПЕХ' : 'ОШИБКА (null)'}`);
            
//             if (chatDb) {
//               setTimeout(async () => {
//                 const allRecords = await chatDb.all();
//                 const lastMsg = allRecords.length > 0 ? allRecords[allRecords.length - 1] : null;

//                 console.log(`[Debug DB] Проверка чата ${contact.nickname}. Сообщений в итераторе: ${allRecords.length}`);

//                 if (lastMsg) {
//                   const contactLastTime = contact.lastMessageTime || 0;
                  
//                   console.log(`[Debug DB] ${contact.nickname}: в базе ts=${lastMsg.ts}, в кэше ts=${contactLastTime}. Текст: ${lastMsg.text}`);

//                   if (lastMsg.ts && lastMsg.ts > contactLastTime) {
//                     console.log(`📥 [Синхронизация после сна] Обновляем превью для ${contact.nickname}`);
                    
//                     const isCurrentlyInThisChat = window.location.pathname.includes(contact.id);
                    
//                     await updateLastMessage(
//                       globalContactsDb, 
//                       contact.id, 
//                       lastMsg.text, 
//                       lastMsg.ts, 
//                       !isCurrentlyInThisChat
//                     );
                    
//                     window.dispatchEvent(new Event('onContactsUpdated'));
//                   }
//                 }
//               }, 1000);
//             }
//           }
//         }
//       };

//       // 1. Мгновенный пинг
//       await reconnectDatabases();
//       console.log('✅ [OrbitDB] Первичный пинг баз выполнен.');

//       // 2. Контрольный пинг через 3 секунды (когда Gossipsub построит меш)
//       setTimeout(async () => {
//         console.log('⏱️ [OrbitDB] Контрольный пинг баз после стабилизации меша PubSub...');
//         await reconnectDatabases();
//       }, 3000);

//     } catch (e) {
//       console.error('❌ Ошибка при пинге баз OrbitDB:', e);
//     }
//   }, 2000); // Даем 2 секунды на стабилизацию соединения
// }

// (window as any).debugPoke = pokeOrbitDbs;

(window as any).debugPoke = pokeOrbitDbs;