import { createBrowserHelia, relayManager } from '../networking/heliaClient.ts';
import { getOrbitDB } from '../orbit/client.ts';
import { getFilteredProfileData, initProfileDB, initGlobalRegistryDB } from './profileService.ts';
import { generateDeviceFingerprint, getClientIpAddress } from '../utils/fingerprint.ts';
import { CONFIG } from '../config.ts';
import { RelayManager } from '../networking/RelayManager.ts';
import { initContactsDB, getContact, saveContact, type ContactItem, updateContactProfileAddress } from './contactsService.ts';
import { OrbitDBAccessController } from '@orbitdb/core';

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

export const activeDbs = new Map<string, any>();

const processedPubSubMsgs = new Set<string>();

export async function getOrOpenDb(addressOrName: string | undefined | null) {
  if (!addressOrName || typeof addressOrName !== 'string') {
    return null; 
  }

  // Блокируем мусор, но пропускаем полные адреса И детерминированные комнаты
  if (!addressOrName.startsWith('/orbitdb/') && !addressOrName.startsWith(CONFIG.PREFIX_ROOM)) {
    return null;
  }

  // 1. Быстрый возврат из кэша с проверкой, жива ли база
  if (activeDbs.has(addressOrName)) {
    const cachedDb = activeDbs.get(addressOrName);
    
    // Внутренняя проверка IPFS/LevelDB. Если у БД стерты события или статус closed, кэш протух.
    // Если база мертва — удаляем из кэша и идем открывать заново.
    if (!cachedDb || cachedDb.closed || (cachedDb.events && cachedDb.events.closed)) {
      activeDbs.delete(addressOrName);
    } else {
      return cachedDb;
    }
  }

  try {
    let db;
    
    // 2. Открываем базу с правильным манифестом
    if (addressOrName.startsWith(CONFIG.PREFIX_ROOM)) {
      db = await globalOrbitDB.open(addressOrName, {
        type: 'documents',
        docIndex: '_id',
        AccessController: OrbitDBAccessController({
          type: 'orbitdb',
          write: ['*'],
        }),
      });
    } else {
      // Если это уже готовый /orbitdb/zdpu... адрес
      db = await globalOrbitDB.open(addressOrName);
    }

    // 3. Сохраняем в кэш. 
    activeDbs.set(addressOrName, db);
    
    // И дублируем по физическому адресу, если запрашивали по имени
    if (db.address && db.address.toString() !== addressOrName) {
      activeDbs.set(db.address.toString(), db);
    }

    return db;
  } catch (e) {
    console.error("❌ [OrbitDB] Ошибка при открытии БД:", e);
    return null;
  }
}

/**
 * Рассылает текущий профиль пользователя (ник и аватар) в общую сеть PubSub.
 * Используется при обновлении своего профиля или ответе на WAKEUP.
 */
export async function broadcastMyProfile(customProfileData?: any) {
  if (!globalHelia || !globalProfileDb) {
    console.warn('⚠️ broadcastMyProfile: Нода или база профиля не инициализированы.');
    return;
  }

  try {
    const myPeerId = globalHelia.libp2p.peerId.toString();
    
    const nickname = customProfileData && customProfileData[CONFIG.PROFILE.KEY_NICKNAME] !== undefined
      ? customProfileData[CONFIG.PROFILE.KEY_NICKNAME] 
      : await globalProfileDb.get(CONFIG.PROFILE.KEY_NICKNAME);
      
    const avatarCid = customProfileData && customProfileData[CONFIG.PROFILE.KEY_AVATAR_CID] !== undefined
      ? customProfileData[CONFIG.PROFILE.KEY_AVATAR_CID] 
      : await globalProfileDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);

    const bio = customProfileData && customProfileData[CONFIG.PROFILE.KEY_BIO] !== undefined
      ? customProfileData[CONFIG.PROFILE.KEY_BIO]
      : await globalProfileDb.get(CONFIG.PROFILE.KEY_BIO);

    const avatarServerCid = customProfileData && customProfileData[CONFIG.PROFILE.KEY_AVATAR_SERVER_CID] !== undefined
      ? customProfileData[CONFIG.PROFILE.KEY_AVATAR_SERVER_CID]
      : await globalProfileDb.get(CONFIG.PROFILE.KEY_AVATAR_SERVER_CID);

    const avatarEncryptionKey = customProfileData && customProfileData[CONFIG.PROFILE.KEY_AVATAR_ENCRYPTION_KEY] !== undefined
      ? customProfileData[CONFIG.PROFILE.KEY_AVATAR_ENCRYPTION_KEY]
      : await globalProfileDb.get(CONFIG.PROFILE.KEY_AVATAR_ENCRYPTION_KEY);

    const serverRelays = customProfileData && customProfileData[CONFIG.PROFILE.KEY_SERVER_RELAYS] !== undefined
      ? customProfileData[CONFIG.PROFILE.KEY_SERVER_RELAYS]
      : await globalProfileDb.get(CONFIG.PROFILE.KEY_SERVER_RELAYS);

    const updateMsg = {
      type: CONFIG.PROFILE.MSG_PROFILE_UPDATED,
      senderId: myPeerId || '',
      nickname: nickname || 'Аноним',
      avatarCid: avatarCid || '',
      bio: bio || '',
      avatarServerCid: avatarServerCid || '',
      avatarEncryptionKey: avatarEncryptionKey || '',
      serverRelays: serverRelays || [],
      profileDbAddress: globalProfileDb.address.toString() || '',
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

function getFriendlyAuthErrorMessage(status: string | undefined, rawMessage: string | null, actionType: 'REGISTER' | 'LOGIN'): string {
  if (status === CONFIG.MSG.FORBIDDEN) {
    if (rawMessage === 'Account has been banned') {
      return 'Ваш аккаунт заблокирован.';
    }
    return actionType === 'REGISTER'
      ? 'Превышен лимит регистраций для этого устройства/IP. Попробуйте позже.'
      : 'Вход отклонён сетью.';
  }
  if (status === 'NOT_FOUND') {
    return 'Профиль не найден. Проверьте правильность seed-фразы.';
  }
  return `Не удалось ${actionType === 'REGISTER' ? 'зарегистрироваться' : 'войти'}: все релеи сети недоступны.`;
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

    // 1. Привязываем готовый инстанс из heliaClient
    globalRelayManager = relayManager;

    // 2. Поднимаем IPFS
    globalHelia = await createBrowserHelia();
    
    const libp2p = (globalHelia as any).libp2p as any;

    // 3. Поднимаем OrbitDB и профиль
    globalOrbitDB = await getOrbitDB(globalHelia);
    globalProfileDb = await initProfileDB(globalOrbitDB);
    globalContactsDb = await initContactsDB(globalOrbitDB);
    await initGlobalRegistryDB(globalOrbitDB);

    const pubsub = libp2p.services.pubsub;
    if (!pubsub) {
      throw new Error('PubSub service is not available on libp2p node');
    }

    await pubsub.subscribe(CONFIG.TOPICS.PROFILE_UPDATES_TOPIC);   // Подписываемся на обновления профилей
    await pubsub.subscribe(CONFIG.TOPICS.WAKEUP_SYNC_TOPIC);       // Подписываемся на пинги пробуждения

    // ==========================================
    // ЛОГИКА ОБРАБОТКИ СООБЩЕНИЙ (ОБНОВЛЕНИЯ ПРОФИЛЯ И ПРОБУЖДЕНИЯ)
    // ==========================================
    pubsub.addEventListener('message', async (evt: any) => {
      const msgId = `${evt.detail.from.toString()}_${evt.detail.sequenceNumber}`;
      if (processedPubSubMsgs.has(msgId)) return;
      
      processedPubSubMsgs.add(msgId);
      setTimeout(() => processedPubSubMsgs.delete(msgId), 5000);
      
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
      const senderId = msg.senderId || evt.detail.from.toString();
      
      // Игнорируем эхо от собственных сообщений
      if (senderId === myPeerId) return;

      // 👇 БЛОК ФАЕРВОЛА: Проверяем, не в черном ли списке отправитель
      const { isPeerIgnored } = await import('./contactsService.ts');
      const isBlocked = await isPeerIgnored(globalContactsDb, senderId);
      
      if (isBlocked) {
        console.log(`🚫 [Фаервол] Отклонено PubSub-сообщение (${currentTopic}) от заблокированного: ${senderId.slice(0, 8)}`);
        return;
      }

      // 2. Обработка WAKEUP_PING (Кто-то проснулся)
      if (currentTopic === CONFIG.TOPICS.WAKEUP_SYNC_TOPIC) {
        try {
          if (msg.type === CONFIG.MSG.WAKEUP) {
            console.log(`🔔 [PubSub] Пир ${senderId.slice(-6)} проснулся! Отправляем ему наш профиль для синхронизации.`);
            
            const filteredProfile = await getFilteredProfileData(globalProfileDb, globalContactsDb, senderId);

            if (filteredProfile) {
              await broadcastMyProfile(filteredProfile); 
            }
          }
        } catch (e) {
          console.error('❌ Ошибка при обработке WAKEUP_PING:', e);
        }
        return;
      }

      // 3. Обработка входящих обновлений профиля (MSG_PROFILE_UPDATED)
      if (msg.type === CONFIG.PROFILE.MSG_PROFILE_UPDATED) {
        console.log(`📩 [PubSub Сеть] Получены данные профиля от ${senderId.slice(0,8)}:`, msg);

        await updateContactProfileAddress(globalContactsDb, msg.senderId, msg.profileDbAddress);
        
        let contact = await getContact(globalContactsDb, senderId);
        
        if (!contact) {
          // Если контакта еще не было в базе — создаем его автоматически
          const newContact: ContactItem = {
            id: senderId,
            chatDbAddress: '', 
            nickname: msg.nickname || senderId.slice(0, 8),
            avatarCid: msg.avatarCid || '',
            avatarServerCid: msg.avatarServerCid || '',
            avatarEncryptionKey: msg.avatarEncryptionKey || '',
            serverRelays: msg.serverRelays || [],
            bio: msg.bio || '',
            profileDbAddress: msg.profileDbAddress || '',
            updatedAt: Date.now(),
            isBlocked: false,
            isDeleted: false
          };
          await saveContact(globalContactsDb, newContact);
          console.log(`➕ [PubSub] Автоматически создан новый контакт: ${newContact.nickname}`);
          window.dispatchEvent(new Event('onContactsUpdated'));
        } else {
          // Если контакт есть — проверяем, изменились ли данные
          const isChanged = 
            contact.avatarCid !== msg.avatarCid || 
            contact.nickname !== msg.nickname ||
            contact.bio !== msg.bio ||
            contact.avatarServerCid !== msg.avatarServerCid ||
            contact.avatarEncryptionKey !== msg.avatarEncryptionKey ||
            (!contact.profileDbAddress && !!msg.profileDbAddress) ||
            contact.profileDbAddress !== msg.profileDbAddress;
            // serverRelays намеренно не в сравнении — !== на массивах ломается через reference-inequality,
            // а поле практически всегда меняется вместе с avatarCid/avatarServerCid, так что подхватится попутно

          if (isChanged) {
            console.log(`🔄 [PubSub] Обновляем профиль для контакта: ${msg.nickname || senderId.slice(0, 8)}`);
            
            const updatedContact: ContactItem = {
              ...contact,
              avatarCid: msg.avatarCid ?? contact.avatarCid,
              avatarServerCid: msg.avatarServerCid ?? contact.avatarServerCid,
              avatarEncryptionKey: msg.avatarEncryptionKey ?? contact.avatarEncryptionKey,
              serverRelays: msg.serverRelays ?? contact.serverRelays,
              nickname: msg.nickname ?? contact.nickname,
              bio: msg.bio ?? contact.bio,
              profileDbAddress: msg.profileDbAddress || contact.profileDbAddress,
              updatedAt: Date.now()
            };

            await saveContact(globalContactsDb, updatedContact);
            window.dispatchEvent(new Event('onContactsUpdated'));
          }
        }
      }
    });

    // ==========================================
    // ЛОГИКА ОБРАБОТКИ ПУЛЬСА СЕТИ (PubSub)
    // ==========================================
    // setInterval(() => {
    //   if (globalHelia) {
    //     const allPeers = libp2p.getPeers();
    //     const pubsubPeers = pubsub.getPeers();
    //     const topics = pubsub.getTopics();

    //     console.log(
    //       `📊 Network: Peers=${allPeers.length} | PubSub=${pubsubPeers.length} | Topics=${JSON.stringify(topics)}`
    //     );
    //   }
    // }, 5000);

  // ==========================================
  // 4. Логика регистрации/входа — RPC теперь выполняется ВСЕГДА,
  //    а не только при первой регистрации
  // ==========================================
  {
    const actionType = nicknameForRegistration ? 'REGISTER' : 'LOGIN';

    if (nicknameForRegistration) {
      console.log(`📝 [Init] Сохраняем никнейм: ${nicknameForRegistration}`);
      await globalProfileDb.put(CONFIG.PROFILE.KEY_NICKNAME, nicknameForRegistration);
      await globalProfileDb.put(CONFIG.PROFILE.KEY_DATE_CREATED, Date.now());
    }

    const fingerprint = await generateDeviceFingerprint();
    const ipAddress = await getClientIpAddress();

    await globalProfileDb.put(CONFIG.KEY_FINGERPRINT, fingerprint);
    await globalProfileDb.put(CONFIG.KEY_IP_ADDRESS, ipAddress);

    const profileAddressStr = globalProfileDb.address.toString();
    const relays = globalRelayManager.getPool();
    let registrationSuccess = false;
    let lastFailureStatus: string | undefined;
    let lastFailureMessage: string | null = null;

    for (const relay of relays) {
      try {
        console.log(`⏳ [Init] Пробуем ${actionType === 'REGISTER' ? 'зарегистрироваться' : 'войти'} через релей: ${relay.name}...`);

        const result = await globalRelayManager.registerWithRelay(
          libp2p, relay, profileAddressStr, fingerprint, ipAddress, actionType
        );

        if (result.success) {
          registrationSuccess = true;
          const activeIdx = relays.indexOf(relay);
          globalRelayManager.setActiveIndex(activeIdx);
          console.log(`🎉 [Init] Сетевой антифрод успешно пройден на релее ${relay.name}!`);
          break;
        } else {
          lastFailureStatus = result.status;
          lastFailureMessage = result.message || null;
          console.warn(`⚠️ [Init] Релей ${relay.name} отклонил ${actionType === 'REGISTER' ? 'регистрацию' : 'вход'}: ${result.message}`);
        }
      } catch (relayError: any) {
        console.warn(`⚠️ [Init] Релей ${relay.name} недоступен по сети: ${relayError.message || relayError}`);
      }
    }

    if (!registrationSuccess) {
      throw new Error(getFriendlyAuthErrorMessage(lastFailureStatus, lastFailureMessage, actionType));
    }
  }

    console.log('✅ [Init] Инициализация успешно завершена!');
    
    // 🔥 СМАРТ-ФИКС: Циклический запуск WAKEUP с контролем пиров и версионированием
    let wakeupAttempts = 0;
    const maxWakeupAttempts = 10; 

    const trySendWakeup = setInterval(async () => {
      wakeupAttempts++;
      
      if (wakeupAttempts > maxWakeupAttempts) {
        console.warn('❌ [Mesh] Не удалось дождаться появления PubSub пиров. WAKEUP отменен.');
        clearInterval(trySendWakeup);
        return;
      }

      try {
        const pubsub = globalHelia?.libp2p?.services?.pubsub;
        if (!pubsub) return;

        const peers = pubsub.getPeers();

        if (peers.length > 0) {
          console.log(`📢 [Mesh] Сеть ожила (пиров: ${peers.length}). Отправляем WAKEUP с таймстемпом на попытке ${wakeupAttempts}...`);
          
          const myPeerId = globalHelia.libp2p.peerId.toString();
          const lastUpdated = await globalProfileDb.get(CONFIG.PROFILE.KEY_LAST_UPDATED) || Date.now();

          const wakeupMsg = { 
            type: CONFIG.MSG.WAKEUP,
            senderId: myPeerId,
            updatedAt: lastUpdated
          };

          await pubsub.publish(
            CONFIG.TOPICS.WAKEUP_SYNC_TOPIC,
            new TextEncoder().encode(JSON.stringify(wakeupMsg))
          );

          clearInterval(trySendWakeup); 
        } else {
          console.log(`⏳ [Mesh] Ожидание PubSub пиров для отправки WAKEUP... (попытка ${wakeupAttempts}/${maxWakeupAttempts})`);
        }
      } catch (err) {
        console.error('❌ Ошибка при попытке отправить WAKEUP:', err);
      }
    }, 3000); 

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

    globalHelia = null;
    globalOrbitDB = null;
    globalProfileDb = null;
    globalRelayManager = null;
    isInitializing = false;

    throw error; 
  } finally {
    isInitializing = false;
  }
}

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