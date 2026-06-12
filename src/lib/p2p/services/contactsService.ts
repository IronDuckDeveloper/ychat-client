import { IPFSAccessController } from '@orbitdb/core';
import { CONFIG, type ContactItem } from '../config.ts';

export async function initContactsDB(orbitdb: any) {
  console.log(`📇 [ContactsDB] Открываем базу контактов...`);

  // Используем keyvalue, чтобы код работы с базой был таким же, как в профиле
  const contactsDb = await orbitdb.open(CONFIG.PROFILE.DB_CONTACTS || 'my-contacts', {
    type: 'keyvalue',
    // Защита: только твой узел может вносить изменения в твою записную книжку
    AccessController: IPFSAccessController({ write: [orbitdb.identity.id] })
  });

  console.log(`✅ [ContactsDB] База контактов готова! Адрес: ${contactsDb.address.toString()}`);
  return contactsDb;
}

// ==========================================
// 3. ХЕЛПЕРЫ ДЛЯ РАБОТЫ С БАЗОЙ
// ==========================================

/**
 * Получить контакт по ID
 */
export const getContactById = async (contactsDb: any, id: string) => {
  // Допустим, твоя база контактов называется contactsDb
  // Тебе нужно найти запись по ключу или отфильтровать
  const allContacts = await contactsDb.all(); 
  return allContacts.find((c: any) => c.id === id);
};

/**
 * Сохранить или обновить контакт в базе
 */
export const saveContact = async (contactsDb: any, contact: ContactItem) => {
  if (!contactsDb) throw new Error("База контактов не инициализирована");
  await contactsDb.put(contact.id, contact); 
  console.log(`💾 [ContactsDB] Контакт ${contact.nickname || contact.id} сохранен.`);
};

/**
 * Получить один контакт по PeerID
 */
export const getContact = async (contactsDb: any, peerId: string): Promise<ContactItem | null> => {
  if (!contactsDb) return null;
  return await contactsDb.get(peerId) || null;
};

/**
 * Получить абсолютно все контакты (отсортированные по времени)
 */
export const getAllContacts = async (contactsDb: any): Promise<ContactItem[]> => {
  if (!contactsDb) return [];
  
  // В новых версиях OrbitDB all() возвращает массив объектов { key, value, hash }
  const allRecords = await contactsDb.all();
  
  return allRecords
    .map((record: any) => record.value as ContactItem)
    .sort((a: ContactItem, b: ContactItem) => b.updatedAt - a.updatedAt);
};

/**
 * Удалить контакт
 */
export const deleteContact = async (contactsDb: any, contactId: string) => {
  if (!contactsDb) return false;
  try {
    // OrbitDB KeyValue store использует метод del(key)
    await contactsDb.del(contactId);
    return true;
  } catch (error) {
    console.error(`Ошибка при удалении контакта ${contactId}:`, error);
    return false;
  }
};

/**
 * Обновить последнее сообщение
 */
export const updateLastMessage = async (
  db: any, 
  peerId: string, 
  text: string, 
  timestamp: number,
  incrementUnread: boolean = false
) => {
  if (!db) {
    console.warn('⚠️ [ContactsService] База контактов не передана!');
    return;
  }
  
  try {
    // 1. Достаем ВСЕ контакты
    const allContacts = await getAllContacts(db);
    
    // 2. Ищем нужный пир вручную
    let contact = allContacts.find((c: any) => c.id === peerId);
    
    if (!contact) {
      contact = {
        id: peerId,
        profileDbAddress: '', // Подтянется позже, когда нода ответит на MSG_PROFILE_REQUEST
        chatDbAddress: '',    // Сгенерируется при открытии чата
        nickname: `${peerId.substring(0, 6)}...`, // Временное имя
        avatarCid: '',
        updatedAt: timestamp,
      };
      
      // Лог оставляем, чтобы видеть историю, но убираем return!
      console.log('✨ [ContactsService] Автодобавление нового пира. Доступные до этого ID в базе:', allContacts.map((c: any) => c.id));
    }

    // Высчитываем новый счетчик (для нового контакта тут будет 0)
    const currentCount = contact.unreadCount || 0;
    const newCount = incrementUnread ? currentCount + 1 : currentCount;

    // 3. Собираем обновленный объект
    const updatedContact = {
      ...contact,
      lastMessage: text,
      lastMessageTime: timestamp,
      unreadCount: newCount,
      updatedAt: timestamp // Поднимаем контакт наверх списка при новом сообщении
    };

    // 4. Вот теперь сохранение железно сработает и для старых, и для новых контактов!
    await saveContact(db, updatedContact);
    console.log(`✅ [ContactsService] Контакт ${updatedContact.nickname || peerId} успешно сохранен/обновлен. Превью: "${text}"`);
    
    // Пинаем UI для перерисовки списка
    window.dispatchEvent(new Event('onContactsUpdated'));
    
  } catch (error) {
    console.error(`❌ [ContactsService] Ошибка записи превью:`, error);
  }
};

// ФУНКЦИЯ ДЛЯ СБРОСА СЧЕТЧИКА
export const clearUnread = async (db: any, peerId: string) => {
  if (!db) return;
  try {
    const allContacts = await getAllContacts(db);
    const contact = allContacts.find((c: any) => c.id === peerId);
    
    // Сбрасываем только если счетчик реально больше нуля
    if (contact && contact.unreadCount && contact.unreadCount > 0) {
      const updatedContact = { ...contact, unreadCount: 0 };
      await saveContact(db, updatedContact);
      window.dispatchEvent(new Event('onContactsUpdated'));
    }
  } catch (error) {
    console.error(`❌ [ContactsService] Ошибка сброса счетчика:`, error);
  }
};
/**
 * Проверяет, есть ли пир в базе, и если нет — создает его
 */
import { requestPeerProfile } from './profileService'; 

export const addContactIfMissing = async (db: any, helia: any, peerId: string) => {
  if (!db || !peerId) return;
  
  try {
    const allContacts = await getAllContacts(db);
    const exists = allContacts.some((c: any) => c.id === peerId);

    if (!exists) {
      const newContact = {
        id: peerId,
        profileDbAddress: '',
        chatDbAddress: '',
        nickname: `${peerId.substring(0, 6)}...`,
        avatarCid: '',
        updatedAt: Date.now(),
        unreadCount: 0
      };
      
      await saveContact(db, newContact);
      console.log(`✨ [ContactsService] Автодобавление пира: ${peerId}`);
      window.dispatchEvent(new Event('onContactsUpdated'));

      // 🔥 КРИТИЧЕСКИ ВАЖНО: Сразу просим сеть отдать нам профиль этого человека!
      if (helia) {
        await requestPeerProfile(helia, peerId);
      }
    }
  } catch (err) {
    console.error(`❌ [ContactsService] Ошибка автодобавления:`, err);
  }
};