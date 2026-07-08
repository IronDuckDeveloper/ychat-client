import { useRef, useState, useEffect } from 'react';
import type { UIEvent, ChangeEvent, KeyboardEvent } from 'react'; 
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useIPFS } from './useIPFS.ts';
import { getDeterministicRoomName } from '../lib/p2p/services/roomService.ts';
import { type ChatMessage, type RoomActions, CONFIG, type ContactItem } from '../lib/p2p/config.ts';
import * as contactsService from '../lib/p2p/services/contactsService.ts';
import { fetchAvatarFromHelia } from '../lib/p2p/services/avatarService';
import { globalContactsDb, globalHelia } from '../lib/p2p/services/authService.ts';

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

  const toggleAttachmentMenu = (e?: React.MouseEvent) => {
  e?.stopPropagation(); // Блокируем всплытие, чтобы слушатель document не закрыл меню сразу же
  setIsAttachmentMenuOpen(!isAttachmentMenuOpen);
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
    
    // 👈 Проверяем isReady. Как только он станет true, база уже гарантированно открыта
    if (isReady && globalContactsDb && peerId) {
      refreshContactData();
    }

    return () => {
      window.removeEventListener('onContactsUpdated', refreshContactData);
    };
  }, [peerId, isReady]); // 👈 ГЛАВНОЕ: добавили isReady в зависимости вместо глобальной переменной

// Логика получения аватара из Helia FS
  useEffect(() => {
    // Ждем, пока нода реально поднимется (isReady === true) и появится globalHelia
    if (!isReady || !globalHelia || !contact?.avatarCid) {
      // Убрали setAvatarUrl(null), чтобы при F5 аватар не мигал, 
      // если он придет чуть позже
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
  }, [contact?.avatarCid, isReady]); // 👈 ГЛАВНОЕ: добавили isReady в зависимости

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

            contactsService.updateLastMessage(globalContactsDb, peerId, message.text, message.ts || Date.now(), shouldIncrement);

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
    toggleAttachmentMenu
  };
};