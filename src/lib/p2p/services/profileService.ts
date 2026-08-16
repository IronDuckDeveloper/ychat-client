/* * Этот файл отвечает за инициализацию базы данных профиля пользователя в OrbitDB.
  * Здесь мы создаем или открываем базу данных типа keyvalue, которая будет хранить информацию о пользователе, 
  * такую как никнейм, статус и другие настройки.
  * База данных профиля будет привязана к Identity, которая создается на основе seed-фразы, 
  * что обеспечивает безопасность и приватность данных пользователя.
  * В дальнейшем мы будем использовать эту базу для хранения и управления данными профиля, 
  * а также для синхронизации с другими пользователями в сети.
*/

import { IPFSAccessController } from '@orbitdb/core';
import { CONFIG } from "../config.ts";
import { getOrOpenDb, globalOrbitDB } from './authService.ts';
import { saveContact, type ContactItem } from './contactsService.ts';

export interface SyncResult {
  success: boolean;
  status: 'SUCCESS' | 'TRANSIENT_FAILURE' | 'ERROR' | 'UP_TO_DATE';
  reason?: string;
}

// Кэш для инстанса глобального реестра профилей
export let globalRegistryDbInstance: any = null;
// Храним ID контактов, которые уже синхронизировались, чтобы не долбить БД по кругу
const recentlySyncedPeers = new Set<string>();

// 🔥 Добавляем кэш промиса инициализации для защиты от параллельной гонки
let profileInitPromise: Promise<any> | null = null;

export async function initProfileDB(orbitdb: any, nicknameForRegistration?: string) {
  // Если инициализация уже запущена параллельно (например, из регистрации),
  // а повторный вызов пришел без аргумента nicknameForRegistration — просто ждем результат первой задачи
  if (profileInitPromise && !nicknameForRegistration) {
    console.log(`⏳ [ProfileDB] Инициализация уже выполняется, ожидаем завершения...`);
    return await profileInitPromise;
  }

  const initTask = (async () => {
    try {
      console.log(`👤 [ProfileDB] Инициализация базы профиля...`);

      const profileDb = await orbitdb.open(CONFIG.PROFILE.DB_PROFILE, {
        type: 'keyvalue',
        AccessController: IPFSAccessController({ write: [orbitdb.identity.id] }) 
      });

      console.log(`✅ [ProfileDB] База открыта. Адрес: ${profileDb.address}`);
      console.log(`🔒 [ProfileDB] Право на запись только у: ${orbitdb.identity.id}`);

      const existingNickname = await profileDb.get(CONFIG.PROFILE.KEY_NICKNAME);
      const dateCreated = await profileDb.get(CONFIG.PROFILE.KEY_DATE_CREATED);

      // 1. Если явно передан никнейм для регистрации — приоритетно записываем его
      if (nicknameForRegistration) {
        if (existingNickname !== nicknameForRegistration) {
          console.log(`🆕 [ProfileDB] Записываем никнейм при регистрации: ${nicknameForRegistration}`);
          await profileDb.put(CONFIG.PROFILE.KEY_NICKNAME, nicknameForRegistration);
          if (!dateCreated) {
            await profileDb.put(CONFIG.PROFILE.KEY_DATE_CREATED, Date.now());
          }
          console.log(`✅ [ProfileDB] Базовые данные успешно записаны.`);
        } else {
          console.log(`♻️ [ProfileDB] Профиль восстановлен: ${existingNickname}`);
        }
      } 
      // 2. Если никнейм не передан, и база абсолютно пустая — только тогда пишем дефолтный никнейм
      else if (!existingNickname && !dateCreated) {
        console.log(`🆕 [ProfileDB] Данные профиля пусты. Заполняем...`);
        
        await profileDb.put(CONFIG.PROFILE.KEY_NICKNAME, 'Анонимный пользователь');
        await profileDb.put(CONFIG.PROFILE.KEY_DATE_CREATED, Date.now());

        console.log(`✅ [ProfileDB] Базовые данные успешно записаны.`);
      } else {
        console.log(`♻️ [ProfileDB] Профиль восстановлен: ${existingNickname || 'Анонимный пользователь'}`);
      }

      return profileDb;
    } catch (error) {
      console.error('❌ [ProfileDB] Ошибка инициализации профиля:', error);
      throw error;
    } finally {
      profileInitPromise = null;
    }
  })();

  profileInitPromise = initTask;
  return await initTask;
}

/**
 * Инициализирует глобальный реестр при старте приложения
 */
export async function initGlobalRegistryDB(orbitdb: any) {
  try {
    console.log(`🌐 [GlobalRegistry] Инициализация глобального реестра...`);

    const registryAddress = localStorage.getItem(CONFIG.KEY_GLOBAL_REGISTRY_ADDRESS) || CONFIG.GLOBAL_REGISTRY_ADDRESS;

    if (!registryAddress || typeof registryAddress !== 'string' || registryAddress.trim() === '') {
      console.warn('⚠️ [GlobalRegistry] Адрес глобального реестра еще не получен, пропускаем инициализацию.');
      return;
    }

    // Открываем только если адрес действительно есть
    globalRegistryDbInstance = await orbitdb.open(registryAddress);
        
    console.log(`✅ [GlobalRegistry] Реестр открыт: ${globalRegistryDbInstance.address}`);

    // 🔥 Запрашиваем локальные/сетевые данные, чтобы OrbitDB инициировал обмен heads с реле
    await globalRegistryDbInstance.all();

    // Подписываемся на события репликации
    globalRegistryDbInstance.events.on('update', () => {
      console.log('🔄 [GlobalRegistry] Реестр получил новые данные из сети!');
      window.dispatchEvent(new Event('onContactsUpdated'));
    });

    return globalRegistryDbInstance;
  } catch (err) {
    console.error('❌ [GlobalRegistry] Ошибка открытия реестра:', err);
    return null;
  }
}

/**
 * Возвращает уже открытый инстанс глобального реестра
 */
export async function getGlobalRegistryDb() {
  if (globalRegistryDbInstance) return globalRegistryDbInstance;
  if (!globalOrbitDB) return null;
  
  // Если по какой-то причине реестр не был открыт при старте — открываем
  return await initGlobalRegistryDB(globalOrbitDB);
}

/**
 * Принудительная синхронизация профиля контакта напрямую через OrbitDB.
 * Если адрес базы неизвестен — ищем его в глобальном реестре DB_PROFILE_GLOBAL.
 */
export const forceSyncContactProfile = async (contactsDb: any, contact: ContactItem): Promise<SyncResult> => {
  if (recentlySyncedPeers.has(contact.id)) {
    return { success: false, status: 'TRANSIENT_FAILURE', reason: 'Peer recently synced' };
  }

  recentlySyncedPeers.add(contact.id);
  setTimeout(() => recentlySyncedPeers.delete(contact.id), 60000);
  
  if (!contactsDb || !contact) {
    return { success: false, status: 'ERROR', reason: 'Invalid arguments' };
  }

  try {
    let targetDbAddress = contact.profileDbAddress;

    // 1. Проверяем Глобальный Реестр
    const registryDb = await getGlobalRegistryDb();
    if (registryDb) {
      const rawValue = await registryDb.get(contact.id);
      let latestRegistryAddress = '';
      
      if (typeof rawValue === 'string') {
        latestRegistryAddress = rawValue;
      } else if (rawValue && typeof rawValue === 'object') {
        latestRegistryAddress = rawValue.address || rawValue.profileDbAddress || rawValue.value || '';
      }

      // Если в реестре есть адрес и он отличается — СРАЗУ сохраняем его в contactsDb!
      if (latestRegistryAddress && latestRegistryAddress !== targetDbAddress) {
        console.log(`🌐 [Global Registry] Обнаружен НОВЫЙ адрес профиля для ${contact.id.slice(-6)}: ${latestRegistryAddress}`);
        targetDbAddress = latestRegistryAddress;

        // Фиксируем адрес в локальной базе до начала ожидания сети
        contact = {
          ...contact,
          profileDbAddress: targetDbAddress,
          updatedAt: Date.now()
        };
        await saveContact(contactsDb, contact);
        window.dispatchEvent(new Event('onContactsUpdated'));
      }
    }

    if (!targetDbAddress) {
      console.warn(`⚠️ [ProfileSync] У контакта ${contact.id.slice(-6)} нет адреса БД ни локально, ни в DB_PROFILE_GLOBAL.`);
      recentlySyncedPeers.delete(contact.id);
      return { success: false, status: 'TRANSIENT_FAILURE', reason: 'Profile DB address unknown in registry' };
    }

    console.log(`🔄 [ProfileSync] Открываем БД профиля: ${targetDbAddress}`);
    const remoteDb = await getOrOpenDb(targetDbAddress);

    if (!remoteDb) {
      console.warn(`⏳ [ProfileSync] Не удалось открыть OrbitDB для ${contact.id.slice(-6)}.`);
      recentlySyncedPeers.delete(contact.id);
      return { success: false, status: 'TRANSIENT_FAILURE', reason: 'Transient network state' };
    }

    // 2. Функция для чтения и применения изменений профиля
    const applyProfileData = async (isFromEvent = false) => {
      let freshName = await remoteDb.get(CONFIG.PROFILE.KEY_NICKNAME);
      let freshAvatar = await remoteDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);
      let freshBio = await remoteDb.get(CONFIG.PROFILE.KEY_BIO);
      let freshServerCid = await remoteDb.get(CONFIG.PROFILE.KEY_AVATAR_SERVER_CID || 'avatar_server_cid');
      let freshEncryptionKey = await remoteDb.get(CONFIG.PROFILE.KEY_AVATAR_ENCRYPTION_KEY);
      
      // ДЕБАГ: проверим, что именно прилетает из базы
      console.log(`🔍 [ProfileSync] DEBUG: Для ${contact.nickname} ключ из БД:`, freshEncryptionKey);

      if (!freshName) {
        console.log('⏳ [ProfileSync] Данные профиля еще не среплицировались, ждем сеть (5 сек)...');
        
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            resolve();
          }, 5000);

          remoteDb.events.on('update', async () => {
            freshName = await remoteDb.get(CONFIG.PROFILE.KEY_NICKNAME);
            if (freshName) {
              console.log('✅ [ProfileSync] Данные профиля получены из сети!');
              freshAvatar = await remoteDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);
              freshBio = await remoteDb.get(CONFIG.PROFILE.KEY_BIO);
              freshServerCid = await remoteDb.get(CONFIG.PROFILE.KEY_AVATAR_SERVER_CID || 'avatar_server_cid');
              freshEncryptionKey = await remoteDb.get(CONFIG.PROFILE.KEY_AVATAR_ENCRYPTION_KEY);
              
              clearTimeout(timer);
              resolve();
            }
          });
        });
      }

      if (!freshName) {
        console.log('⏳ [ProfileSync] Данные профиля еще не среплицировались, ждем сеть...');
        return false;
      }

      const updatedName = freshName || contact.nickname;
      const updatedAvatar = freshAvatar !== undefined ? freshAvatar : contact.avatarCid;
      const updatedBio = freshBio !== undefined ? freshBio : contact.bio;
      const updatedServerCid = freshServerCid !== undefined ? freshServerCid : contact.avatarServerCid;
      const updatedEncryptionKey = freshEncryptionKey !== undefined ? freshEncryptionKey : (contact.avatarEncryptionKey || null);

      const hasChanges = 
        updatedName !== contact.nickname || 
        updatedAvatar !== contact.avatarCid || 
        updatedBio !== contact.bio ||
        updatedServerCid !== contact.avatarServerCid ||
        updatedEncryptionKey !== contact.avatarEncryptionKey ||
        targetDbAddress !== contact.profileDbAddress;

      if (hasChanges) {
        const cleanProfile = sanitizeForIPLD({
          nickname: updatedName,
          avatarCid: updatedAvatar,
          bio: updatedBio,
          avatarServerCid: updatedServerCid,
          avatarEncryptionKey: updatedEncryptionKey,
          profileDbAddress: targetDbAddress,
          updatedAt: Date.now()
        });

        const updatedContact: ContactItem = {
          ...contact,
          ...cleanProfile
        };

        await saveContact(contactsDb, updatedContact);
        window.dispatchEvent(new Event('onContactsUpdated'));
        console.log(`✅ [ProfileSync] Профиль ${contact.id.slice(-6)} успешно обновлен${isFromEvent ? ' (из сети)' : ''}: ${updatedName}`);
        return true;
      }
      return false;
    };

    // 3. Слушатель репликации
    if (!remoteDb._hasProfileSyncListener) {
      remoteDb.events.on('update', async () => {
        console.log(`📡 [ProfileSync] Прилетели новые данные профиля для ${contact.id.slice(-6)}, обновляем...`);
        await applyProfileData(true);
      });
      remoteDb._hasProfileSyncListener = true;
    }

    const changed = await applyProfileData(false);

    return { success: true, status: changed ? 'SUCCESS' : 'UP_TO_DATE' };
  } catch (error: any) {
    console.error(`❌ [ProfileSync] Критическая ошибка синка профиля ${contact.id}:`, error);
    return { success: false, status: 'ERROR', reason: error.message };
  }
};

/**
 * Фильтрация данных профиля перед отправкой в сеть на основе политик приватности.
 */
export const getFilteredProfileData = async (profileDb: any, contactsDb: any, requesterPeerId: string) => {
  if (!profileDb) return null;
  
  const privacyMode = (await profileDb.get(CONFIG.PROFILE.KEY_PRIVACY)) || 'public';
  
  if (privacyMode === 'private') {
    console.log(`🔒 [ProfileService] Профиль в режиме private. Отправляем пустой слепок для ${requesterPeerId}`);
    return {
      [CONFIG.PROFILE.KEY_NICKNAME]: 'Скрытый профиль',
      [CONFIG.PROFILE.KEY_BIO]: '',
      [CONFIG.PROFILE.KEY_AVATAR_CID]: '',
      privacyMode
    };
  }
  
  if (privacyMode === 'contacts_only') {
    const { getContactById } = await import('./contactsService.ts');
    const contact = await getContactById(contactsDb, requesterPeerId);
    
    if (!contact || contact.isDeleted) {
      console.log(`🔒 [ProfileService] Пира ${requesterPeerId} нет в контактах. Отправляем пустой слепок.`);
      return {
        [CONFIG.PROFILE.KEY_NICKNAME]: 'Только для контактов',
        [CONFIG.PROFILE.KEY_BIO]: '',
        [CONFIG.PROFILE.KEY_AVATAR_CID]: '',
        privacyMode
      };
    }
  }
  
  const rawData = {
    [CONFIG.PROFILE.KEY_NICKNAME]: await profileDb.get(CONFIG.PROFILE.KEY_NICKNAME),
    [CONFIG.PROFILE.KEY_BIO]: await profileDb.get(CONFIG.PROFILE.KEY_BIO),
    [CONFIG.PROFILE.KEY_AVATAR_CID]: await profileDb.get(CONFIG.PROFILE.KEY_AVATAR_CID),
    privacyMode
  };

  return sanitizeForIPLD(rawData);
};

function sanitizeForIPLD<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
