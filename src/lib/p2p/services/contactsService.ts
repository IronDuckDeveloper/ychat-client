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
  timestamp: number
) => {
  if (!db) {
    console.warn('⚠️ [ContactsService] База контактов не передана!');
    return;
  }
  
  try {
    // 1. Достаем ВСЕ контакты, чтобы обойти проблему несовпадения ключей OrbitDB
    const allContacts = await getAllContacts(db);
    
    // 2. Ищем нужный пир вручную
    const contact = allContacts.find((c: any) => c.id === peerId);
    
    if (!contact) {
      console.warn(`⚠️ [ContactsService] Контакт ${peerId} не найден среди ${allContacts.length} записей!`);
      // Выведем список id, которые реально лежат в базе, чтобы понять, в чем разница
      console.log('Доступные ID в базе:', allContacts.map((c: any) => c.id));
      return; 
    }

    // 3. Добавляем новые поля
    const updatedContact = {
      ...contact,
      lastMessage: text,
      lastMessageTime: timestamp
    };

    // 4. Сохраняем
    await saveContact(db, updatedContact);
    console.log(`✅ [ContactsService] Контакт ${contact.nickname || peerId} обновлен превью: "${text}"`);
    
    // Обязательно пинаем UI, чтобы список перерисовался!
    window.dispatchEvent(new Event('onContactsUpdated'));
    
  } catch (error) {
    console.error(`❌ [ContactsService] Ошибка записи превью:`, error);
  }
};