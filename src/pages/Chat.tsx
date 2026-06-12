import { ArrowLeft, Settings, Send, Paperclip } from 'lucide-react';
import '../styles/chat.scss';
import { useChatLogic } from '../hooks/useChatLogic.ts';

const Chat = () => {
  const {
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
  } = useChatLogic();

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
          <div className="contact-name">{displayName || 'IPFS Chat'}</div>
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