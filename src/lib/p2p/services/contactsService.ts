import { IPFSAccessController } from '@orbitdb/core';
import { CONFIG, type ContactItem } from '../config.ts';
import { requestPeerProfile } from './profileService'; 
import { getOrOpenDb } from './authService.ts';

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
  // 1. ГЛАВНАЯ ЗАЩИТА: Сначала проверяем вечный бан в памяти браузера (даже если контакт удален)
  const localBlacklistStr = localStorage.getItem(CONFIG.PROFILE.BLACKLIST_KEY);
  if (localBlacklistStr) {
    try {
      const localBlacklist: string[] = JSON.parse(localBlacklistStr);
      if (localBlacklist.includes(peerId)) {
        return true; // Заблокирован железобетонно
      }
    } catch (e) {
      console.error('Ошибка парсинга блэклиста:', e);
    }
  }

  // 2. ВТОРИЧНАЯ ЗАЩИТА: Проверяем базу контактов (на случай рассинхрона)
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

  return false; // Чист, пропускаем
};

export const saveContact = async (contactsDb: any, contact: ContactItem) => {
  if (!contactsDb) throw new Error("База контактов не инициализирована");
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

export const getAllContacts = async (contactsDb: any): Promise<ContactItem[]> => {
  if (!contactsDb) return [];
  
  const allRecords = await contactsDb.all();
  return allRecords
    .map((record: any) => record.value as ContactItem)
    // 👇 Фильтруем: отдаем в UI только тех, кто реально существует и НЕ удален
    .filter((c: ContactItem) => !!c && !c.isDeleted)
    .sort((a: ContactItem, b: ContactItem) => (b.updatedAt || 0) - (a.updatedAt || 0));
};

export const deleteContact = async (contactsDb: any, contactId: string): Promise<boolean> => {
  if (!contactsDb) return false;
  try {
    // 👇 МЯГКОЕ УДАЛЕНИЕ: Вместо физического contactsDb.del() ставим флаг
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

/**
 * Универсальное и безопасное обновление превью последнего сообщения
 */
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

    // Железная защита от перезаписи свежих данных старыми из истории
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
    
    // Оповещаем интерфейс React о необходимости перерисовать список
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

    // Автодобавляем только если контакта вообще нет в базе.
    // Если он есть, но isDeleted === true, мы его НЕ воскрешаем автоматически при получении сообщения 
    // (ведь юзер сам его удалил). Он воскреснет только через handleAdd.
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
      await db.put(peerId, contact);
      console.log(`🎯 [ContactsDB] Сохранен адрес базы чата: ${address}`);

      // 👇 КОНТАКТ ПОЛУЧИЛ АДРЕС БД! СРАЗУ КАЧАЕМ ИСТОРИЮ!
      setTimeout(async () => {
        await syncContactHistory(contact, db);
      }, 200);
    }
  } catch (error) {
    console.error(`❌ [ContactsDB] Ошибка при сохранении адреса:`, error);
  }
}

export async function syncContactHistory(contact: any, contactsDb: any) {
  // Игнорируем заблокированных при холодном старте
  if (contact.isBlocked) return;

  if (!contact.chatDbAddress) return;

  const chatDb = await getOrOpenDb(contact.chatDbAddress);

  if (!chatDb) return;

  await new Promise<void>((resolve) => {
    let idleTimer: NodeJS.Timeout;
    let isFinished = false;

    // Функция завершения: чистит за собой и запускает твой оригинальный код
    const finalizeSync = async () => {
      if (isFinished) return;
      isFinished = true;

      clearTimeout(idleTimer);
      chatDb.events.off('update', onUpdate); // Снимаем слушатель, чтобы не копить память

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

          await contactsDb.put(contact.id, {
            ...contact,
            lastMessage: latestMsg.text,
            lastMessageTime: latestMsg.ts,
            updatedAt: latestMsg.ts,
            unreadCount: newUnreadCount 
          });

          window.dispatchEvent(new Event('onContactsUpdated'));
        }
      } catch (dbError) {
        console.error(`❌ Ошибка чтения истории ${contact.nickname}:`, dbError);
      } finally {
        resolve();
      }
    };

    // 🔥 СЛУШАТЕЛЬ: Релей прислал блок -> сбрасываем таймер и ждем еще 300мс
    const onUpdate = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finalizeSync, 300); 
    };
    
    chatDb.events.on('update', onUpdate);

    // 🚀 СТАРТОВЫЙ ПИНОК: Если за 400мс сеть вообще ничего не прислала,
    // значит, новых данных у релея нет. Читаем локальный кэш и выходим.
    idleTimer = setTimeout(finalizeSync, 500);
  });
}

/**
 * Пакетная проверка истории для всех контактов. 
 * Идеально для вызова один раз при запуске приложения.
 */
export async function syncAllContactsHistory(contactsDb: any) {
  console.log('🔄 [Контакты] Запуск проверки пропущенных сообщений...');
  try {
    const contacts = await getAllContacts(contactsDb); // getAllContacts уже вернет только не удаленные
    await Promise.all(contacts.map(c => syncContactHistory(c, contactsDb)));
    console.log('✅ [Контакты] Проверка истории завершена.');
  } catch (error) {
    console.error('❌ [Контакты] Ошибка при пакетной проверке истории:', error);
  }
}