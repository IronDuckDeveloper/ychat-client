import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CID } from 'multiformats/cid';

import { globalProfileDb, globalContactsDb, onDbReady, globalHelia, broadcastMyProfile } from '../lib/p2p/services/authService.ts'; 
import { getAllContacts, saveContact, deleteContact, syncContactHistory, getContactById } from '../lib/p2p/services/contactsService.ts';
import { decryptBlacklist, isAuthenticated, encryptBlacklist } from '../lib/p2p/crypto/crypto.ts';
import { CONFIG, type ContactItem } from '../lib/p2p/config.ts';
import { uploadAvatarToHelia, fetchAvatarFromHelia } from '../lib/p2p/services/avatarService';
import { requestPeerProfile } from '../lib/p2p/services/profileService.ts';

export const useContactsLogic = () => {
  const navigate = useNavigate();
  
  const [myNickname, setMyNickname] = useState<string>('Загрузка...');
  const [myBio, setMyBio] = useState<string>(''); 
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);

  const [peerId, setPeerId] = useState<string | null>(null);
  
  const [dbInstance, setDbInstance] = useState<any>(globalProfileDb);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  
  const [contacts, setContacts] = useState<ContactItem[]>([]);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Хелпер для показа тоста (чтобы не писать setTimeout в каждом методе)
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Cтейт для управления окном
  const [dialogConfig, setDialogConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Да',
    isDanger: false,
    onConfirm: () => {}
  });
  // Хелпер для закрытия
  const closeDialog = () => setDialogConfig(prev => ({ ...prev, isOpen: false }));

  useEffect(() => {
    const handleContactsUpdate = async () => {
      if (globalContactsDb) {
        const updatedList = await getAllContacts(globalContactsDb);
        setContacts(updatedList);
      }
    };
    window.addEventListener('onContactsUpdated', handleContactsUpdate);
    return () => window.removeEventListener('onContactsUpdated', handleContactsUpdate);
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) navigate('/', { replace: true });
  }, [navigate]);

  useEffect(() => {
    // Безопасно достаем ID только когда компонент уже отрендерился
    if (globalHelia?.libp2p?.peerId) {
    setPeerId(globalHelia.libp2p.peerId.toString());
  }
}, [globalHelia]);

  useEffect(() => {
  if (!isAuthenticated()) return;

  let isMounted = true; // Защита от обновления стейта убитого компонента

  const loadData = async (profileDb: any) => {
    try {
      const name = await profileDb.get(CONFIG.PROFILE.KEY_NICKNAME);
      const bio = await profileDb.get(CONFIG.PROFILE.KEY_BIO);
      const avatarCID = await profileDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);

      // СИНХРОНИЗАЦИЯ БЛЭКЛИСТА
      const encryptedBlacklist = await profileDb.get(CONFIG.PROFILE.DB_BLACKLIST_KEY);
      if (encryptedBlacklist) {
        try {
          const decryptedList = await decryptBlacklist(encryptedBlacklist);
          const localListStr = localStorage.getItem(CONFIG.PROFILE.BLACKLIST_KEY);
          const remoteListStr = JSON.stringify(decryptedList);
          
          if (localListStr !== remoteListStr) {
            localStorage.setItem(CONFIG.PROFILE.BLACKLIST_KEY, remoteListStr);
            console.log('🔄 Черный список синхронизирован с P2P-сетью');
          }
        } catch (e) {
          console.error('Не удалось расшифровать блэклист (неверный ключ?)', e);
        }
      }
      
      if (isMounted) {
        setMyNickname(name || 'Аноним');
        setMyBio(bio || '');
      }

      if (avatarCID && globalHelia && isMounted) { 
        const url = await fetchAvatarFromHelia(globalHelia, avatarCID);
        if (isMounted) setMyAvatarUrl(url);
      }

      if (globalContactsDb && isMounted) {
        const rawContacts = await getAllContacts(globalContactsDb);
        if (isMounted) setContacts(rawContacts);
      }
    } catch (error) {
      console.error('Ошибка при чтении данных:', error);
      if (isMounted) setMyNickname('Ошибка');
    } finally {
      if (isMounted) setIsLoading(false);
    }
  };

  if (globalProfileDb && globalContactsDb) {
    setDbInstance(globalProfileDb);
    loadData(globalProfileDb);
  } else {
    // 🚨 ПРЕДОХРАНИТЕЛЬ: Даем нетворкингу 3 секунды. 
    // Если onDbReady не наступил, принудительно снимаем лоадер.
    const networkTimeout = setTimeout(() => {
      if (isMounted) {
        console.warn('⚠️ [Network] onDbReady задерживается. Снимаем лоадер принудительно.');
        setIsLoading(false);
      }
    }, 3000);

    onDbReady(() => {
      clearTimeout(networkTimeout); // Успели подключиться - отменяем предохранитель
      if (isMounted) {
        setDbInstance(globalProfileDb);
        loadData(globalProfileDb);
      }
    });
  }

  return () => {
    isMounted = false; 
  };
}, [navigate]);

  const handleRefreshContact = async (e: React.MouseEvent, targetPeerId: string) => {
    e.stopPropagation();
    if (globalHelia) {
      await requestPeerProfile(globalHelia, targetPeerId);
      showToast('Запрос на обновление профиля отправлен');
    }
  };

  const handleDeleteContact = async (e: React.MouseEvent, contactId: string) => {
    e.stopPropagation(); 
    
    setDialogConfig({
      isOpen: true,
      title: 'Удалить контакт?',
      message: 'Этот контакт будет скрыт из вашего списка. История сообщений сохранится, но писать ему вы больше не сможете до повторного добавления.',
      confirmText: 'Удалить',
      isDanger: true,
      onConfirm: async () => {
        const success = await deleteContact(globalContactsDb, contactId);
        if (success) setContacts(await getAllContacts(globalContactsDb));
        closeDialog();
      }
    });
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
            await dht.provide(CID.parse(cid)).catch(() => {});
          }
        } catch {}
        await dbInstance.put(CONFIG.PROFILE.KEY_AVATAR_CID, cid);
        setMyAvatarUrl(URL.createObjectURL(newAvatarBlob));
      }
      
      setMyNickname(newNickname);
      setMyBio(newBio);
      if (globalHelia) await broadcastMyProfile();

      showToast('✨ Профиль успешно сохранен!');
    } catch (error) {
      console.error('Не удалось сохранить профиль в P2P:', error);
      showToast('❌ Ошибка при сохранении профиля');
    }
  };

  const handleLogout = () => {
    setDialogConfig({
      isOpen: true,
      title: 'Выйти из аккаунта?',
      message: 'Вы уверены, что хотите выйти? Убедитесь, что вы сохранили свою Seed-фразу, иначе вы потеряете доступ к своему профилю и чатам навсегда.',
      confirmText: 'Выйти',
      isDanger: true,
      onConfirm: () => {
        localStorage.clear();
        navigate('/', { replace: true });
        closeDialog(); // Не забываем закрыть окно
      }
    });
  };

  const handleAdd = async (inputData: string) => {
  if (!inputData) return;

  try {
    let targetId = inputData.trim();
    let profileAddress = '';

    // Пытаемся раскодировать токен
    try {
      const decoded = JSON.parse(atob(inputData));
      if (decoded.id) {
        targetId = decoded.id;
        profileAddress = decoded.profile || '';
      }
    } catch (e) {
      // Если это не base64 токен (ошибка парсинга), 
      // значит в поле ввели просто чистый Peer ID с нашего QR-кода или камеры
      targetId = inputData;
    }

    // Проверяем, что это похоже на ID, а не на кусок логов или поэму
    if (targetId.length > 100 || targetId.includes(' ') || targetId.includes('\n')) {
      return showToast('⚠️ Неверный формат кода или Peer ID!');
    }

    if (globalHelia && targetId === globalHelia.libp2p.peerId.toString()) {
      return showToast('👤 Нельзя добавить самого себя');
    }

    const localBlacklistStr = localStorage.getItem(CONFIG.PROFILE.BLACKLIST_KEY);
    const localBlacklist = localBlacklistStr ? JSON.parse(localBlacklistStr) : [];
    const isActuallyBlocked = localBlacklist.includes(targetId);

    // 👇 Ищем контакт в базе (он может быть там со статусом isDeleted: true)
    const existingContact = await getContactById(globalContactsDb, targetId);

    if (existingContact) {
      // ♻️ ВОСКРЕШЕНИЕ: Контакт был у нас раньше
      existingContact.isDeleted = false; 
      existingContact.isBlocked = isActuallyBlocked; 
      existingContact.updatedAt = Date.now();
      
      if (profileAddress) {
        existingContact.profileDbAddress = profileAddress;
      }

      await saveContact(globalContactsDb, existingContact);
      console.log(`♻️ [Contacts] Контакт ${existingContact.nickname} восстановлен!`);
      showToast('♻️ Контакт восстановлен из удаленных');

      // 👇 ПОДТЯГИВАЕМ ИСТОРИЮ (в фоне, чтобы не блочить UI)
      if (existingContact.chatDbAddress) {
        console.log(`🔄 [Воскрешение] Запуск синхронизации истории для ${existingContact.nickname}`);
        
        // Отпускаем основной поток, даем UI отрендериться, и через 100мс дергаем базу
        setTimeout(async () => {
          await syncContactHistory(existingContact, globalContactsDb);
          // Внутри syncContactHistory уже есть window.dispatchEvent('onContactsUpdated'),
          // если найдутся новые сообщения, так что руками здесь можно не дублировать, 
          // но для верности (чтобы обновить счетчики Unread) оставим:
          window.dispatchEvent(new Event('onContactsUpdated')); 
        }, 200);
      }

    } else {
      // ✨ НОВЫЙ КОНТАКТ: Создаем с чистого листа
      const newContact: ContactItem = {
        id: targetId,
        profileDbAddress: profileAddress,
        chatDbAddress: '', 
        nickname: `Пир: ${targetId.slice(0, 8)}...`, 
        avatarCid: '',
        updatedAt: Date.now(),
        isBlocked: isActuallyBlocked,
        isDeleted: false 
      };
      await saveContact(globalContactsDb, newContact);
      showToast('✅ Контакт успешно добавлен');
    }

    setContacts(await getAllContacts(globalContactsDb));

    if (globalHelia){ 
      await requestPeerProfile(globalHelia, targetId);
    }

  } catch (error) {
    console.error('Ошибка добавления контакта:', error);
    showToast('❌ Ошибка при добавлении контакта');
  }
};

// Блокировка контакта
const handleBlockContact = async (e: any, id: string) => {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  const targetContact = contacts.find(c => c.id === id);
  if (!targetContact) return;

  // 1. Ставим флаг для локальной базы контактов (чтобы сразу отработал фаервол)
  const updatedContact = { ...targetContact, isBlocked: true };

  try {
    await saveContact(globalContactsDb, updatedContact); 
    
    // 2. Записываем в вечную память localStorage текущего браузера
    const localBlacklistStr = localStorage.getItem(CONFIG.PROFILE.BLACKLIST_KEY);
    const localBlacklist: string[] = localBlacklistStr ? JSON.parse(localBlacklistStr) : [];
    
    if (!localBlacklist.includes(id)) {
      localBlacklist.push(id);
      localStorage.setItem(CONFIG.PROFILE.BLACKLIST_KEY, JSON.stringify(localBlacklist));
      
      // 3. ЖЕЛЕЗОБЕТОННО пушим в OrbitDB профиля, чтобы улетело на другие девайсы
      if (dbInstance) {
        const encrypted = await encryptBlacklist(localBlacklist);
        await dbInstance.put(CONFIG.PROFILE.DB_BLACKLIST_KEY, encrypted);
        console.log('📡 Блэклист зашифрован и успешно синхронизирован с OrbitDB профиля');
      }
    }

    // Обновляем UI
    window.dispatchEvent(new Event('onContactsUpdated'));
    
  } catch (error) {
    console.error("❌ Ошибка при блокировке контакта:", error);
    showToast('❌ Ошибка при сохранении блокировки');
  }
};

const handleUnblockAndRefresh = async (e: React.MouseEvent, id: string) => {
  e.stopPropagation();

  const targetContact = contacts.find(c => c.id === id);
  if (!targetContact || !targetContact.isBlocked) return;

  // 1. Снимаем блокировку в локальной ContactsDB
  const updatedContact = { ...targetContact, isBlocked: false };

  try {
    await saveContact(globalContactsDb, updatedContact); 
    
    // 2. Вычищаем ID из локального localStorage
    const localBlacklistStr = localStorage.getItem(CONFIG.PROFILE.BLACKLIST_KEY);
    let localBlacklist: string[] = localBlacklistStr ? JSON.parse(localBlacklistStr) : [];
    
    localBlacklist = localBlacklist.filter(bId => bId !== id);
    localStorage.setItem(CONFIG.PROFILE.BLACKLIST_KEY, JSON.stringify(localBlacklist));

    // 3. ЖЕЛЕЗОБЕТОННО обновляем OrbitDB, чтобы остальные девайсы тоже сняли бан
    if (dbInstance) {
      const encrypted = await encryptBlacklist(localBlacklist);
      await dbInstance.put(CONFIG.PROFILE.DB_BLACKLIST_KEY, encrypted);
      console.log('📡 Обновленный блэклист синхронизирован с OrbitDB профиля (бан снят)');
    }

    // Обновляем UI
    window.dispatchEvent(new Event('onContactsUpdated'));
    
    // Пытаемся запросить профиль заново, так как пир теперь разблокирован
    if (globalHelia) {
      await requestPeerProfile(globalHelia, id);
    }

    // Подтягиваем историю, если адрес базы у нас уже был
    if (updatedContact.chatDbAddress) {
      console.log(`🔄 [Разблокировка] Тянем последнюю историю в фоне для ${id}`);
      
      setTimeout(async () => {
        await syncContactHistory(updatedContact, globalContactsDb);
        // Второе событие, чтобы обновить счетчики непрочитанных (unreadCount), 
        // если в фоне реально нашлись новые сообщения
        window.dispatchEvent(new Event('onContactsUpdated')); 
      }, 200);
    }
    showToast('🔓 Контакт разблокирован');

  } catch (error) {
    console.error("❌ Ошибка при разблокировке контакта:", error);
    showToast('❌ Ошибка при разблокировке контакта');
  }
};

  return {
    navigate, isLoading, dbInstance, isProfileOpen, setIsProfileOpen,
    myNickname, myBio, myAvatarUrl, contacts, peerId, dialogConfig, closeDialog, toastMessage, showToast,
    handleRefreshContact, handleDeleteContact, handleSaveProfile, handleLogout, handleAdd,
    handleBlockContact, handleUnblockAndRefresh
  };
};