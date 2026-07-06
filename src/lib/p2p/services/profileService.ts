
/* * Этот файл отвечает за инициализацию базы данных профиля пользователя в OrbitDB.
  * Здесь мы создаем или открываем базу данных типа keyvalue, которая будет хранить информацию о пользователе, 
  * такую как никнейм, статус и другие настройки.
  * База данных профиля будет привязана к Identity, которая создается на основе seed-фразы, 
  * что обеспечивает безопасность и приватность данных пользователя.
  * В дальнейшем мы будем использовать эту базу для хранения и управления данными профиля, 
  * а также для синхронизации с другими пользователями в сети.
  * 
  * const myName = await profileDb.get(CONFIG.PROFILE.KEY_NICKNAME);
  * 
  * await profileDb.put(CONFIG.PROFILE.KEY_NICKNAME, 'Новый Крутой Ник');
*/

import { IPFSAccessController } from '@orbitdb/core';
import { CONFIG } from "../config.ts";
import { getOrOpenDb } from './authService.ts';
import { saveContact } from './contactsService.ts';

export interface SyncResult {
  success: boolean;
  status: 'SUCCESS' | 'TRANSIENT_FAILURE' | 'ERROR' | 'UP_TO_DATE';
  reason?: string;
}

export async function initProfileDB(orbitdb: any, nicknameForRegistration?: string) {
  try {
    console.log(`👤 [ProfileDB] Инициализация базы профиля...`);

    // 1. Создаем/Открываем базу с жестким контролем доступа
    const profileDb = await orbitdb.open(CONFIG.PROFILE.DB_PROFILE, {
      type: 'keyvalue',
      // Явно указываем, что писать в базу может ТОЛЬКО владелец текущего Identity
      AccessController: IPFSAccessController({ write: [orbitdb.identity.id] }) 
    });

    console.log(`✅ [ProfileDB] База открыта. Адрес: ${profileDb.address}`);
    console.log(`🔒 [ProfileDB] Право на запись только у: ${orbitdb.identity.id}`);

    // 2. Заполнение базовых данных
    const existingNickname = await profileDb.get(CONFIG.PROFILE.KEY_NICKNAME);

    if (!existingNickname) {
      console.log(`🆕 [ProfileDB] Данные профиля пусты. Заполняем...`);
      
      // Эти операции пройдут успешно, так как наш Identity совпадает с AccessController
      await profileDb.put(CONFIG.PROFILE.KEY_NICKNAME, nicknameForRegistration || 'Анонимный пользователь');
      await profileDb.put(CONFIG.PROFILE.KEY_DATE_CREATED, Date.now());

      console.log(`✅ [ProfileDB] Базовые данные успешно записаны.`);
    } else {
      console.log(`♻️ [ProfileDB] Профиль восстановлен: ${existingNickname}`);
    }

    return profileDb;
  } catch (error) {
    console.error('❌ [ProfileDB] Ошибка инициализации профиля:', error);
    throw error;
  }
}
/**
 * Функция запроса профиля в сети через PubSub. Она отправляет сообщение с типом PROFILE_REQUEST и ID запрашиваемого пира.
 * @param helia - экземпляр Helia, через который будет отправлен запрос
 * @param targetPeerId - PeerID пользователя, чей профиль мы хотим запросить
 */
export const requestPeerProfile = async (helia: any, targetPeerId: string) => {
  if (!helia) {
    console.error('⚠️ [ProfileService] Helia не инициализирована для запроса профиля');
    return;
  }
  try {
    const pubsub = helia.libp2p.services.pubsub;
    const msg = { type: CONFIG.PROFILE.MSG_PROFILE_REQUEST, targetId: targetPeerId };
    
    await pubsub.publish(
      CONFIG.TOPICS.PROFILE_UPDATES_TOPIC, 
      new TextEncoder().encode(JSON.stringify(msg))
    );
    
    console.log(`📤 [PubSub] Отправлен запрос профиля (PROFILE_REQUEST) для: ${targetPeerId}`);
  } catch (error) {
    console.error('❌ [PubSub] Ошибка при запросе профиля:', error);
  }
};

/**
 * Принудительная синхронизация профиля контакта напрямую через OrbitDB.
 * Вызывать при клике на кнопку "Обновить профиль".
 */

export const forceSyncContactProfile = async (contactsDb: any, contact: any): Promise<SyncResult> => {
  if (!contact || !contact.profileDbAddress) {
    return { success: false, status: 'ERROR', reason: 'Invalid contact data' };
  }

  console.log(`🔄 [ProfileSync] Открываем БД профиля для ${contact.nickname || contact.id}...`);
  
  try {
    // Твоя текущая логика открытия удаленной базы данных
    // Предположим, тут идет проверка на доступность пиров или таймаут
    const remoteDb = await getOrOpenDb(contact.profileDbAddress);
    
    if (!remoteDb) {
      // Если база не открылась из-за проблем с маршрутами (transient connection)
      console.warn(`⏳ [ProfileSync] Сеть занята (transient connection) для ${contact.id}. Нужен повтор.`);
      return { success: false, status: 'TRANSIENT_FAILURE', reason: 'Transient network state' };
    }

    // Читаем свежие данные
    const freshName = await remoteDb.get(CONFIG.PROFILE.KEY_NICKNAME);
    const freshAvatar = await remoteDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);
    const freshBio = await remoteDb.get(CONFIG.PROFILE.KEY_BIO);

    // Проверяем, изменилось ли что-то по сравнению с тем, что есть в контакте
    const hasChanges = freshName !== contact.nickname || 
                      freshAvatar !== contact.avatarCid || 
                      freshBio !== contact.bio;

    if (hasChanges) {
      const cleanProfile = sanitizeForIPLD({
        nickname: freshName || 'Аноним', 
        avatarCid: freshAvatar || '', 
        bio: freshBio || '', 
        updatedAt: Date.now() 
      });
      await saveContact(contactsDb, { 
        ...contact, 
        ...cleanProfile
      });
      return { success: true, status: 'SUCCESS' };
    }

    return { success: true, status: 'UP_TO_DATE' };
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
  
  // Получаем текущий режим приватности из OrbitDB профиля (по умолчанию public)
  const privacyMode = (await profileDb.get(CONFIG.PROFILE.KEY_PRIVACY)) || 'public';
  
  // 🛡️ 1. Режим PRIVATE: Стираем данные «в ноль» для любого запрашивающего
  if (privacyMode === 'private') {
    console.log(`🔒 [ProfileService] Профиль в режиме private. Отправляем пустой слепок для ${requesterPeerId}`);
    return {
      [CONFIG.PROFILE.KEY_NICKNAME]: 'Скрытый профиль',
      [CONFIG.PROFILE.KEY_BIO]: '',
      [CONFIG.PROFILE.KEY_AVATAR_CID]: '',
      privacyMode
    };
  }
  
  // 🛡️ 2. Режим CONTACTS_ONLY: Проверяем, есть ли пир в списке одобренных контактов
  if (privacyMode === 'contacts_only') {
    const { getContact } = await import('./contactsService.ts');
    const contact = await getContact(contactsDb, requesterPeerId);
    
    // Если контакта нет или он мягко удален — отдаем пустой слепок
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
  
  // 🌐 3. Режим PUBLIC (или успешный проход проверки контактов): Отдаем реальные данные
  const rawData = {
    [CONFIG.PROFILE.KEY_NICKNAME]: await profileDb.get(CONFIG.PROFILE.KEY_NICKNAME),
    [CONFIG.PROFILE.KEY_BIO]: await profileDb.get(CONFIG.PROFILE.KEY_BIO),
    [CONFIG.PROFILE.KEY_AVATAR_CID]: await profileDb.get(CONFIG.PROFILE.KEY_AVATAR_CID),
    privacyMode
  };

  // Прогоняем через санитайзер, чтобы вычистить возможные undefined из БД
  return sanitizeForIPLD(rawData);
};

// Утилита для очистки объекта от undefined (оставляем null и валидные данные)
function sanitizeForIPLD<T>(obj: T): T {
  // Самый надежный и быстрый способ нативно отбросить все undefined поля:
  return JSON.parse(JSON.stringify(obj));
}