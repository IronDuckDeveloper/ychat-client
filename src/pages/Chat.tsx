import { useState, useEffect } from 'react'; // 👈 Добавили импорт хуков
import { useParams } from 'react-router-dom';
import { ArrowLeft, Settings, Send, Paperclip } from 'lucide-react';
import '../styles/chat.scss';
import { useChatLogic } from '../hooks/useChatLogic.ts';
import { globalContactsDb } from '../lib/p2p/services/authService.ts';
import { isPeerBlocked } from '../lib/p2p/services/contactsService';

const Chat = () => {
  const { id } = useParams(); 
  
  // 👈 1. Создаем состояние для статуса блокировки (по умолчанию false)
  const [isBlocked, setIsBlocked] = useState(false);

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

  // 👈 2. Используем useEffect для асинхронной проверки при открытии чата
  useEffect(() => {
    const checkBlockStatus = async () => {
      if (!id || !globalContactsDb) return;
      
      const blockedStatus = await isPeerBlocked(globalContactsDb, id);
      setIsBlocked(blockedStatus); // Сохраняем результат в стейт

      if (blockedStatus) {
        console.warn(`🚫 Доступ в чат ${id} ограничен: пользователь заблокирован.`);
        // Редирект мы отсюда убрали! Иначе юзер не увидит твою кнопку "Разблокировать и удалить"
      }
    };

    checkBlockStatus();
  }, [id]); // Эффект сработает каждый раз, когда меняется id в URL

  const onBack = async () => {
    if (id) {
      navigate('/contacts', { replace: true });
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="header-left">
          <button
            className="back-button"
            aria-label="Back"
            onClick={() => navigate('/contacts', { replace: true })}
          >
            <ArrowLeft size={24} className="back-icon" />
          </button>
          <div className="contact-name">{displayName || 'IPFS Chat'}</div>
        </div>
        <button className="settings-button" aria-label="Settings">
          <Settings size={22} className="settings-icon" />
        </button>
      </div>

      {/* 👈 3. Теперь React берет статус из стейта и решает, что показать */}
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