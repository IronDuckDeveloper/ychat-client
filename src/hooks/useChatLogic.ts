import { useRef, useState, useEffect } from 'react';
import type { UIEvent, ChangeEvent, KeyboardEvent } from 'react'; 
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useIPFS } from './useIPFS.ts';
import { type ChatMessage, getDeterministicRoomName } from '../lib/p2p/services/roomService.ts';
import { CONFIG } from '../lib/p2p/config.ts';
import * as contactsService from '../lib/p2p/services/contactsService.ts';
import { globalContactsDb } from '../lib/p2p/services/authService.ts';
import { clearUnread } from '../lib/p2p/services/contactsService.ts';

export const useChatLogic = () => {
  const navigate = useNavigate();
  const { peerId } = useParams(); 
  const location = useLocation();
  const [displayName, setDisplayName] = useState(
    location.state?.contactName || 'Загрузка...'
  );
  const { isReady, nodeId, joinRoom, helia } = useIPFS();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingRef = useRef(false); // Защита от гонок при загрузке истории

  const [roomHandle, setRoomHandle] = useState<{
    sendMessage: (message: string) => Promise<void>;
    leaveRoom: () => void;
    pingRoom?: () => void;
    dbAddress?: string;
    loadMoreHistory: () => Promise<void>;
    hasMoreHistory: () => boolean;
  } | null>(null);

  const [isRoomConnected, setIsRoomConnected] = useState<boolean>(false);
  const isRoomReady = isReady && !!roomHandle && isRoomConnected;

  useEffect(() => {
  if (globalContactsDb && peerId) {
    // Просто сбрасываем счетчик для этого пира при монтировании экрана чата
    clearUnread(globalContactsDb, peerId);
  }
}, [peerId, globalContactsDb]);

  useEffect(() => {
    const fetchNameFallback = async () => {
      if (displayName !== 'Загрузка...' || !peerId || !globalContactsDb) return;

      try {
        const contact = await contactsService.getContactById(globalContactsDb, peerId);
        if (contact) {
          setDisplayName(contact.nickname || contact.name);
        } else {
          setDisplayName(`${peerId.slice(0, 6)}...${peerId.slice(-4)}`);
        }
      } catch (error) {
        console.error('Ошибка при поиске контакта:', error);
        setDisplayName('Неизвестный');
      }
    };

    fetchNameFallback();
  }, [peerId, displayName]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    let startY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0].clientY;
      const isSwipingDown = currentY > startY;

      if (container.scrollTop <= 1 && isSwipingDown) {
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (container.scrollTop <= 1 && e.deltaY < 0) {
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  useEffect(() => {
    if (!isReady || !joinRoom) return;

    let isMounted = true;
    let activeHandle: any = null;

    const subscribe = async () => {
      setIsRoomConnected(false);

      try {
        const resolvedRoomDbId = (nodeId && peerId && peerId !== 'global-chat')
          ? await getDeterministicRoomName(nodeId, peerId)
          : (peerId ?? 'global-chat');

        const roomActions = await joinRoom(resolvedRoomDbId, (message: ChatMessage) => { 
          if (!isMounted) return;
          if (message?.text?.startsWith('System:')) return;

          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });

          // Обновляем базу при получении сообщения от пира
          if (peerId && globalContactsDb) {
            console.log(`🔄 [Chat] Обновляем превью для входящего от ${peerId}`);
            contactsService.updateLastMessage(globalContactsDb, peerId, message.text, Date.now());
          }
        });

        if (!isMounted) {
          if (roomActions?.leaveRoom) roomActions.leaveRoom();
          return;
        }

        activeHandle = roomActions;
        setRoomHandle(roomActions);

        const libp2p = (helia as any)?.libp2p || (window as any).helia?.helia?.libp2p;
        if (libp2p && libp2p.services.pubsub && roomActions.dbAddress) {
          const pubsub = libp2p.services.pubsub;

          let attempts = 0;
          while (attempts < 50 && isMounted) {
            const subscribers = pubsub.getSubscribers(roomActions.dbAddress);

            if (subscribers && subscribers.length > 0) {
              console.log(
                `📡 [Gossipsub] Сеть склеилась! Топик: ${roomActions.dbAddress}. Пиров: ${subscribers.length}`,
              );
              break;
            }

            await new Promise((resolve) => setTimeout(resolve, 300));
            attempts++;
          }
        }

        if (isMounted) {
          setIsRoomConnected(true);
        }

      } catch (err: any) {
        if (err?.message?.includes('Handler already registered')) {
          console.log('⚠️ [Chat] Повторная регистрация обработчика заблокирована (Strict Mode).');
          return;
        }
        
        console.error('Failed to join room:', err);
      }
    };

    subscribe();

    return () => {
      isMounted = false;
      if (activeHandle?.leaveRoom) {
        activeHandle.leaveRoom();
      }
      setRoomHandle(null);
      setIsRoomConnected(false);
    };
  }, [isReady, joinRoom, helia, nodeId, peerId]);

  useEffect(() => {
    if (!roomHandle || !roomHandle.pingRoom) return;

    const pingRelay = () => {
      if (roomHandle?.pingRoom) {
        roomHandle.pingRoom();
      }
    };

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        pingRelay();
      }
    }, CONFIG.INACTIVITY_TIMEOUT_MS);

    const handleFocus = () => pingRelay();
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [roomHandle]);

  const handleScroll = async (e: UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    if (isLoadingRef.current) return;

    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    isUserScrolledUp.current = distanceFromBottom > 50;

    if (target.scrollTop <= 1 && roomHandle?.hasMoreHistory()) {
      isLoadingRef.current = true;
      setIsLoadingMore(true);
      
      const previousScrollHeight = target.scrollHeight;
      
      try {
        await roomHandle.loadMoreHistory();
        
        requestAnimationFrame(() => {
          if (messagesContainerRef.current) {
            const newScrollHeight = messagesContainerRef.current.scrollHeight;
            messagesContainerRef.current.scrollTop = newScrollHeight - previousScrollHeight;
          }
          
          setTimeout(() => {
            isLoadingRef.current = false;
            setIsLoadingMore(false);
          }, 100); 
        });
      } catch (err) {
        isLoadingRef.current = false;
        setIsLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    if (!messagesContainerRef.current) return;
    if (!isLoadingMore && !isUserScrolledUp.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, isLoadingMore]);

  const handleSendMessage = async () => {
    const text = draft.trim();
    if (!text || !roomHandle) return;

    isUserScrolledUp.current = false;

    try {
      await roomHandle.sendMessage(text);
      setDraft('');

      // Обновляем базу при нашей отправке
      if (peerId && globalContactsDb) {
        console.log(`🔄 [Chat] Обновляем превью для исходящего к ${peerId}`);
        contactsService.updateLastMessage(globalContactsDb, peerId, text, Date.now());
      }

      // Отправляем легковесный пуш собеседнику в сеть!
      if (helia && peerId) {
        try {
          const myPeerId = (helia as any).libp2p.peerId.toString();
          const targetTopic = `${CONFIG.TOPICS.ANNOUNCE_NEW_MESSAGE}${peerId}`; // Топик твоего друга
          
          const notificationData = {
            from: myPeerId,
            text: text,
            ts: Date.now()
          };

          const encoded = new TextEncoder().encode(JSON.stringify(notificationData));
          await (helia as any).libp2p.services.pubsub.publish(targetTopic, encoded);
          console.log(`📤 [PubSub Пуш] Превью успешно отправлено в топик друга: ${targetTopic}`);
        } catch (err) {
          console.warn('⚠️ Не удалось отправить фоновый пуш собеседнику:', err);
        }
      }          
    } catch (err) {
      console.error('Ошибка отправки сообщения:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `system-error-${Date.now()}-${prev.length}`,
          whoSent: 'system',
          text: 'Не удалось отправить сообщение. Повторите попытку.',
          type: 'system',
        },
      ]);
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
    handleInput
  };
};