import { CONFIG, type ContactItem } from '../config.ts';
import { getOrOpenDb } from './authService.ts'; 
import { updateLastMessage, getAllContacts, saveContact, isPeerBlocked  } from './contactsService.ts';


const openingDbsLock = new Set<string>();

// Фоновый мониторинг изменений профилей друзей
export const startBackgroundProfileWatcher = async (contactsDb: any) => {
  if (!contactsDb) return;
  try {
    const rawContacts = await getAllContacts(contactsDb);

    const updateContactWithRetry = async (contact: ContactItem) => {
      if (!contact || !contact.profileDbAddress) return;

      // Не открываем базу профиля заблокированного юзера
      if (contact.isBlocked) return;

      if (openingDbsLock.has(contact.profileDbAddress)) return;
      openingDbsLock.add(contact.profileDbAddress);

      try {
        const remoteDb = await getOrOpenDb(contact.profileDbAddress);
        if (!remoteDb) return;

        remoteDb.events.on('update', async () => {
          const freshName = await remoteDb.get(CONFIG.PROFILE.KEY_NICKNAME);
          const freshAvatar = await remoteDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);
          
          await saveContact(contactsDb, { 
            ...contact, nickname: freshName, avatarCid: freshAvatar, updatedAt: Date.now() 
          });
        });
      } catch (e) {
        console.error(`❌ Не удалось настроить отслеживание профиля ${contact.id}`);
      } finally {
        openingDbsLock.delete(contact.profileDbAddress);
      }
    };

    rawContacts.forEach(contact => {
      if (contact && contact.profileDbAddress) {
        updateContactWithRetry(contact);
      }
    });
  } catch (err) {
    console.error('❌ Ошибка запуска фонового слежения за профилями:', err);
  }
};

// Глобальный фоновый слушатель сетевых PubSub уведомлений о новых сообщениях
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
          
          // Блокируем пуш от заблокированного
          if (await isPeerBlocked(globalContactsDb, payload.from)) {
              console.log(`🚫 [Фаервол] Проигнорирован пуш сообщения от заблокированного: ${payload.from}`);
              return;
          }
          // Проверяем где сейчас пользователь через глобальный window.location
          const isCurrentlyInThisChat = window.location.pathname.includes(payload.from);
          
          // Пишем данные напрямую в БД контактов
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
    console.log(`🔔 [Background] Успешно подписались на системный топик пушей: ${myNotificationTopic}`);
  } catch (pubSubErr) {
    console.error('❌ Ошибка запуска фоновых уведомлений', pubSubErr);
  }
};