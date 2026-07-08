import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CID } from 'multiformats/cid';
import jsQR from 'jsqr';

import { globalProfileDb, globalContactsDb, onDbReady, globalHelia, broadcastMyProfile } from '../lib/p2p/services/authService.ts'; 
import { getAllContacts, saveContact, deleteContact, syncContactHistory, getContactById, type ContactItem, type PrivacyType } from '../lib/p2p/services/contactsService.ts';
import { decryptBlacklist, isAuthenticated, encryptBlacklist } from '../lib/p2p/crypto/crypto.ts';
import { CONFIG } from '../lib/p2p/config.ts';
import { uploadAvatarToHelia, fetchAvatarFromHelia } from '../lib/p2p/services/avatarService';
import { requestPeerProfile, forceSyncContactProfile } from '../lib/p2p/services/profileService.ts';
import { globalNetworkState } from '../lib/p2p/networking/NetworkStateMachine.ts';
import { globalSyncQueue } from '../lib/p2p/networking/SyncQueue.ts'; 

export const useContactsLogic = () => {
  const navigate = useNavigate();

  // --- БАЗОВЫЕ СТЕЙТЫ ПРОФИЛЯ И БАЗЫ ---
  const [myNickname, setMyNickname] = useState<string>('');
  const [myBio, setMyBio] = useState<string>(''); 
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  const [myPrivacy, setMyPrivacy] = useState<PrivacyType>('public');
  const [peerId, setPeerId] = useState<string | null>(null);
  
  const [dbInstance, setDbInstance] = useState<any>(globalProfileDb);
  const [contactsDbInstance, setContactsDbInstance] = useState<any>(globalContactsDb);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [contacts, setContacts] = useState<ContactItem[]>([]);

  // --- СТЕЙТ ПОИСКА ---
  const [searchQuery, setSearchQuery] = useState<string>('');

  // --- UI СТЕЙТЫ И ТОСТЫ ---
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addPeerId, setAddPeerId] = useState('');

  // --- СЕТЬ ---
  const [netState, setNetState] = useState<string>(globalNetworkState?.state || 'DISCONNECTED');
  const isNetworkReady = netState === 'CONNECTED';

  // --- РЕФЫ КАМЕРЫ ---
  const addVideoRef = useRef<HTMLVideoElement>(null);
  const addStreamRef = useRef<MediaStream | null>(null);
  const addCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // --- ДИАЛОГ ---
  const [dialogConfig, setDialogConfig] = useState({
    isOpen: false, title: '', message: '', confirmText: 'Да', isDanger: false, onConfirm: () => {}
  });
  
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };
  
  const closeDialog = () => setDialogConfig(prev => ({ ...prev, isOpen: false }));

  // --- ОЧЕРЕДЬ ДЛЯ ЗАГРУЗКИ КОНТАКТОВ ---
  const syncContactInQueue = (contact: ContactItem) => {
    // Простая проверка: если адрес есть, шлем в очередь
    if (contact.chatDbAddress && !contact.isBlocked) {
      globalSyncQueue.add(contact, globalContactsDb);
    }
  };

  // ==========================================
  // БЛОКИРОВКА КНОПКИ "НАЗАД" (ИМИТАЦИЯ ОЧИСТКИ СТЭКА)
  // ==========================================
  useEffect(() => {
    // 1. Заменяем текущую запись в истории, чтобы убрать привязку к предыдущему роуту
    window.history.replaceState(null, '', window.location.pathname);
    
    // 2. Делаем фиктивный шаг вперед. Это создает "буфер" в истории.
    window.history.pushState(null, '', window.location.pathname);

    const handlePopState = () => {
      // 3. Когда юзер жмет "Назад" в браузере или на телефоне,
      // он падает в наш "буфер". Мы тут же снова кидаем его вперед.
      // В итоге вернуться в чат становится физически невозможно.
      window.history.pushState(null, '', window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // ==========================================
  // ЛОГИКА ФИЛЬТРАЦИИ ПОИСКА
  // ==========================================
  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const query = searchQuery.toLowerCase();
    return contacts.filter(contact => {
      const nameMatch = contact.nickname?.toLowerCase().includes(query);
      const idMatch = contact.id.toLowerCase().includes(query);
      return nameMatch || idMatch;
    });
  }, [contacts, searchQuery]);

  // ==========================================
  // ЭФФЕКТЫ И СИНХРОНИЗАЦИЯ
  // ==========================================

  // Следим за сетью
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let checkTimer: any = null;

    const trySubscribe = () => {
      if (globalNetworkState) {
        setNetState(globalNetworkState.state);
        unsubscribe = globalNetworkState.subscribe(setNetState);
        if (checkTimer) clearInterval(checkTimer);
        return true;
      }
      return false;
    };

    if (!trySubscribe()) checkTimer = setInterval(trySubscribe, 50);

    return () => {
      if (checkTimer) clearInterval(checkTimer);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Закрытие меню при клике вне
  useEffect(() => {
    const handleClickOutside = () => {
      setActiveMenuId(null);
      setIsHeaderMenuOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Управление камерой при открытии/закрытии модалки
  useEffect(() => {
    if (isAddModalOpen) {
      setAddPeerId('');
      startAddCamera();
    } else {
      stopAddCamera();
    }
    return () => stopAddCamera();
  }, [isAddModalOpen]);

  // Обновление контактов
  useEffect(() => {
    const refreshContactsList = async () => {
      if (!contactsDbInstance) return; 
      try {
        const freshContacts = await getAllContacts(contactsDbInstance);
        setContacts(prev => {
          if (JSON.stringify(prev) === JSON.stringify(freshContacts)) return prev;
          return freshContacts;
        });
      } catch (err) {
        console.error('❌ Ошибка обновления:', err);
      }
    };

    // 1. Слушаем твой кастомный ивент, который дергается от 'update' в сервисе
    window.addEventListener('onContactsUpdated', refreshContactsList);
    
    // 2. Если база есть в стейте — делаем ПЕРВИЧНЫЙ запрос мгновенно!
    if (contactsDbInstance) {
      refreshContactsList();
    }

    return () => {
      window.removeEventListener('onContactsUpdated', refreshContactsList);
    };
  }, [contactsDbInstance]);

  // Защита роута
  useEffect(() => {
    if (!isAuthenticated()) navigate('/', { replace: true });
  }, [navigate]);

  // Получение своего Peer ID
  useEffect(() => {
    if (globalHelia?.libp2p?.peerId) {
      setPeerId(globalHelia.libp2p.peerId.toString());
    }
  }, [globalHelia]);

  // Загрузка первичных данных
  useEffect(() => {
    if (!isAuthenticated()) return;
    let isMounted = true;
    
    const loadData = async (profileDb: any) => {
      try {
        const name = await profileDb.get(CONFIG.PROFILE.KEY_NICKNAME);
        const bio = await profileDb.get(CONFIG.PROFILE.KEY_BIO);
        const avatarCID = await profileDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);
        const privacy = (await profileDb.get(CONFIG.PROFILE.KEY_PRIVACY)) || 'public';
        setMyPrivacy(privacy);

        const encryptedBlacklist = await profileDb.get(CONFIG.PROFILE.DB_BLACKLIST_KEY);
        if (encryptedBlacklist) {
          try {
            const decryptedList = await decryptBlacklist(encryptedBlacklist);
            const localListStr = localStorage.getItem(CONFIG.PROFILE.BLACKLIST_KEY);
            const remoteListStr = JSON.stringify(decryptedList);
            
            if (localListStr !== remoteListStr) {
              localStorage.setItem(CONFIG.PROFILE.BLACKLIST_KEY, remoteListStr);
            }
          } catch (e) {
            console.error('Не удалось расшифровать блэклист', e);
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
        if (isMounted) setMyNickname('Ошибка');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    if (globalProfileDb && globalContactsDb) {
      setDbInstance(globalProfileDb);
      setContactsDbInstance(globalContactsDb);
      loadData(globalProfileDb);
    } else {
      const networkTimeout = setTimeout(() => {
        if (isMounted) setIsLoading(false);
      }, 3000);

      onDbReady(() => {
        clearTimeout(networkTimeout); 
        if (isMounted) {
          setDbInstance(globalProfileDb);
          setContactsDbInstance(globalContactsDb);
          loadData(globalProfileDb);
        }
      });
    }

    return () => { isMounted = false; };
  }, [navigate]);

  // ==========================================
  // ЛОГИКА КАМЕРЫ (QR)
  // ==========================================
  const startAddCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      addStreamRef.current = stream;
      if (addVideoRef.current) {
        addVideoRef.current.srcObject = stream;
        addVideoRef.current.onloadedmetadata = () => {
          addVideoRef.current?.play();
          animationFrameRef.current = requestAnimationFrame(scanQRCode);
        };
      }
    } catch (err) {
      console.error("❌ Нет доступа к камере", err);
    }
  };

  const scanQRCode = () => {
    const video = addVideoRef.current;
    if (!addCanvasRef.current) addCanvasRef.current = document.createElement('canvas');
    const canvas = addCanvasRef.current;

    if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });

        if (code && code.data) {
          setAddPeerId(code.data);
          stopAddCamera(); 
          return;
        }
      }
    }

    if (addStreamRef.current && video && !video.paused && !video.ended) {
      animationFrameRef.current = requestAnimationFrame(scanQRCode);
    }
  };

  const stopAddCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (addStreamRef.current) {
      addStreamRef.current.getTracks().forEach(track => track.stop());
      addStreamRef.current = null;
    }
  };

  // ==========================================
  // МЕТОДЫ ВЗАИМОДЕЙСТВИЯ (UI + Данные)
  // ==========================================
  const toggleContactMenu = (e?: React.MouseEvent, id?: string) => {
    e?.stopPropagation();
    if (id) {
      setActiveMenuId(activeMenuId === id ? null : id);
    }
  };

  const toggleHeaderMenu = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsHeaderMenuOpen(!isHeaderMenuOpen);
  };

  const handleCopyPeerId = async () => {
    if (!peerId) return;
    try {
      await navigator.clipboard.writeText(peerId);
      showToast('📋 Peer ID скопирован в буфер!'); 
    } catch (err) {
      showToast('❌ Ошибка при копировании');
    }
  };

  const onSubmitAddContact = () => {
    if (!addPeerId.trim()) return;
    handleAdd(addPeerId.trim()); 
    setIsAddModalOpen(false);
  };

  const handleRefreshContact = async (e: React.MouseEvent, targetPeerId: string) => {
    e.stopPropagation();
    if (globalHelia) {
      const targetContact = contacts.find(c => c.id === targetPeerId);
      
      if (targetContact) {
        showToast('🔄 Запрос на обновление отправлен...');
        
        // 🚀 Канал 1: Пробуем стянуть напрямую через OrbitDB (если сеть позволяет)
        forceSyncContactProfile(globalContactsDb, targetContact);
        
        // 🚀 Канал 2: Пинаем пира через PubSub (пробивает transient-соединения!)
        await requestPeerProfile(globalHelia, targetPeerId);
      } else {
        showToast('❌ Ошибка: контакт не найден');
      }
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

const handleSaveProfile = async (newNickname: string, newBio: string, newAvatarBlob: Blob | null, newPrivacy: PrivacyType) => {
    if (!dbInstance) return;
    try {
      const timestamp = Date.now();
      await dbInstance.put(CONFIG.PROFILE.KEY_NICKNAME, newNickname);
      await dbInstance.put(CONFIG.PROFILE.KEY_BIO, newBio);
      await dbInstance.put(CONFIG.PROFILE.KEY_LAST_UPDATED, timestamp);

      // Запоминаем текущий CID аватарки, чтобы правильно отправить его в сеть
      let currentAvatarCid = await dbInstance.get(CONFIG.PROFILE.KEY_AVATAR_CID);

      if (newAvatarBlob && globalHelia) {
        const cid = await uploadAvatarToHelia(globalHelia, newAvatarBlob);
        try {
          const dht = globalHelia.libp2p.dht;
          if (dht && typeof dht.provide === 'function') {
            await dht.provide(CID.parse(cid)).catch(() => {});
          }
        } catch {}
        await dbInstance.put(CONFIG.PROFILE.KEY_AVATAR_CID, cid);
        currentAvatarCid = cid; // Обновляем CID на свежезагруженный
        setMyAvatarUrl(URL.createObjectURL(newAvatarBlob));
      }
      
      setMyNickname(newNickname);
      setMyBio(newBio);
      
      await dbInstance.put(CONFIG.PROFILE.KEY_PRIVACY, newPrivacy);
      setMyPrivacy(newPrivacy);
      
      // 🚀 ФИКС САФАРИ: Передаем 100% свежие данные напрямую в функцию,
      // чтобы она не пыталась читать их из тормозящей локальной базы
      if (globalHelia) {
        await broadcastMyProfile({
          [CONFIG.PROFILE.KEY_NICKNAME]: newNickname,
          [CONFIG.PROFILE.KEY_BIO]: newBio,
          [CONFIG.PROFILE.KEY_AVATAR_CID]: currentAvatarCid
        });
      }

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
        closeDialog();
      }
    });
  };

  const handleAdd = async (inputData: string) => {
    if (!inputData) return;

    try {
      let targetId = inputData.trim();
      let profileAddress = '';

      try {
        const decoded = JSON.parse(atob(inputData));
        if (decoded.id) {
          targetId = decoded.id;
          profileAddress = decoded.profile || '';
        }
      } catch (e) {
        targetId = inputData;
      }

      if (targetId.length > 100 || targetId.includes(' ') || targetId.includes('\n')) {
        return showToast('⚠️ Неверный формат кода или Peer ID!');
      }

      if (globalHelia && targetId === globalHelia.libp2p.peerId.toString()) {
        return showToast('👤 Нельзя добавить самого себя');
      }

      const localBlacklistStr = localStorage.getItem(CONFIG.PROFILE.BLACKLIST_KEY);
      const localBlacklist = localBlacklistStr ? JSON.parse(localBlacklistStr) : [];
      const isActuallyBlocked = localBlacklist.includes(targetId);

      const existingContact = await getContactById(globalContactsDb, targetId);

      if (existingContact) {
        existingContact.isDeleted = false; 
        existingContact.isBlocked = isActuallyBlocked; 
        existingContact.updatedAt = Date.now();
        
        if (profileAddress) {
          existingContact.profileDbAddress = profileAddress;
        }

        await saveContact(globalContactsDb, existingContact);
        console.log(`♻️ [Contacts] Контакт ${existingContact.nickname} восстановлен!`);
        showToast('♻️ Контакт восстановлен из удаленных');

        if (existingContact.chatDbAddress) {
          console.log(`🔄 [Воскрешение] Запуск синхронизации истории для ${existingContact.nickname}`);
          
          setTimeout(async () => {
            await syncContactHistory(existingContact, globalContactsDb);
            window.dispatchEvent(new Event('onContactsUpdated')); 
          }, 200);
        }

      } else {
        const newContact: ContactItem = {
          id: targetId,
          profileDbAddress: profileAddress,
          chatDbAddress: '', 
          nickname: `Пир: ${targetId.slice(0, 8)}...`, 
          avatarCid: '',
          bio: '',
          updatedAt: Date.now(),
          isBlocked: isActuallyBlocked,
          isDeleted: false 
        };
        await saveContact(globalContactsDb, newContact);
        showToast('✅ Контакт успешно добавлен');
      }

      setContacts(await getAllContacts(globalContactsDb));

      if (globalHelia) {
        const freshContact = await getContactById(globalContactsDb, targetId);
        
        // 🚀 Всегда шлем PubSub запрос для мгновенного отклика
        await requestPeerProfile(globalHelia, targetId);
        
        // Параллельно запускаем OrbitDB синхронизацию
        if (freshContact && freshContact.profileDbAddress) {
          await forceSyncContactProfile(globalContactsDb, freshContact);
        }
      }

    } catch (error) {
      console.error('Ошибка добавления контакта:', error);
      showToast('❌ Ошибка при добавлении контакта');
    }
  };

  const handleBlockContact = async (e: any, id: string) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const targetContact = contacts.find(c => c.id === id);
    if (!targetContact) return;

    const updatedContact = { ...targetContact, isBlocked: true };

    try {
      await saveContact(globalContactsDb, updatedContact); 
      
      const localBlacklistStr = localStorage.getItem(CONFIG.PROFILE.BLACKLIST_KEY);
      const localBlacklist: string[] = localBlacklistStr ? JSON.parse(localBlacklistStr) : [];
      
      if (!localBlacklist.includes(id)) {
        localBlacklist.push(id);
        localStorage.setItem(CONFIG.PROFILE.BLACKLIST_KEY, JSON.stringify(localBlacklist));
        
        if (dbInstance) {
          const encrypted = await encryptBlacklist(localBlacklist);
          await dbInstance.put(CONFIG.PROFILE.DB_BLACKLIST_KEY, encrypted);
          console.log('📡 Блэклист зашифрован и успешно синхронизирован с OrbitDB профиля');
        }
      }

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

    const updatedContact = { ...targetContact, isBlocked: false };

    try {
      await saveContact(globalContactsDb, updatedContact); 
      
      const localBlacklistStr = localStorage.getItem(CONFIG.PROFILE.BLACKLIST_KEY);
      let localBlacklist: string[] = localBlacklistStr ? JSON.parse(localBlacklistStr) : [];
      
      localBlacklist = localBlacklist.filter(bId => bId !== id);
      localStorage.setItem(CONFIG.PROFILE.BLACKLIST_KEY, JSON.stringify(localBlacklist));

      if (dbInstance) {
        const encrypted = await encryptBlacklist(localBlacklist);
        await dbInstance.put(CONFIG.PROFILE.DB_BLACKLIST_KEY, encrypted);
        console.log('📡 Обновленный блэклист синхронизирован с OrbitDB профиля (бан снят)');
      }

      window.dispatchEvent(new Event('onContactsUpdated'));
      
      if (globalHelia) {
        if (updatedContact.profileDbAddress) {
          await forceSyncContactProfile(globalContactsDb, targetContact);
        } else {
          await requestPeerProfile(globalHelia, id);
        }
      }

      if (updatedContact.chatDbAddress) {
        console.log(`🔄 [Разблокировка] Тянем последнюю историю в фоне для ${id}`);
        
        setTimeout(async () => {
          await syncContactHistory(updatedContact, globalContactsDb);
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
    navigate, isLoading, dbInstance, contacts, filteredContacts, myPrivacy, peerId, dialogConfig, toastMessage,
    
    searchQuery, setSearchQuery,
    isProfileOpen, setIsProfileOpen,
    activeMenuId, setActiveMenuId,
    isHeaderMenuOpen, setIsHeaderMenuOpen,
    isShareModalOpen, setIsShareModalOpen,
    isAddModalOpen, setIsAddModalOpen,
    addPeerId, setAddPeerId,
    
    myNickname, myBio, myAvatarUrl,
    isNetworkReady, netState,
    
    addVideoRef,
    
    syncContactInQueue,
    closeDialog, showToast, toggleContactMenu, toggleHeaderMenu, handleCopyPeerId, onSubmitAddContact,
    handleRefreshContact, handleDeleteContact, handleSaveProfile, handleLogout, handleAdd,
    handleBlockContact, handleUnblockAndRefresh
  };
};


