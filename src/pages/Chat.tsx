import { useRef, useState, useEffect } from 'react';
import type { UIEvent } from 'react'; 
import { ArrowLeft, Settings, Send, Paperclip } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useIPFS } from '../hooks/useIPFS.ts';
import '../styles/chat.scss';
import type { ChatMessage } from '../lib/p2p/services/roomService.ts';
import { CONFIG } from '../lib/p2p/config.ts';

const Chat = () => {
  const { contactName } = useParams();
  const navigate = useNavigate();
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

  const roomName = contactName ?? 'global-chat';
  const isRoomReady = isReady && !!roomHandle && isRoomConnected;

  // Метод "1 пикселя" для плавной остановки
  // Жесткая блокировка скролла (улучшенная версия)
  useEffect(() => {
  const container = messagesContainerRef.current;
  if (!container) return;

  let startY = 0;

  const handleTouchStart = (e: TouchEvent) => {
    startY = e.touches[0].clientY;
  };

  const handleTouchMove = (e: TouchEvent) => {
    const currentY = e.touches[0].clientY;
    const isSwipingDown = currentY > startY; // Палец идет вниз (скролл вверх)

    // Если мы в самом верху (или почти) и тянем вниз - намертво блочим
    if (container.scrollTop <= 1 && isSwipingDown) {
      if (e.cancelable) {
        e.preventDefault();
      }
    }
  };

  const handleWheel = (e: WheelEvent) => {
    // e.deltaY < 0 это попытка прокрутить вверх
    if (container.scrollTop <= 1 && e.deltaY < 0) {
      if (e.cancelable) {
        e.preventDefault();
      }
    }
  };

  // passive: false критически важен для работы preventDefault()
  container.addEventListener('touchstart', handleTouchStart, { passive: true });
  container.addEventListener('touchmove', handleTouchMove, { passive: false });
  container.addEventListener('wheel', handleWheel, { passive: false });

  return () => {
    container.removeEventListener('touchstart', handleTouchStart);
    container.removeEventListener('touchmove', handleTouchMove);
    container.removeEventListener('wheel', handleWheel);
  };
}, []); // Убрал зависимость, чтобы слушатель навешивался один раз // Перезапускаем при изменении лоадера, чтобы не ломать подгрузку истории

  useEffect(() => {
    if (!isReady || !joinRoom) return;

    let isMounted = true;
    let activeHandle: any = null;

    const subscribe = async () => {
      setIsRoomConnected(false);

      try {
        const roomActions = await joinRoom(roomName, (message: ChatMessage) => {
          if (!isMounted) return;
          if (message?.text?.startsWith('System:')) return;

          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
        });

        // Если компонент размонтировался, пока мы ждали OrbitDB — сразу выходим
        if (!isMounted) {
          if (roomActions?.leaveRoom) roomActions.leaveRoom();
          return;
        }

        activeHandle = roomActions;
        setRoomHandle(roomActions);

        // Склейка сети в Gossipsub
        const libp2p = (helia as any)?.libp2p || (window as any).helia?.libp2p;
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
        // Заглушаем ошибку дублирования протокола из-за Strict Mode
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
  }, [isReady, roomName, joinRoom, helia]);

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

  // Если мы сейчас грузим историю, вообще выходим из функции
  if (isLoadingRef.current) return;

  const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
  isUserScrolledUp.current = distanceFromBottom > 50;

  // Условие загрузки
  if (target.scrollTop <= 1 && roomHandle?.hasMoreHistory()) {
    // Включаем блокировку до завершения всего процесса
    isLoadingRef.current = true;
    setIsLoadingMore(true);
    
    const previousScrollHeight = target.scrollHeight;
    
    try {
      await roomHandle.loadMoreHistory();
      
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          const newScrollHeight = messagesContainerRef.current.scrollHeight;
          // Устанавливаем скролл
          messagesContainerRef.current.scrollTop = newScrollHeight - previousScrollHeight;
        }
        
        // Разблокируем только СЛЕДУЮЩИМ тиком, чтобы избежать двойных срабатываний
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.target;
    textarea.style.height = '20px';
    const newHeight = Math.min(textarea.scrollHeight, 60);
    textarea.style.height = `${newHeight}px`;
    setDraft(textarea.value);
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="header-left">
          <button
            className="back-button"
            aria-label="Back"
            onClick={() => navigate('/contacts')}
          >
            <ArrowLeft size={24} className="back-icon" />
          </button>
          <div className="contact-name">{contactName || 'IPFS Chat'}</div>
        </div>
        <button className="settings-button" aria-label="Settings">
          <Settings size={22} className="settings-icon" />
        </button>
      </div>

      <div
        className="chat-messages"
        ref={messagesContainerRef}
        onScroll={(e) => !isLoadingRef.current && handleScroll(e)}
      >
        {isLoadingMore && (
          <div className="message system">Загрузка старых сообщений...</div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.type === 'sent' ? 'sent' : message.type === 'received' ? 'received' : 'system'}`}
          >
            {message.text}
          </div>
        ))}
        {!messages.length && !isLoadingMore && (
          <div className="message system">Ожидание сообщений в комнате...</div>
        )}
      </div>

      <div className="chat-input-area">
        <div className="input-container">
          <button
            className="attachment-button"
            aria-label="Attach file"
            disabled={!isRoomReady}
          >
            <Paperclip size={20} className="attachment-icon" />
          </button>
          <textarea
            value={draft}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={getInputPlaceholder()}
            disabled={!isRoomReady}
          />
        </div>
        <button
          className="send-button"
          aria-label="Send message"
          onClick={handleSendMessage}
          disabled={!isRoomReady || !draft.trim()}
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
};

export default Chat;