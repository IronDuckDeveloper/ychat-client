import { useRef, useState, useEffect } from 'react';
import type { UIEvent } from 'react'; // 🔥 Исправлено: отдельный импорт для типа
import { ArrowLeft, Settings, Send, Paperclip } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useIPFS } from '../hooks/useIPFS';
import '../styles/chat.scss';
import type { ChatMessage } from '../lib/p2p/services/roomService.ts';
import { CONFIG } from '../lib/p2p/config.ts';

// const NodeStatus = ({
//   nodeId,
//   isReady,
//   roomHandle,
//   isRoomConnected,
//   error,
// }: {
//   nodeId: string | null;
//   isReady: boolean;
//   roomHandle: any;
//   isRoomConnected: boolean;
//   error: string | null;
// }) => {
//   const getStatusText = () => {
//     if (!isReady) return '⏳ Запуск узла...';
//     if (!roomHandle) return '⏳ Открытие базы данных...';
//     if (!isRoomConnected) return '⏳ Сетевой коннект (Grafting)...';
//     return '✅ Онлайн';
//   };

//   return (
//     <div className="ipfs-status-card">
//       <p>Статус: {getStatusText()}</p>
//       <p className="ipfs-node-id">
//         Мой ID: <strong>{nodeId || 'получение...'}</strong>
//       </p>
//       {error ? <p className="ipfs-error">Ошибка: {error}</p> : null}
//     </div>
//   );
// };

const Chat = () => {
  const { contactName } = useParams();
  const navigate = useNavigate();
  const { isReady, nodeId, error, joinRoom, helia } = useIPFS();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

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

  useEffect(() => {
    if (!isReady || !joinRoom) return;

    let activeHandle: any = null;

    const subscribe = async () => {
      setIsRoomConnected(false);

      const roomActions = await joinRoom(roomName, (message: ChatMessage) => {
        if (message?.text?.startsWith('System:')) return;

        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev;
          return [...prev, message];
        });
      });

      activeHandle = roomActions;

      const libp2p = (helia as any)?.libp2p || (window as any).helia?.libp2p;
      if (libp2p && libp2p.services.pubsub && roomActions.dbAddress) {
        const pubsub = libp2p.services.pubsub;

        let attempts = 0;
        while (attempts < 50) {
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

      setRoomHandle(roomActions);
      setIsRoomConnected(true);
    };

    subscribe().catch((err) => {
      console.error('Failed to join room:', err);
    });

    return () => {
      if (activeHandle) {
        activeHandle.leaveRoom();
      }
      setRoomHandle(null);
      setIsRoomConnected(false);
    };
  }, [isReady, roomName, joinRoom, helia]);

  useEffect(() => {
    if (!roomHandle || !roomHandle.pingRoom) return;

    const pingRelay = () => {
      roomHandle.pingRoom!();
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

  // 🔥 Скролл подкачка сообщений
  const handleScroll = async (e: UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;

    // 🔥 НОВОЕ: Вычисляем, насколько юзер отдалился от низа.
    // Если больше чем на 50px — значит, он пошел читать историю.
    const distanceFromBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    isUserScrolledUp.current = distanceFromBottom > 50;

    // Старая логика пагинации
    if (
      target.scrollTop === 0 &&
      roomHandle?.hasMoreHistory() &&
      !isLoadingMore
    ) {
      setIsLoadingMore(true);

      const previousScrollHeight = target.scrollHeight;
      await roomHandle.loadMoreHistory();

      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop =
            messagesContainerRef.current.scrollHeight - previousScrollHeight;
        }
        setIsLoadingMore(false);
      });
    }
  };

  // Автоматический скролл вниз
  useEffect(() => {
    if (!messagesContainerRef.current) return;

    // Скроллим вниз ТОЛЬКО если:
    // 1. Мы не грузим старую историю (!isLoadingMore)
    // 2. Юзер сейчас НЕ читает историю где-то наверху (!isUserScrolledUp.current)
    if (!isLoadingMore && !isUserScrolledUp.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    const text = draft.trim();
    if (!text || !roomHandle) return;

    // 🔥 Сбрасываем флаг, чтобы при отправке своего сообщения нас точно кинуло вниз
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
    // 1. Проверяем, нажали ли Enter
    if (event.key === 'Enter') {
      // 2. Если зажат Shift, ничего не делаем (пусть textarea делает перенос по умолчанию)
      if (event.shiftKey) {
        return;
      }

      // 3. Если Shift НЕ зажат, отменяем стандартное поведение (перенос строки) и отправляем сообщение
      event.preventDefault();
      handleSendMessage(); // Твоя функция отправки сообщения
    }
  };

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.target;

    // 1. Сбрасываем высоту
    textarea.style.height = '20px';

    // 2. Рассчитываем новую высоту
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

      {/* <NodeStatus 
        nodeId={nodeId} 
        isReady={isReady} 
        roomHandle={roomHandle}
        isRoomConnected={isRoomConnected} 
        error={error} 
         // Временный статус для отладки сетевого состояния. Потом можно убрать или превратить в иконку в шапке.
      /> */}

      <div
        className="chat-messages"
        ref={messagesContainerRef}
        onScroll={handleScroll}
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
