import { CONFIG } from '../config.ts';
import { getOrOpenDb } from './authService.ts'; 
import { updateLastMessage, getAllContacts, saveContact, isPeerBlocked, type ContactItem  } from './contactsService.ts';
import { forceSyncContactProfile, type SyncResult } from './profileService.ts';

const openingDbsLock = new Set<string>();
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

export const startBackgroundProfileWatcher = async (contactsDb: any) => {
  if (!contactsDb) return;
  try {
    const rawContacts = await getAllContacts(contactsDb);
    const validContacts = rawContacts.filter(c => c && c.profileDbAddress && !c.isBlocked);

    // 1. Постоянный live-слушатель изменений (для последующих обновлений в реальном времени)
    const setupLiveListener = async (contact: ContactItem) => {
      if (openingDbsLock.has(contact.profileDbAddress)) return;
      openingDbsLock.add(contact.profileDbAddress);

      try {
        const remoteDb = await getOrOpenDb(contact.profileDbAddress);
        if (!remoteDb) return;

        remoteDb.events.on('update', async () => {
          const freshName = await remoteDb.get(CONFIG.PROFILE.KEY_NICKNAME);
          const freshAvatar = await remoteDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);
          const freshBio = await remoteDb.get(CONFIG.PROFILE.KEY_BIO);
          
          await saveContact(contactsDb, { 
            ...contact, nickname: freshName, avatarCid: freshAvatar, bio: freshBio, updatedAt: Date.now()
          });
          
          window.dispatchEvent(new Event('onContactsUpdated'));
          console.log(`♻️ [Background] Профиль ${freshName || contact.id} обновлен в фоне по событию update!`);
        });
      } catch (e) {
        console.error(`❌ Не удалось настроить живое отслеживание профиля ${contact.id}`);
      } finally {
        openingDbsLock.delete(contact.profileDbAddress);
      }
    };

    // 2. Функция синка одного контакта с поддержкой ограниченных ретраев
    const syncWithRetry = async (contact: ContactItem, attempt = 1) => {
      const result: SyncResult = await forceSyncContactProfile(contactsDb, contact);
      
      if (result.success) {
        if (result.status === 'SUCCESS') {
          window.dispatchEvent(new Event('onContactsUpdated'));
        }
        // Синк прошел успешно (или данные актуальны) -> вешаем постоянный листенер
        await setupLiveListener(contact);
        return;
      }

      // Если упали по причине transient (сеть еще не соединила узлы) и лимит попыток не исчерпан
      if (result.status === 'TRANSIENT_FAILURE' && attempt < MAX_RETRIES) {
        console.log(`⏳ [Retry Queue] Контакт ${contact.nickname || contact.id} не синхронизирован (Transient). Попытка ${attempt}/${MAX_RETRIES}. Повтор через ${RETRY_DELAY_MS / 1000} сек...`);
        
        setTimeout(() => {
          syncWithRetry(contact, attempt + 1);
        }, RETRY_DELAY_MS);
      } else {
        // Если лимит исчерпан или ошибка критическая (например, битый адрес БД)
        console.warn(`🛑 [Background] Синхронизация для ${contact.nickname || contact.id} завершена с фолбэком на локальный кэш. Статус: ${result.status}`);
        // Всё равно вешаем листенер, на случай если пир появится в сети позже сам
        await setupLiveListener(contact);
      }
    };

    // 3. 🔥 ПОСЛЕДОВАТЕЛЬНЫЙ СТАРТ (Запускается сразу, без слепых таймаутов)
    console.log(`🚀 [Cold Start] Запуск последовательного синка профилей. Контактов на проверку: ${validContacts.length}`);
    
    const runSequentialSync = async () => {
      for (const contact of validContacts) {
        await syncWithRetry(contact);
        // Небольшая пауза между стартами синка разных контактов, чтобы разгрузить CPU/IndexedDB
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    };

    runSequentialSync();

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
          
          if (await isPeerBlocked(globalContactsDb, payload.from)) {
              console.log(`🚫 [Фаервол] Проигнорирован пуш сообщения от заблокированного: ${payload.from}`);
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
    console.log(`🔔 [Background] Успешно подписались на системный топик пушей: ${myNotificationTopic}`);
  } catch (pubSubErr) {
    console.error('❌ Ошибка запуска фоновых уведомлений', pubSubErr);
  }
};