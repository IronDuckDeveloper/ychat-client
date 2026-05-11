import { useState, useEffect } from 'react';
import { ArrowLeft, Settings, Send, Paperclip } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useIPFS } from '../hooks/useIPFS';
import '../styles/chat.scss';

type MessageType = 'sent' | 'received' | 'system';

const NodeStatus = ({
  nodeId,
  isReady,
  error,
}: {
  nodeId: string | null;
  isReady: boolean;
  error: string | null;
}) => {
  return (
    <div className="ipfs-status-card">
      <p>Статус: {isReady ? '✅ Онлайн' : '⏳ Запуск...'}</p>
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
  const { isReady, nodeId, error, joinRoom } = useIPFS();
  const [messages, setMessages] = useState<
    {
      id: string;
      text: string;
      type: MessageType;
    }[]
  >([]);
  const [draft, setDraft] = useState('');
  const [roomHandle, setRoomHandle] = useState<{
    sendMessage: (message: string) => Promise<void>;
    leaveRoom: () => void;
  } | null>(null);

  const roomName = contactName ?? 'global-chat';

useEffect(() => {
  if (!isReady || !joinRoom) return;

  let activeHandle: any = null;

  const subscribe = async () => {
    // Вызываем joinRoom и передаем callback
    const handle = await joinRoom(roomName, (message: string) => {
      // Игнорируем технические системные сообщения прогрева, если они прилетают
      if (message.startsWith('System:')) return; 

      setMessages((prev) => [
        ...prev,
        {
          id: `received-${Date.now()}-${prev.length}`,
          text: message,
          type: 'received',
        },
      ]);
    });

    activeHandle = handle;
    setRoomHandle(handle);

    setMessages((prev) => [
      ...prev,
      {
        id: `system-${Date.now()}-${prev.length}`,
        text: `Подключено к комнате: ${roomName}`,
        type: 'system',
      },
    ]);
  };

  subscribe().catch((err) => {
    console.error('Failed to join room:', err);
  });

  return () => {
    if (activeHandle) {
      activeHandle.leaveRoom();
    }
    setRoomHandle(null);
  };
}, [isReady, roomName, joinRoom]);

  const handleSendMessage = async () => {
    const text = draft.trim();
    if (!text || !roomHandle) {
      return;
    }

    try {
      await roomHandle.sendMessage(text);
      setMessages((prev) => [
        ...prev,
        {
          id: `sent-${Date.now()}-${prev.length}`,
          text,
          type: 'sent',
        },
      ]);
      setDraft('');
    } catch (err) {
      console.error('Ошибка отправки сообщения:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `system-error-${Date.now()}-${prev.length}`,
          text: 'Не удалось отправить сообщение. Повторите попытку.',
          type: 'system',
        },
      ]);
    }
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

      <NodeStatus nodeId={nodeId} isReady={isReady} error={error} />

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
          <button className="attachment-button" aria-label="Attach file">
            <Paperclip size={20} className="attachment-icon" />
          </button>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              isReady ? 'Напишите сообщение...' : 'Ожидание запуска узла...'
            }
            disabled={!isReady}
          />
        </div>
        <button
          className="send-button"
          aria-label="Send message"
          onClick={handleSendMessage}
          disabled={!isReady || !draft.trim()}
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
};

export default Chat;
