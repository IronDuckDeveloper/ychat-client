import { IPFSAccessController } from '@orbitdb/core';
import { CONFIG, type ContactItem } from '../config.ts';
import { requestPeerProfile } from './profileService'; 
import { getOrOpenDb } from './authService.ts';

  // Глобальный кэш для защиты от двойной синхронизации 
  const syncCooldowns = new Map<string, number>();

// 🧠 Локальный кэш контактов для мгновенного UI и дедупликатор запросов
let cachedContacts: ContactItem[] = [];
let getAllContactsPromise: Promise<ContactItem[]> | null = null;
let isSubscribedToUpdates = false;

/**
 * Вспомогательная функция для синхронизации локального кэша с физической БД.
 * Вызывается автоматически при успешном чтении или изменениях.
 */
function updateLocalCache(allRecords: any[]) {
  if (!Array.isArray(allRecords)) {
    console.warn('⚠️ [ContactsDB] OrbitDB вернул не массив записей:', allRecords);
    return;
  }

  cachedContacts = allRecords
    .map((record: any) => record.value as ContactItem)
    // Проверяем c.id, чтобы убрать "undefined" из UI и починить ключи React
    .filter((c: ContactItem) => !!c && !!c.id && !c.isDeleted)
    .sort((a: ContactItem, b: ContactItem) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function initContactsDB(orbitdb: any) {
  console.log(`📇 [ContactsDB] Открываем базу контактов...`);

  const contactsDb = await orbitdb.open(CONFIG.PROFILE.DB_CONTACTS || 'my-contacts', {
    type: 'keyvalue',
    AccessController: IPFSAccessController({ write: [orbitdb.identity.id] })
  });

  console.log(`✅ [ContactsDB] База контактов готова! Адрес: ${contactsDb.address.toString()}`);
  return contactsDb;
}

export const getContactById = async (contactsDb: any, id: string): Promise<ContactItem | null> => {
  if (!contactsDb || !id) return null;
  try {
    const contact = await contactsDb.get(id);
    return contact || null;
  } catch (error) {
    console.error(`❌ [ContactsDB] Ошибка при поштучном получении контакта ${id}:`, error);
    return null;
  }
};

// 🛡️ Хелпер для быстрой проверки блокировки пира
export const isPeerBlocked = async (contactsDb: any, peerId: string): Promise<boolean> => {
  const localBlacklistStr = localStorage.getItem(CONFIG.PROFILE.BLACKLIST_KEY);
  if (localBlacklistStr) {
    try {
      const localBlacklist: string[] = JSON.parse(localBlacklistStr);
      if (localBlacklist.includes(peerId)) {
        return true; 
      }
    } catch (e) {
      console.error('Ошибка парсинга блэклиста:', e);
    }
  }

  if (contactsDb) {
    try {
      const contact = await getContact(contactsDb, peerId);
      if (contact && contact.isBlocked) {
        return true;
      }
    } catch (e) {
      console.error('Ошибка проверки блокировки в БД:', e);
    }
  }

  return false; 
};

export const saveContact = async (contactsDb: any, contact: ContactItem) => {
  if (!contactsDb) throw new Error("База контактов не инициализирована");
  
  // 1. 🔥 ОПЕРЕЖАЮЩЕЕ ОБНОВЛЕНИЕ: Мгновенно обновляем кэш ДО записи в базу.
  // Это гарантирует, что если юзер мгновенно выйдет из чата, React уже получит 0 непрочитанных.
  let newCache = [...cachedContacts];
  const idx = newCache.findIndex(c => c.id === contact.id);
  if (contact.isDeleted) {
    if (idx !== -1) newCache.splice(idx, 1);
  } else {
    if (idx !== -1) newCache[idx] = contact;
    else newCache.push(contact);
    newCache.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  cachedContacts = newCache; 

  // 2. Асинхронно сохраняем на диск (React не будет ждать эту операцию)
  await contactsDb.put(contact.id, contact); 
  console.log(`💾 [ContactsDB] Контакт ${contact.nickname || contact.id} сохранен.`);
};

export const getContact = async (contactsDb: any, peerId: string): Promise<ContactItem | null> => {
  if (!contactsDb) return null;
  try {
    return await contactsDb.get(peerId) || null;
  } catch {
    return null;
  }
};

/**
 * ⚡ Оптимизированное получение всех контактов.
 * Предотвращает множественные параллельные запросы к Safari IndexedDB.
 */
export const getAllContacts = async (contactsDb: any): Promise<ContactItem[]> => {
  if (!contactsDb) return [];
  
  // Если данные уже есть в кэше — отдаем их мгновенно (0ms)
  if (cachedContacts.length > 0) {
    return [...cachedContacts]; 
  }

  // Если запрос к БД прямо сейчас ЗАДЕНЯН (уже выполняется другим компонентом),
  // возвращаем этот же Promise, не создавая новую транзакцию в Safari.
  if (getAllContactsPromise) {
    return getAllContactsPromise;
  }

  // Подписываемся на живые обновления репликации OrbitDB (один раз за сессию)
  if (!isSubscribedToUpdates && contactsDb.events) {
    isSubscribedToUpdates = true;
    contactsDb.events.on('update', async () => {
      try {
        const allRecords = await contactsDb.all();
        updateLocalCache(allRecords);
        window.dispatchEvent(new Event('onContactsUpdated'));
      } catch (err) {
        console.error('❌ [ContactsDB] Ошибка автообновления кэша:', err);
      }
    });
  }

  getAllContactsPromise = (async () => {
    try {
      const allRecords = await contactsDb.all();
      updateLocalCache(allRecords);
      return cachedContacts;
    } catch (error) {
      console.error('❌ [ContactsDB] Критическая ошибка чтения `.all()`:', error);
      return [];
    } finally {
      // Обязательно очищаем промис дедупликатора, когда операция завершена
      getAllContactsPromise = null;
    }
  })();

  return getAllContactsPromise;
};

export const deleteContact = async (contactsDb: any, contactId: string): Promise<boolean> => {
  if (!contactsDb) return false;
  try {
    const contact = await getContact(contactsDb, contactId);
    if (contact) {
      contact.isDeleted = true;
      contact.updatedAt = Date.now();
      await saveContact(contactsDb, contact);
      console.log(`🗑️ [ContactsDB] Контакт ${contactId} мягко удален (скрыт).`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Ошибка при удалении контакта ${contactId}:`, error);
    return false;
  }
};

export const updateLastMessage = async (
  db: any, 
  peerId: string, 
  text: string, 
  timestamp: number,
  incrementUnread: boolean = false
) => {
  if (!db || !peerId) return;
  
  try {
    const contact = await getContact(db, peerId) || {
      id: peerId,
      profileDbAddress: '',
      chatDbAddress: '',
      nickname: `${peerId.substring(0, 6)}...`,
      avatarCid: '',
      updatedAt: timestamp,
      unreadCount: 0,
      lastMessageTime: 0
    };

    if (timestamp < (contact.lastMessageTime || 0)) {
      return; 
    }

    contact.lastMessage = text;
    contact.lastMessageTime = timestamp;
    contact.updatedAt = Math.max(contact.updatedAt, timestamp);

    if (incrementUnread) {
      contact.unreadCount = (contact.unreadCount || 0) + 1;
    }

    await saveContact(db, contact);
    window.dispatchEvent(new Event('onContactsUpdated'));
    
  } catch (error) {
    console.error(`❌ [ContactsService] Ошибка записи превью:`, error);
  }
};

export const clearUnread = async (db: any, peerId: string) => {
  if (!db || !peerId) return;
  try {
    const contact = await getContact(db, peerId);
    if (contact && (contact.unreadCount || 0) > 0) {
      contact.unreadCount = 0;
      await saveContact(db, contact);
      window.dispatchEvent(new Event('onContactsUpdated'));
    }
  } catch (error) {
    console.error(`❌ [ContactsService] Ошибка сброса счетчика:`, error);
  }
};

export const addContactIfMissing = async (db: any, helia: any, peerId: string) => {
  if (!db || !peerId) return;
  
  try {
    const contact = await getContact(db, peerId);

    if (!contact) {
      const newContact: ContactItem = {
        id: peerId,
        profileDbAddress: '',
        chatDbAddress: '',
        nickname: `${peerId.substring(0, 6)}...`,
        avatarCid: '',
        updatedAt: Date.now(),
        unreadCount: 0,
        isDeleted: false
      };
      
      await saveContact(db, newContact);
      window.dispatchEvent(new Event('onContactsUpdated'));

      if (helia) {
        await requestPeerProfile(helia, peerId);
      }
    }
  } catch (err) {
    console.error(`❌ [ContactsService] Ошибка автодобавления:`, err);
  }
};

export async function updateChatDbAddress(db: any, peerId: string, address: string) {
  if (!db || !peerId || !address) return;
  
  try {
    const contact = await getContact(db, peerId);
    if (contact) {
      if (contact.chatDbAddress === address) return;
      contact.chatDbAddress = address;
      await saveContact(db, contact); // Используем saveContact чтобы обновить кэш
      console.log(`🎯 [ContactsDB] Сохранен адрес базы чата: ${address}`);

      setTimeout(async () => {
        await syncContactHistory(contact, db);
      }, 200);
    }
  } catch (error) {
    console.error(`❌ [ContactsDB] Ошибка при сохранении адреса:`, error);
  }
}

export async function syncContactHistory(contact: any, contactsDb: any) {
  if (contact.isBlocked) return;
  if (!contact.chatDbAddress) return;

  // 🛡️ ТАМОЖНЯ: Проверяем, не проверяли ли мы этот чат только что
  const now = Date.now();
  const lastSynced = syncCooldowns.get(contact.id) || 0;

  if (now - lastSynced < CONFIG.COOLDOWN_TIME) {
    // Тихо выходим, не трогая базу данных. Observer идет лесом.
    // console.log(`🛡️ [Sync] Контакт ${contact.nickname} уже проверен App.tsx. Скипаем.`);
    return;
  }

  // Записываем время текущей проверки
  syncCooldowns.set(contact.id, now);

  const chatDb = await getOrOpenDb(contact.chatDbAddress);
  if (!chatDb) return;

  await new Promise<void>((resolve) => {
    let idleTimer: NodeJS.Timeout;
    let isFinished = false;

    const finalizeSync = async () => {
      if (isFinished) return;
      isFinished = true;

      clearTimeout(idleTimer);
      chatDb.events.off('update', onUpdate); 

      try {
        const records = [];
        for await (const record of chatDb.iterator({ limit: 10 })) {
          records.push(record);
        }
        
        if (records.length === 0) return;

        const messages = records.map((r: any) => r.payload?.value || r.value || r);
        messages.sort((a: any, b: any) => a.ts - b.ts);
        
        const latestMsg = messages[messages.length - 1];
        const contactLastTime = contact.lastMessageTime || 0;

        const newMessages = messages.filter((msg: any) => msg.ts > contactLastTime);

        if (newMessages.length > 0) {
          console.log(`📥 [Холодный старт] Нашли ${newMessages.length} сообщений от ${contact.nickname}`);
          
          const isCurrentlyInThisChat = window.location.pathname.includes(contact.id);
          let newUnreadCount = !isCurrentlyInThisChat ? (contact.unreadCount || 0) + newMessages.length : 0;

          await saveContact(contactsDb, {
            ...contact,
            lastMessage: latestMsg.text,
            lastMessageTime: latestMsg.ts,
            updatedAt: latestMsg.ts,
            unreadCount: newUnreadCount 
          });

          setTimeout(() => {
            window.dispatchEvent(new Event('onContactsUpdated'));
            console.log("⚡ [Sync] UI триггер отправлен");
          }, 300);
        }
      } catch (dbError) {
        console.error(`❌ Ошибка чтения истории ${contact.nickname}:`, dbError);
      } finally {
        resolve();
      }
    };

    const onUpdate = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finalizeSync, 300); 
    };
    
    chatDb.events.on('update', onUpdate);
    idleTimer = setTimeout(finalizeSync, 500);
  });
}

/**
 * Пакетная проверка истории для всех контактов. 
 * Безопасна для Safari (выполняется последовательно).
 */
export async function syncTopContactsHistory(contactsDb: any, limit = 10) {
  console.log(`🔄 [Холодный старт] Проверка пропущенных сообщений для ТОП-${limit} активных чатов...`);
  try {
    const allContacts = await getAllContacts(contactsDb); // Уже отсортированы и отфильтрованы
    
    // Берем только первые N контактов
    const topContacts = allContacts.slice(0, limit);
    
    // 🚨 ТАБУ НА Promise.all ДЛЯ СИНХРОНИЗАЦИИ БД В SAFARI!
    // Открываем базы чатов строго один за другим, чтобы не вешать поток IndexedDB
    for (const contact of topContacts) {
      await syncContactHistory(contact, contactsDb);
    }
    
    console.log(`✅ [Холодный старт] Синхронизация первых ${topContacts.length} контактов завершена.`);
  } catch (error) {
    console.error('❌ [Контакты] Ошибка при пакетной проверке истории:', error);
  }
}