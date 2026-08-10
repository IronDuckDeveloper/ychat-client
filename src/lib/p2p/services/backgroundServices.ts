import { CONFIG } from '../config.ts';
import { getOrOpenDb } from './authService.ts'; 
import { updateLastMessage, getAllContacts, saveContact, type ContactItem, getContactById, isPeerIgnored } from './contactsService.ts';
import { forceSyncContactProfile, type SyncResult } from './profileService.ts';

const openingDbsLock = new Set<string>();
const activeListeners = new Set<string>();

export const startBackgroundProfileWatcher = async (contactsDb: any) => {
  if (!contactsDb) return;
  try {
    const rawContacts = await getAllContacts(contactsDb);

    // 🧹 Фильтруем контакты через единую систему фаервола
    const validContacts = [];
    for (const c of rawContacts) {
      if (c && !(await isPeerIgnored(contactsDb, c.id))) {
        validContacts.push(c);
      }
    }

    // 1. Постоянный live-слушатель изменений базы профиля
    const setupLiveListener = async (contact: ContactItem) => {
      // console.log(`♻️♻️ ♻️ [BackgroundWatcher] Проверка адреса DB для ${contact.nickname || contact.id}: ${contact.profileDbAddress}`);

      // Если адреса базы нет — мы физически не можем открыть OrbitDB
      if (!contact.profileDbAddress) {
        console.warn(`⚠️ [BackgroundWatcher] У контакта ${contact.nickname || contact.id} отсутствует profileDbAddress! Live-слушатель не запущен.`);
        return;
      }

      if (activeListeners.has(contact.profileDbAddress)) return;
      if (openingDbsLock.has(contact.profileDbAddress)) return;
      
      openingDbsLock.add(contact.profileDbAddress);

      try {
        const remoteDb = await getOrOpenDb(contact.profileDbAddress);
        if (!remoteDb) return;

        activeListeners.add(contact.profileDbAddress);

        remoteDb.events.on('update', async () => {
          const freshName = await remoteDb.get(CONFIG.PROFILE.KEY_NICKNAME);
          const freshAvatar = await remoteDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);
          const freshBio = await remoteDb.get(CONFIG.PROFILE.KEY_BIO);
          
          const latestContact = await getContactById(contactsDb, contact.id); 
          if (!latestContact) return;

          await saveContact(contactsDb, { 
            ...latestContact,
            nickname: freshName || latestContact.nickname, 
            avatarCid: freshAvatar || latestContact.avatarCid, 
            bio: freshBio || latestContact.bio, 
            updatedAt: Date.now()
          });
          
          window.dispatchEvent(new Event('onContactsUpdated'));
          console.log(`♻️ [Background] Профиль ${freshName || contact.id} обновлен по событию update!`);
        });
      } catch (e) {
        console.warn(`⏳ [Background] Не удалось открыть базу ${contact.profileDbAddress} (пир оффлайн?).`);
      } finally {
        openingDbsLock.delete(contact.profileDbAddress);
      }
    };

    // 2. Функция попытки синка и получения адреса базы
    const syncWithRetry = async (contact: ContactItem, attempt = 1) => {
      // forceSyncContactProfile должна найти/получить profileDbAddress и сохранить его в contactsDb
      const result: SyncResult = await forceSyncContactProfile(contactsDb, contact);
      
      // Достаем обновленный контакт из базы (у него уже должен появиться profileDbAddress)
      const freshContact = (await getContactById(contactsDb, contact.id)) || contact;

      if (result.success || freshContact.profileDbAddress) {
        if (result.status === CONFIG.MSG.SUCCESS) {
          window.dispatchEvent(new Event('onContactsUpdated'));
        }
        // Запускаем live-слушатель уже с полученным profileDbAddress
        await setupLiveListener(freshContact);
        return;
      }

      if (attempt < 3) {
        console.log(`⏳ [Retry Queue] Попытка ${attempt}/3 получить профиль/адрес для ${contact.id}...`);
        setTimeout(() => {
          syncWithRetry(contact, attempt + 1);
        }, 3000);
      } else {
        console.warn(`🛑 [Background] Не удалось получить profileDbAddress для ${contact.id} после ${attempt} попыток.`);
      }
    };

    // 3. Запуск последовательного синка
    console.log(`🚀 [Cold Start] Запуск фонового синка. Контактов: ${validContacts.length}`);
    for (const contact of validContacts) {
      await syncWithRetry(contact);
    }

  } catch (err) {
    console.error('❌ Ошибка запуска фонового слежения за профилями:', err);
  }
};

export const startGlobalNotificationListener = async (globalHelia: any, globalContactsDb: any) => {
  if (!globalHelia || !globalContactsDb) return;
  
  const myPeerId = globalHelia.libp2p.peerId.toString();
  const myNotificationTopic = `${CONFIG.TOPICS.ANNOUNCE_NEW_MESSAGE}${myPeerId}`;

  try {
    await globalHelia.libp2p.services.pubsub.subscribe(myNotificationTopic);
    
    const handleIncomingNotification = async (evt: any) => {
      if (evt.detail.topic !== myNotificationTopic) return;
      try {
        const payload = JSON.parse(new TextDecoder().decode(evt.detail.data));
        if (payload.from && payload.text) {

        // 🛡️ Единый фаервол: проверяем блэклист, isBlocked и isDeleted
        if (await isPeerIgnored(globalContactsDb, payload.from)) {
          console.log(`🔇 [Push] Сообщение от ${payload.from.slice(0, 8)} проигнорировано (заблокирован/удален)`);
          return;
        }

          const isCurrentlyInThisChat = window.location.pathname.includes(payload.from);
          
          await updateLastMessage(
            globalContactsDb, 
            payload.from, 
            payload.text, 
            payload.ts || Date.now(), 
            !isCurrentlyInThisChat
          );
        }
      } catch (err) {
        console.error('Ошибка обработки входящего пуша сообщений:', err);
      }
    };

    globalHelia.libp2p.services.pubsub.addEventListener('message', handleIncomingNotification);
  } catch (pubSubErr) {
    console.error('❌ Ошибка запуска фоновых уведомлений', pubSubErr);
  }
};