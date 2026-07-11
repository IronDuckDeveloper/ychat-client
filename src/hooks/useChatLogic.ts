import { useRef, useState, useEffect } from 'react';
import type { UIEvent, ChangeEvent, KeyboardEvent } from 'react'; 
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useIPFS } from './useIPFS.ts';
import { getDeterministicRoomName, type ChatMessage, type RoomActions } from '../lib/p2p/services/roomService.ts';
import { CONFIG } from '../lib/p2p/config.ts';
import * as contactsService from '../lib/p2p/services/contactsService.ts';
import { fetchAvatarFromHelia } from '../lib/p2p/services/avatarService.ts';
import { globalContactsDb, globalHelia } from '../lib/p2p/services/authService.ts';
import type { ContactItem } from '../lib/p2p/services/contactsService.ts';
import { uploadFileToHelia } from '../lib/p2p/services/fileService.ts'; // 🔥 Импорт сервиса файлов

interface RouterState {
  contactName?: string;
  contact?: ContactItem;
}

export const useChatLogic = () => {
  const navigate = useNavigate();
  const { peerId } = useParams(); 
  const location = useLocation();
  const routerState = location.state as RouterState | null; 
  
  const [displayName, setDisplayName] = useState(routerState?.contactName || 'Загрузка...');
  const [contact, setContact] = useState<ContactItem | null>(routerState?.contact || null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const { isReady, nodeId, joinRoom } = useIPFS();
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  
  const isUserScrolledUp = useRef(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingRef = useRef(false);
  
  const [roomHandle, setRoomHandle] = useState<RoomActions | null>(null);
  const [isRoomConnected, setIsRoomConnected] = useState<boolean>(false);
  const isRoomReady = isReady && !!roomHandle && isRoomConnected;

  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);

  // 🔥 Логика чистой архитектуры для вложений файлов
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [acceptedFileTypes, setAcceptedFileTypes] = useState('*/*');

  const toggleAttachmentMenu = (e?: React.MouseEvent) => {
    e?.stopPropagation(); // Блокируем всплытие, чтобы слушатель document не закрыл меню сразу же
    setIsAttachmentMenuOpen(!isAttachmentMenuOpen);
  };

  const triggerFileInput = (type: 'image' | 'file' | 'audio') => {
    if (type === 'image') setAcceptedFileTypes('image/*,video/*');
    else if (type === 'audio') setAcceptedFileTypes('audio/*');
    else setAcceptedFileTypes('*/*');

    setIsAttachmentMenuOpen(false);
    
    // Небольшой таймаут, чтобы дать реакту обновить атрибут accept на инпуте
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 10);
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !roomHandle || !globalHelia) return;

    try {
      setIsUploadingFile(true);
      
      // 1. Загружаем файл в Helia FS и собираем метаданные + микро-превью
      const attachmentInfo = await uploadFileToHelia(globalHelia, file);
      
      // 2. Публикуем в OrbitDB. Текст сообщения пустой, передаем структуру вложения
      await roomHandle.sendMessage('', attachmentInfo);

      // 3. Отправляем фоновый пуш-коммит через PubSub сети
      if (globalHelia && peerId) {
        try {
          const myPeerId = (globalHelia as any).libp2p.peerId.toString();
          const targetTopic = `${CONFIG.TOPICS.ANNOUNCE_NEW_MESSAGE}${peerId}`;
          const notificationData = { from: myPeerId, text: `📎 Файл: ${file.name}`, ts: Date.now() };
          const encoded = new TextEncoder().encode(JSON.stringify(notificationData));
          await (globalHelia as any).libp2p.services.pubsub.publish(targetTopic, encoded);
        } catch (err) {
          console.warn('⚠️ Не удалось отправить фоновый пуш вложения:', err);
        }
      }          
    } catch (err) {
      console.error('❌ Ошибка при обработке и отправке файла через Helia:', err);
    } finally {
      setIsUploadingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = ''; // Сбрасываем инпут для возможности повторного выбора
      }
    }
  };

  // Закрытие меню вложений при клике вне его области
  useEffect(() => {
    const handleClickOutside = () => {
      setIsAttachmentMenuOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Очистка уведомлений
  useEffect(() => {
    if (globalContactsDb && peerId) {
      contactsService.clearUnread(globalContactsDb, peerId);
    }
    return () => {
      if (globalContactsDb && peerId) {
        contactsService.clearUnread(globalContactsDb, peerId);
      }
    };
  }, [peerId]);

  // Функция получения и обновления данных контакта из локальной базы
  const refreshContactData = async () => {
    if (!peerId || !globalContactsDb) return;
    try {
      const fetchedContact = await contactsService.getContactById(globalContactsDb, peerId);
      if (fetchedContact) {
        setContact(fetchedContact);
        setDisplayName(fetchedContact.nickname || fetchedContact.id);
      } else if (displayName === 'Загрузка...') {
        setDisplayName(`${peerId.slice(0, 6)}...${peerId.slice(-4)}`);
      }
    } catch (err) {
      console.error('❌ Ошибка при получении контакта в чате:', err);
      if (displayName === 'Загрузка...') setDisplayName('Неизвестный');
    }
  };

  // Подписываемся на событие обновления контактов
  useEffect(() => {
    window.addEventListener('onContactsUpdated', refreshContactData);
    
    if (isReady && globalContactsDb && peerId) {
      refreshContactData();
    }

    return () => {
      window.removeEventListener('onContactsUpdated', refreshContactData);
    };
  }, [peerId, isReady]);

  // Логика получения аватара из Helia FS
  useEffect(() => {
    if (!isReady || !globalHelia || !contact?.avatarCid) {
      return; 
    }

    let isMounted = true;

    const fetchAvatar = async () => {
      try {
        const url = await fetchAvatarFromHelia(globalHelia, contact.avatarCid);
        if (isMounted) {
          setAvatarUrl(url);
        }
      } catch (err) {
        console.error('❌ Ошибка при загрузке аватара в чате:', err);
        if (isMounted) setAvatarUrl(null);
      }
    };

    fetchAvatar();

    return () => {
      isMounted = false;
    };
  }, [contact?.avatarCid, isReady]);

  // Подключение к комнате PubSub / OrbitDB
  useEffect(() => {
    if (!isReady || !joinRoom) return;

    let isMounted = true;
    let activeHandle: any = null;

    const subscribe = async () => {
      setIsRoomConnected(false);
      setMessages([]);

      try {
        const resolvedRoomDbId = (nodeId && peerId && peerId !== 'global-chat')
          ? await getDeterministicRoomName(nodeId, peerId)
          : (peerId ?? 'global-chat');

        const roomActions = await joinRoom(resolvedRoomDbId, (message: ChatMessage, isBackgroundSync: boolean = false) => { 
          if (!isMounted) return;
          if (message?.text?.startsWith('System:')) return;

          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            const updated = [message, ...prev];
            return updated.sort((a, b) => (b.ts || Date.now()) - (a.ts || Date.now()));
          });

          if (peerId && globalContactsDb && peerId !== 'global-chat') {
            const isCurrentlyInThisChat = window.location.pathname.includes(peerId);
            const shouldIncrement = !isCurrentlyInThisChat && !isBackgroundSync && message.type !== 'sent';

            // Если текста нет (отправлен только файл), пишем заглушку в список чатов
            const displayNotificationText = message.text || (message.attachment ? '📎 Вложение' : '');
            contactsService.updateLastMessage(globalContactsDb, peerId, displayNotificationText, message.ts || Date.now(), shouldIncrement);

            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event('onContactsUpdated'));
            }

            if (isCurrentlyInThisChat) {
              contactsService.clearUnread(globalContactsDb, peerId);
            }
          }
        });

        if (!isMounted) {
          if (roomActions?.leaveRoom) roomActions.leaveRoom();
          return;
        }

        activeHandle = roomActions;
        setRoomHandle(roomActions);

        if (peerId && globalContactsDb && roomActions.dbAddress) {
          contactsService.updateChatDbAddress(globalContactsDb, peerId, roomActions.dbAddress);
        }

        setIsRoomConnected(true);
      } catch (err) {
        console.error('Failed to join room:', err);
      }
    };

    subscribe();

    return () => {
      isMounted = false;
      if (activeHandle?.leaveRoom) activeHandle.leaveRoom();
      setRoomHandle(null);
      setIsRoomConnected(false);
    };
  }, [isReady, joinRoom, nodeId, peerId]);

  const handleScroll = async (e: UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    if (isLoadingRef.current || !roomHandle) return;

    const scrollOffset = Math.abs(target.scrollTop);
    isUserScrolledUp.current = scrollOffset > 50;

    const isAtTop = scrollOffset + target.clientHeight >= target.scrollHeight - 10;

    if (isAtTop && roomHandle.hasMoreHistory && roomHandle.hasMoreHistory()) {
      isLoadingRef.current = true;
      setIsLoadingMore(true);
      try {
        await roomHandle.loadMoreHistory();
      } catch (err) {
        console.error("Ошибка при подгрузке истории:", err);
      } finally {
        isLoadingRef.current = false;
        setIsLoadingMore(false);
      }
    }
  };

  const handleSendMessage = async () => {
    const text = draft.trim();
    if (!text || !roomHandle) return;

    isUserScrolledUp.current = false;

    try {
      const now = Date.now();
      await roomHandle.sendMessage(text);
      setDraft('');

      if (globalHelia && peerId) {
        try {
          const myPeerId = (globalHelia as any).libp2p.peerId.toString();
          const targetTopic = `${CONFIG.TOPICS.ANNOUNCE_NEW_MESSAGE}${peerId}`;
          const notificationData = { from: myPeerId, text, ts: now };
          const encoded = new TextEncoder().encode(JSON.stringify(notificationData));
          await (globalHelia as any).libp2p.services.pubsub.publish(targetTopic, encoded);
        } catch (err) {
          console.warn('⚠️ Не удалось отправить фоновый пуш:', err);
        }
      }          
    } catch {
      console.error('Ошибка отправки сообщения');
    }
  };

  const getInputPlaceholder = () => {
    if (!isReady) return 'Ожидание запуска узла...';
    if (!roomHandle) return 'Открытие базы данных комнаты...';
    if (!isRoomConnected) return 'Поиск пиров и склейка сети...';
    return 'Напишите сообщение...';
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const handleInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.target;
    textarea.style.height = '20px';
    const newHeight = Math.min(textarea.scrollHeight, 60);
    textarea.style.height = `${newHeight}px`;
    setDraft(textarea.value);
  };

  return {
    navigate,
    displayName,
    contact,           
    avatarUrl, 
    messages,
    draft,
    messagesContainerRef,
    isLoadingMore,
    isLoadingRef,
    isRoomReady,
    handleScroll,
    handleSendMessage,
    getInputPlaceholder,
    handleKeyDown,
    handleInput,
    isAttachmentMenuOpen,
    setIsAttachmentMenuOpen,
    toggleAttachmentMenu,
    
    // 🔥 Экспорты для UI вложений
    fileInputRef,
    isUploadingFile,
    acceptedFileTypes,
    triggerFileInput,
    handleFileUpload
  };
};