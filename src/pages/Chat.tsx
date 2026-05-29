import { useState, useEffect } from 'react';
import { ArrowLeft, Settings, Send, Paperclip } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useIPFS } from '../hooks/useIPFS';
import '../styles/chat.scss';
import type { ChatMessage } from '../lib/p2p/roomService';
import { CONFIG } from '../lib/p2p/config';

const NodeStatus = ({
  nodeId,
  isReady,
  roomHandle,
  isRoomConnected,
  error,
}: {
  nodeId: string | null;
  isReady: boolean;
  roomHandle: any;
  isRoomConnected: boolean;
  error: string | null;
}) => {
  // Вычисляем текстовый статус для пользователя
  const getStatusText = () => {
    if (!isReady) return '⏳ Запуск узла...';
    if (!roomHandle) return '⏳ Открытие базы данных...';
    if (!isRoomConnected) return '⏳ Сетевой коннект (Grafting)...';
    return '✅ Онлайн';
  };

  return (
    <div className="ipfs-status-card">
      <p>Статус: {getStatusText()}</p>
      <p className="ipfs-node-id">
        Мой ID: <strong>{nodeId || 'получение...'}</strong>
      </p>
      {error ? <p className="ipfs-error">Ошибка: {error}</p> : null}
    </div>
  );
};

const Chat = () => {
  const { contactName } = useParams();
  const navigate = useNavigate();
  const { isReady, nodeId, error, joinRoom, helia } = useIPFS(); // Достаем helia из хука
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  
  const [roomHandle, setRoomHandle] = useState<{
    sendMessage: (message: string) => Promise<void>;
    leaveRoom: () => void;
    pingRoom?: () => void; 
  } | null>(null);

  // 🔥 НОВЫЙ СТЕЙТ: Флаг того, что мост Gossipsub с релеем реально построен
  const [isRoomConnected, setIsRoomConnected] = useState<boolean>(false);

  const roomName = contactName ?? 'global-chat';

  // 🔥 Полная готовность = Нода готова + База открыта + Сеть склеилась
  const isRoomReady = isReady && !!roomHandle && isRoomConnected;

  useEffect(() => {
    if (!isReady || !joinRoom) return;

    let activeHandle: any = null;

    const subscribe = async () => {
      // Принудительно сбрасываем коннект при смене комнаты
      setIsRoomConnected(false); 
      
      // 1. Сначала открываем локальную базу данных (вызываем joinRoom из хука)
      const roomActions = await joinRoom(roomName, (message: ChatMessage) => {
        if (message?.text?.startsWith('System:')) return; 

        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev;
          return [...prev, message];
        });
      });

      activeHandle = roomActions;

      // 2. 🔥 Ждем пиров в ТОЧНОМ топике базы данных OrbitDB
      const libp2p = (helia as any)?.libp2p || (window as any).helia?.libp2p;
      if (libp2p && libp2p.services.pubsub && roomActions.dbAddress) {
        const pubsub = libp2p.services.pubsub;
        
        let attempts = 0;
        while (attempts < 50) {
          // Ищем подписчиков именно по точному адресу БД (например, /orbitdb/zdpuB2eq...)
          const subscribers = pubsub.getSubscribers(roomActions.dbAddress);
          
          if (subscribers && subscribers.length > 0) {
            console.log(`📡 [Gossipsub] Сеть склеилась! Топик: ${roomActions.dbAddress}. Пиров: ${subscribers.length}`);
            break; // Выходим из цикла мгновенно!
          }
          
          await new Promise((resolve) => setTimeout(resolve, 300));
          attempts++;
        }
      }

      // 3. Только ТЕПЕРЬ фиксируем полную готовность комнаты
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

  // HEARTBEAT (Пинг сервера для удержания комнаты)
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

  const handleSendMessage = async () => {
    const text = draft.trim();
    if (!text || !roomHandle) return;

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

  // Динамический плейсхолдер инпута для прозрачности логов
  const getInputPlaceholder = () => {
    if (!isReady) return 'Ожидание запуска узла...';
    if (!roomHandle) return 'Открытие базы данных комнаты...';
    if (!isRoomConnected) return 'Поиск пиров и склейка сети...';
    return 'Напишите сообщение...';
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="header-left">
          <button className="back-button" aria-label="Back" onClick={() => navigate('/contacts')}>
            <ArrowLeft size={24} className="back-icon" />
          </button>
          <div className="contact-name">{contactName || 'IPFS Chat'}</div>
        </div>
        <button className="settings-button" aria-label="Settings">
          <Settings size={22} className="settings-icon" />
        </button>
      </div>

      <NodeStatus 
        nodeId={nodeId} 
        isReady={isReady} 
        roomHandle={roomHandle}
        isRoomConnected={isRoomConnected} 
        error={error} 
      />

      <div className="chat-messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.type === 'sent' ? 'sent' : message.type === 'received' ? 'received' : 'system'}`}
          >
            {message.text}
          </div>
        ))}
        {!messages.length && (
          <div className="message system">Ожидание сообщений в комнате...</div>
        )}
      </div>

      <div className="chat-input-area">
        <div className="input-container">
          <button className="attachment-button" aria-label="Attach file" disabled={!isRoomReady}>
            <Paperclip size={20} className="attachment-icon" />
          </button>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
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