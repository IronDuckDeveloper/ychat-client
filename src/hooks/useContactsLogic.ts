import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CID } from 'multiformats/cid';

import { globalProfileDb, globalContactsDb, globalOrbitDB, onDbReady, globalHelia, getOrOpenDb, broadcastMyProfile } from '../lib/p2p/services/authService.ts'; 
import { getAllContacts, saveContact, deleteContact, updateLastMessage } from '../lib/p2p/services/contactsService.ts';
import { isAuthenticated } from '../lib/p2p/crypto/crypto.ts';
import { CONFIG, type ContactItem } from '../lib/p2p/config.ts';
import { uploadAvatarToHelia, fetchAvatarFromHelia } from '../lib/p2p/services/avatarService';

export const useContactsLogic = () => {
  const navigate = useNavigate();
  
  // Стейты профиля
  const [myNickname, setMyNickname] = useState<string>('Загрузка...');
  const [myBio, setMyBio] = useState<string>(''); 
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  
  // Стейты приложения
  const [dbInstance, setDbInstance] = useState<any>(globalProfileDb);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  
  // Стейт списка контактов
  const [contacts, setContacts] = useState<ContactItem[]>([]);

  // Слушаем фоновые обновления профилей из PubSub
  useEffect(() => {
    const handleContactsUpdate = async () => {
      console.log('♻️ [UI] Получен сигнал на обновление списка контактов!');
      if (globalContactsDb) {
        const updatedList = await getAllContacts(globalContactsDb);
        setContacts(updatedList);
      }
    };

    window.addEventListener('onContactsUpdated', handleContactsUpdate);
    return () => window.removeEventListener('onContactsUpdated', handleContactsUpdate);
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const handlePopState = () => window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Загрузка профиля И КОНТАКТОВ из баз
  useEffect(() => {
    if (!isAuthenticated()) return;

    const loadData = async (profileDb: any) => {
      try {
        const name = await profileDb.get(CONFIG.PROFILE.KEY_NICKNAME);
        const bio = await profileDb.get(CONFIG.PROFILE.KEY_BIO);
        const avatarCID = await profileDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);
        
        setMyNickname(name || 'Аноним');
        setMyBio(bio || '');

        if (avatarCID && globalHelia) { 
          const url = await fetchAvatarFromHelia(globalHelia, avatarCID);
          setMyAvatarUrl(url);
        }

        if (globalContactsDb) {
          const list = await getAllContacts(globalContactsDb);
          setContacts(list);

          // СЛУШАЕМ ОБНОВЛЕНИЯ ПРОФИЛЕЙ
          const updateContactWithRetry = async (contact: ContactItem, _retries = 3) => {
            if (!contact) {
              console.warn("Попытка обновить пустой контакт, пропускаем.");
              return;
            }
            try {
              const remoteDb = await getOrOpenDb(contact.profileDbAddress);
              await remoteDb.load();
              if (!remoteDb) return;
              if (remoteDb.all().length === 0) {
                console.log(`⏳ База пира ${contact.id} еще синхронизируется...`);
                return; 
              }
              remoteDb.events.on('update', async (_address: any, _hash: string, entry: any) => {
                console.log('🔄 Прилетело обновление:', entry.payload.value);   
                const getSafe = async (db: any, key: string) => {
                  try {
                    return await db.get(key);
                  } catch (e) {
                    return null;
                  }
                };
                
                const freshName = await getSafe(remoteDb, CONFIG.PROFILE.KEY_NICKNAME);
                const freshAvatar = await getSafe(remoteDb, CONFIG.PROFILE.KEY_AVATAR_CID);
                
                await saveContact(globalContactsDb, { 
                  ...contact, 
                  nickname: freshName, 
                  avatarCid: freshAvatar,
                  updatedAt: Date.now() 
                });
                window.dispatchEvent(new Event('onContactsUpdated'));
              });

            } catch (e) {
              console.error(`❌ Не удалось обновить контакт ${contact.id}.`);
            }
          };

        // СЛУШАТЕЛЬ ФОНОВЫХ ПРЕВЬЮ КОНТАКТОВ (Последнее сообщение)
        if (globalHelia) {
          const myPeerId = globalHelia.libp2p.peerId.toString();
          const myNotificationTopic = `${CONFIG.TOPICS.ANNOUNCE_NEW_MESSAGE}${myPeerId}`;

          try {
            // Подписываемся ТОЛЬКО на свой личный топик уведомлений
            await globalHelia.libp2p.services.pubsub.subscribe(myNotificationTopic);
            
            const handleIncomingNotification = async (evt: any) => {
              if (evt.detail.topic !== myNotificationTopic) return;
              
              try {
                const payload = JSON.parse(new TextDecoder().decode(evt.detail.data));
                // Ожидаем структуру: { from: string, text: string, ts: number }
                if (payload.from && payload.text) {
                  console.log(`📡 [PubSub Пуш] Новое фоновое сообщение от ${payload.from}: "${payload.text}"`);
                  await updateLastMessage(globalContactsDb, payload.from, payload.text, payload.ts || Date.now());
                }
              } catch (err) {
                console.warn('❌ Ошибка парсинга фонового пуш-уведомления', err);
              }
            };

            globalHelia.libp2p.services.pubsub.addEventListener('message', handleIncomingNotification);
          } catch (pubSubErr) {
            console.error('❌ Не удалось запустить фоновые уведомления', pubSubErr);
          }
        }

          const validContacts = contacts.filter(c => c && c.profileDbAddress);
          validContacts.forEach(contact => updateContactWithRetry(contact));
        }
      } catch (error) {
        console.error('Ошибка при чтении данных:', error);
        setMyNickname('Ошибка');
      } finally {
        setIsLoading(false);
      }
    };

    if (globalProfileDb && globalContactsDb) {
      setDbInstance(globalProfileDb);
      loadData(globalProfileDb);
    } else {
      onDbReady(() => {
        setDbInstance(globalProfileDb);
        loadData(globalProfileDb);
      });
    }
  }, []);

  const handleRefreshContact = async (e: React.MouseEvent, targetPeerId: string) => {
    e.stopPropagation();
    if (!globalHelia) {
      console.error('Helia не инициализирована');
      return;
    }
    try {
      const message = { type: CONFIG.PROFILE.MSG_PROFILE_REQUEST, targetId: targetPeerId };
      const encodedMessage = new TextEncoder().encode(JSON.stringify(message));
      await globalHelia.libp2p.services.pubsub.publish(CONFIG.TOPICS.PROFILE_UPDATES_TOPIC, encodedMessage); 
      console.log(`📡 [PubSub] Отправлен ${CONFIG.PROFILE.MSG_PROFILE_REQUEST} для: ${targetPeerId}`);
    } catch (error) {
      console.error('Ошибка при запросе обновления профиля:', error);
    }
  };

  const handleDeleteContact = async (e: React.MouseEvent, contactId: string) => {
    e.stopPropagation(); 
    if (window.confirm('Точно удалить этот контакт?')) {
      const success = await deleteContact(globalContactsDb, contactId);
      if (success) {
        const updatedList = await getAllContacts(globalContactsDb);
        setContacts(updatedList);
      }
    }
  };

  const handleSaveProfile = async (newNickname: string, newBio: string, newAvatarBlob: Blob | null) => {
    if (!dbInstance) return;
    try {
      const timestamp = Date.now();
      await dbInstance.put(CONFIG.PROFILE.KEY_NICKNAME, newNickname);
      await dbInstance.put(CONFIG.PROFILE.KEY_BIO, newBio);
      await dbInstance.put(CONFIG.PROFILE.KEY_LAST_UPDATED, timestamp);

      if (newAvatarBlob && globalHelia) {
        const cid = await uploadAvatarToHelia(globalHelia, newAvatarBlob);
        try {
          const dht = globalHelia.libp2p.dht;
          if (dht && typeof dht.provide === 'function') {
            await dht.provide(CID.parse(cid)).catch((e: unknown) => console.warn("DHT provide failed", e))
          }
          console.log("✅ Блок анонсирован в DHT");
        } catch (err) {
          console.warn("⚠️ Ошибка при анонсе в DHT (возможно, это нормально для клиента):", err);
        }
        await dbInstance.put(CONFIG.PROFILE.KEY_AVATAR_CID, cid);
        const localUrl = URL.createObjectURL(newAvatarBlob);
        setMyAvatarUrl(localUrl);
      }
      
      setMyNickname(newNickname);
      setMyBio(newBio);

      if (globalHelia) {
        await broadcastMyProfile();
      }
    } catch (error) {
      console.error('Не удалось сохранить профиль в P2P:', error);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate('/', { replace: true });
  };

  const handleShare = async () => {
    if (!globalHelia || !globalProfileDb) return alert('Сеть еще не готова!');
    try {
      const myPeerId = globalHelia.libp2p.peerId.toString();
      const profileAddr = globalProfileDb.address.toString();
      const tokenObj = { id: myPeerId, profile: profileAddr };
      const base64Token = btoa(JSON.stringify(tokenObj));
      await navigator.clipboard.writeText(base64Token);
      alert('Твой код скопирован в буфер обмена! Отправь его собеседнику.');
    } catch (err) {
      console.error('Ошибка копирования', err);
    }
  };

  const handleAdd = async () => {
    const token = window.prompt('Вставь код контакта:');
    if (!token) return;
    try {
      const decoded = JSON.parse(atob(token));
      if (!decoded.id || !decoded.profile) throw new Error('Кривой токен');
      if (globalHelia && decoded.id === globalHelia.libp2p.peerId.toString()) {
        alert('Нельзя добавить самого себя :)');
        return;
      }

      const peerShort = `${decoded.id.slice(0, 8)}...`;
      let newContact: ContactItem = {
        id: decoded.id,
        profileDbAddress: decoded.profile,
        chatDbAddress: '', 
        nickname: `Пир: ${peerShort}`, 
        avatarCid: '',
        updatedAt: Date.now(),
        lastMessage: 'Привет! Как дела?',
        lastMessageTime: 1718182000000
      };

      await saveContact(globalContactsDb, newContact);
      setContacts(await getAllContacts(globalContactsDb));

      if (globalHelia) {
        try {
          const pubsub = globalHelia.libp2p.services.pubsub;
          const msg = { type: CONFIG.PROFILE.MSG_PROFILE_REQUEST, targetId: decoded.id };
          await pubsub.publish(CONFIG.TOPICS.PROFILE_UPDATES_TOPIC, new TextEncoder().encode(JSON.stringify(msg)));
          console.log(`📤 [PubSub] Отправлен быстрый пинг PROFILE_REQUEST для ${peerShort}`);
        } catch (pubSubError) {
          console.error('❌ [PubSub] Ошибка при отправке пинга:', pubSubError);
        }
      }

      if (globalOrbitDB) {
        console.log(`🔄 Фоновая синхронизация профиля: ${decoded.profile}`);
        try {
          const remoteProfileDb = await globalOrbitDB.open(decoded.profile, { type: 'keyvalue' });
          await remoteProfileDb.load();
          remoteProfileDb.events.on('update', async (_address: any, _hash: string, entry: any) => {
            console.log('🔄 Получено обновление профиля друга через OrbitDB:', entry.payload.value);
          });
          
          const realName = await remoteProfileDb.get(CONFIG.PROFILE.KEY_NICKNAME);
          const realAvatar = await remoteProfileDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);

          if (realName) {
            console.log(`✅ Профиль был в кэше сети! Имя: ${realName}`);
            newContact.nickname = realName;
            if (realAvatar) newContact.avatarCid = realAvatar;
            await saveContact(globalContactsDb, newContact);
            setContacts(await getAllContacts(globalContactsDb));
          }
        } catch (syncError) {
          console.warn('⚠️ Ошибка при попытке фонового открытия базы OrbitDB:', syncError);
        }
      }
    } catch (err) {
      alert('Неверный формат кода!');
      console.error('Ошибка парсинга токена контакта:', err);
    }
  };

  // Возвращаем всё, что нужно для отрисовки интерфейса
  return {
    navigate,
    isLoading,
    dbInstance,
    isProfileOpen,
    setIsProfileOpen,
    myNickname,
    myBio,
    myAvatarUrl,
    contacts,
    handleRefreshContact,
    handleDeleteContact,
    handleSaveProfile,
    handleLogout,
    handleShare,
    handleAdd
  };
};