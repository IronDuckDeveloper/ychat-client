import { IPFSAccessController } from '@orbitdb/core';
import { CONFIG } from '../config';

export async function initContactsDB(orbitdb: any) {
  console.log(`📇 [ContactsDB] Открываем базу контактов...`);

  const contactsDb = await orbitdb.open(CONFIG.PROFILE.DB_CONTACTS, {
    type: 'documents',
    indexBy: 'peerId', // Это будет уникальным ключом (ID документа) для каждого контакта
    // Защита: только твой публичный ключ может менять твою записную книжку
    AccessController: IPFSAccessController({ write: [orbitdb.identity.id] })
  });

  console.log(`✅ [ContactsDB] База контактов готова!`);
  return contactsDb;
}