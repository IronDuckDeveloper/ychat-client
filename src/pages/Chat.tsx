import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Send, Paperclip } from 'lucide-react';
import '../styles/chat.scss';
import { useChatLogic } from '../hooks/useChatLogic.ts';
import { globalContactsDb } from '../lib/p2p/services/authService.ts';
import { isPeerBlocked } from '../lib/p2p/services/contactsService';
import ContactProfileDrawer from '../components/ContactProfileDrawer.tsx'; // 👈 Добавили импорт
import Avatar from '../components/Avatar.tsx';

const Chat = () => {
  const { id } = useParams(); 
  
  const [isBlocked, setIsBlocked] = useState(false);
  const [isContactProfileOpen, setIsContactProfileOpen] = useState(false); // 👈 Стейт шторки

  const {
    navigate,
    avatarUrl,
    displayName,
    contact,
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

  useEffect(() => {
    const checkBlockStatus = async () => {
      if (!id || !globalContactsDb) return;
      
      const blockedStatus = await isPeerBlocked(globalContactsDb, id);
      setIsBlocked(blockedStatus); 

      if (blockedStatus) {
        console.warn(`🚫 Доступ в чат ${id} ограничен: пользователь заблокирован.`);
      }
    };

    checkBlockStatus();
  }, [id]); 

  const onBack = async () => {
    if (id) {
      navigate('/contacts', { replace: true });
    }
  };

  return (
    <div className="chat-container">
    {/* Разворот профиля контакта */}
      <ContactProfileDrawer 
        isOpen={isContactProfileOpen}
        onClose={() => setIsContactProfileOpen(false)}
        nickname={contact?.nickname || displayName || 'Неизвестный'}
        bio={contact?.bio || ''}
        avatarUrl={avatarUrl}
      />

      <header className="chat-header">
        <div className="header-left">
          <button className="back-button" onClick={() => navigate('/contacts', { replace: true })}>
            <ArrowLeft className="back-icon" size={20} /> {/* Или твоя иконка стрелки */}
          </button>
          {/* Имя контакта — теперь просто статичный текст, без onClick */}
          <span className="contact-name">{contact?.nickname || displayName || 'Неизвестный'}</span>
        </div>

        {/*  Аватар собеседника */}
        <Avatar 
          url={avatarUrl} 
          size={32} 
          onClick={() => setIsContactProfileOpen(true)} 
        />
      </header>

      {isBlocked ? (
        <div className="blocked-dialog-overlay">
          <p>Пользователь заблокирован</p>
          <button className="unblock-delete-btn" onClick={onBack}>
            Назад
          </button>
        </div>
      ) : (
        <>
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
                className={`message ${
                  message.type === 'sent'
                    ? 'sent'
                    : message.type === 'received'
                    ? 'received'
                    : 'system'
                }`}
              >
                {message.text}
              </div>
            ))}
            {!messages.length && !isLoadingMore && (
              <div className="message received">Привет!</div>
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
        </>
      )}
    </div>
  );
};

export default Chat;