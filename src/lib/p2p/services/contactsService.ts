import { IPFSAccessController } from '@orbitdb/core';
import { CONFIG } from '../config.ts';
import { requestPeerProfile } from './profileService.ts'; 
import { getOrOpenDb, globalHelia } from './authService.ts';
import { getDeterministicRoomName } from './roomService.ts';
import { notifyArchivist } from '../networking/connectionManager.ts';

export interface ContactItem {
  id: string;               // PeerID контакта
  profileDbAddress: string; // Адрес его OrbitDB с профилем
  chatDbAddress: string;    // Адрес вашей общей базы сообщений (eventlog)
  nickname: string;         // Кэш никнейма для моментального UI
  avatarCid: string;        // Кэш аватара для моментального UI
  bio?: string;             // Кэш био для моментального UI
  updatedAt: number;        // Таймстемп (для сортировки списка чатов)
  lastMessage?: string; // Текст последнего сообщения
  lastMessageTime?: number; // Таймстемп последнего сообщения
  unreadCount?: number; // Количество непрочитанных сообщений
  isBlocked?: boolean; // Флаг блокировки
  isDeleted?: boolean; // Флаг удаления
}

export type PrivacyType = 'public' | 'contacts_only' | 'private';

// Глобальный кэш для защиты от двойной синхронизации 
const syncCooldowns = new Map<string, number>();

// 🧠 Локальный кэш контактов для мгновенного UI и дедупликатор запросов
let cachedContacts: ContactItem[] = [];
let getAllContactsPromise: Promise<ContactItem[]> | null = null;
let isSubscribedToUpdates = false;

function updateLocalCache(allRecords: any[]) {
  if (!Array.isArray(allRecords)) {
    console.warn('⚠️ [ContactsDB] OrbitDB вернул не массив записей:', allRecords);
    return;
  }

  cachedContacts = allRecords
    .map((record: any) => record.value as ContactItem)
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
  
  // 🧹 Санитизация объекта
  const sanitizedContact = { ...contact };
  Object.keys(sanitizedContact).forEach(key => {
    if ((sanitizedContact as any)[key] === undefined) {
      delete (sanitizedContact as any)[key];
    }
  });

  // 🛡️ ЗАЩИТА ОТ БЕСКОНЕЧНОГО ЦИКЛА: Проверяем ВСЕ ключевые поля
  const existingContact = cachedContacts.find(c => c.id === sanitizedContact.id);
  if (existingContact) {
    const isIdentical = 
      existingContact.nickname === sanitizedContact.nickname &&
      existingContact.avatarCid === sanitizedContact.avatarCid &&
      existingContact.profileDbAddress === sanitizedContact.profileDbAddress &&
      existingContact.chatDbAddress === sanitizedContact.chatDbAddress &&
      existingContact.lastMessage === sanitizedContact.lastMessage &&
      existingContact.lastMessageTime === sanitizedContact.lastMessageTime &&
      existingContact.unreadCount === sanitizedContact.unreadCount &&
      existingContact.isBlocked === sanitizedContact.isBlocked &&
      existingContact.isDeleted === sanitizedContact.isDeleted;

    if (isIdentical) {
      return; 
    }
  }

  // 1. 🔥 ОПЕРЕЖАЮЩЕЕ ОБНОВЛЕНИЕ: Мгновенно обновляем кэш ДО записи в базу.
  let newCache = [...cachedContacts];
  const idx = newCache.findIndex(c => c.id === sanitizedContact.id);
  if (sanitizedContact.isDeleted) {
    if (idx !== -1) newCache.splice(idx, 1);
  } else {
    if (idx !== -1) newCache[idx] = sanitizedContact;
    else newCache.push(sanitizedContact);
    newCache.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  cachedContacts = newCache; 

  // 2. Асинхронно сохраняем на диск (React не будет ждать эту операцию)
  await contactsDb.put(sanitizedContact.id, sanitizedContact); 
  console.log(`💾 [ContactsDB] Контакт ${sanitizedContact.nickname || sanitizedContact.id.slice(-6)} сохранен.`);
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
  
  if (cachedContacts.length > 0) {
    return [...cachedContacts]; 
  }

  if (getAllContactsPromise) {
    return getAllContactsPromise;
  }

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
      const updatedContact: ContactItem = {
        ...contact,
        isDeleted: true,
        updatedAt: Date.now()
      };
      await saveContact(contactsDb, updatedContact);
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

    // ✅ Иммутабельное создание объекта
    const updatedContact: ContactItem = {
      ...contact,
      lastMessage: text || '',
      lastMessageTime: timestamp,
      updatedAt: Math.max(contact.updatedAt || 0, timestamp),
      unreadCount: incrementUnread ? (contact.unreadCount || 0) + 1 : contact.unreadCount
    };

    await saveContact(db, updatedContact);
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
      const updatedContact: ContactItem = {
        ...contact,
        unreadCount: 0
      };
      await saveContact(db, updatedContact);
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
      
      const updatedContact: ContactItem = {
        ...contact,
        chatDbAddress: address
      };
      
      await saveContact(db, updatedContact); 
      console.log(`🎯 [ContactsDB] Сохранен адрес базы чата: ${address}`);

      setTimeout(async () => {
        await syncContactHistory(updatedContact, db);
      }, 200);
    }
  } catch (error) {
    console.error(`❌ [ContactsDB] Ошибка при сохранении адреса:`, error);
  }
}

export async function syncContactHistory(contact: any, contactsDb: any) {
  if (contact.isBlocked) return;

  const now = Date.now();
  const lastSynced = syncCooldowns.get(contact.id) || 0;

  if (now - lastSynced < CONFIG.COOLDOWN_TIME) {
    return;
  }

  // 1. Берем готовое имя комнаты, которое использует UI (например, room_c86de...)
  let roomName = contact.room;

  // Если вдруг его нет, вычисляем через правильный PeerId, а не OrbitDB Identity
  if (!roomName) {
    if (globalHelia) {
      const myPeerId = (globalHelia as any).libp2p.peerId.toString();
      roomName = await getDeterministicRoomName(myPeerId, contact.id);
    } else {
      console.warn(`[Sync] Нет globalHelia, не можем вычислить комнату для ${contact.nickname}`);
      return;
    }
  }

  if (!roomName) return;
  syncCooldowns.set(contact.id, now);

  // 2. Открываем базу именно по имени room_...
  const chatDb = await getOrOpenDb(roomName);
  if (!chatDb) return;

  const actualAddress = chatDb.address.toString();

  // Обновляем адрес БД в контакте
  if (contact.chatDbAddress !== actualAddress) {
    console.log(`🔄 [Sync] Обновляем адрес БД для ${contact.nickname}: ${actualAddress}`);
    updateChatDbAddress(contactsDb, contact.id, actualAddress);
  }

  // Пингуем архиватор
  try {
    if (globalHelia) {
      const libp2p = (globalHelia as any).libp2p;
      libp2p.getPeers().forEach((peerId: any) => {
        notifyArchivist(libp2p, peerId, actualAddress);
      });
    }
  } catch (e) {
    console.warn("❌ [Sync] Ошибка уведомления архиватора:", e);
  }

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
        for await (const record of chatDb.iterator({ limit: 20, reverse: true })) {
          records.push(record);
        }
        
        console.log(`[Sync Debug] В локальной базе ${contact.nickname} (${actualAddress.slice(-8)}) найдено записей: ${records.length}`);
        
        if (records.length > 0) {
          const messages = records.map((r: any) => r.payload?.value || r.value || r);
          messages.sort((a: any, b: any) => a.ts - b.ts);
          
          const latestMsg = messages[messages.length - 1];
          const contactLastTime = contact.lastMessageTime || 0;

          const newMessages = messages.filter((msg: any) => msg.ts > contactLastTime);

          if (latestMsg && latestMsg.ts > contactLastTime) {
            console.log(`📥 [Холодный старт] Нашли новые сообщения от ${contact.nickname}`);
            
            const currentUrl = typeof window !== 'undefined' ? decodeURIComponent(window.location.href) : '';
            const isCurrentlyInThisChat = currentUrl.includes(contact.id) || (contact.room && currentUrl.includes(contact.room));
            
            const freshContact = await getContact(contactsDb, contact.id) || contact;
            const newUnreadCount = !isCurrentlyInThisChat ? (freshContact.unreadCount || 0) + newMessages.length : 0;
            const textPreview = latestMsg.text ? latestMsg.text : (latestMsg.attachment ? '📎 Вложение' : '');

            await saveContact(contactsDb, {
              ...freshContact,
              chatDbAddress: actualAddress,
              lastMessage: textPreview,
              lastMessageTime: latestMsg.ts,
              updatedAt: Math.max(freshContact.updatedAt || 0, latestMsg.ts),
              unreadCount: newUnreadCount 
            });

            setTimeout(() => {
              window.dispatchEvent(new Event('onContactsUpdated'));
              console.log("⚡ [Sync] UI триггер отправлен");
            }, 150);
          }
        }
      } catch (dbError) {
        console.error(`❌ Ошибка чтения истории ${contact.nickname}:`, dbError);
      } finally {
        try {
          const currentUrl = typeof window !== 'undefined' ? decodeURIComponent(window.location.href) : '';
          const isCurrentlyInThisChat = currentUrl.includes(contact.id) || 
            (contact.room && currentUrl.includes(contact.room));

          if (isCurrentlyInThisChat) {
            console.log(`👀 [Sync] Чат ${contact.nickname} сейчас открыт на экране. Оставляем БД открытой.`);
          } else {
            await chatDb.close();
            console.log(`🧹 [Sync] База ${contact.nickname} закрыта, ресурсы освобождены.`);
          }
        } catch (closeErr) {
          console.error(`❌ Ошибка при закрытии БД ${contact.nickname}:`, closeErr);
        }
        
        resolve();
      }
    };

    const onUpdate = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finalizeSync, 300); 
    };
    
    chatDb.events.on('update', onUpdate);
    // Даем релею 3 секунды, чтобы он успел выгрузить блоки
    idleTimer = setTimeout(finalizeSync, 3000); 
  });
}

export async function syncTopContactsHistory(contactsDb: any, limit = 10) {
  console.log(`🔄 [Холодный старт] Проверка пропущенных сообщений для ТОП-${limit} активных чатов...`);
  try {
    const allContacts = await getAllContacts(contactsDb); 
    const topContacts = allContacts.slice(0, limit);
    
    for (const contact of topContacts) {
      await syncContactHistory(contact, contactsDb);
    }
    
    console.log(`✅ [Холодный старт] Синхронизация первых ${topContacts.length} контактов завершена.`);
  } catch (error) {
    console.error('❌ [Контакты] Ошибка при пакетной проверке истории:', error);
  }
}