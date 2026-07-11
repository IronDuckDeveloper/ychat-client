import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Send, Paperclip, Image as ImageIcon, File, Music } from 'lucide-react';
import '../styles/chat.scss';
import { useChatLogic } from '../hooks/useChatLogic.ts';
import { globalContactsDb } from '../lib/p2p/services/authService.ts';
import { isPeerBlocked } from '../lib/p2p/services/contactsService';
import ContactProfileDrawer from '../components/ContactProfileDrawer.tsx';
import Avatar from '../components/Avatar.tsx';
import MessageAttachment from '../components/MessageAttachment.tsx'; // 🔥 Импорт нового компонента

// Вспомогательная функция для форматирования даты (например: "28 мая 2026")
const formatDateSeparator = (ts: number) => {
  const date = new Date(ts);
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).replace(' г.', '');
};

const Chat = () => {
  const { id } = useParams(); 
  
  const [isBlocked, setIsBlocked] = useState(false);
  const [isContactProfileOpen, setIsContactProfileOpen] = useState(false);

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
    handleInput,
    isAttachmentMenuOpen,
    toggleAttachmentMenu,
    
    // 🔥 Новые пропсы из хука бизнес-логики
    fileInputRef,
    isUploadingFile,
    acceptedFileTypes,
    triggerFileInput,
    handleFileUpload
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
      <ContactProfileDrawer 
        isOpen={isContactProfileOpen}
        onClose={() => setIsContactProfileOpen(false)}
        nickname={contact?.nickname || displayName || 'Неизвестный'}
        bio={contact?.bio || ''}
        avatarUrl={avatarUrl}
      />

      <header className="chat-header">
        <div className="header-left">
          <button title='Назад' className="back-button" onClick={() => navigate('/contacts', { replace: true })}>
            <ArrowLeft className="back-icon" size={20} />
          </button>
          <span className="contact-name">{contact?.nickname || displayName || 'Неизвестный'}</span>
        </div>

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

            {messages.map((message, index) => {
              const nextMessage = messages[index + 1];
              let showDateSeparator = false;
              
              if (!nextMessage) {
                showDateSeparator = true;
              } else {
                const currentDateStr = new Date(message.ts).toDateString();
                const nextDateStr = new Date(nextMessage.ts).toDateString();
                if (currentDateStr !== nextDateStr) {
                  showDateSeparator = true;
                }
              }

              return (
                <React.Fragment key={message.id}>
                  <div
                    className={`message ${
                      message.type === 'sent'
                        ? 'sent'
                        : message.type === 'received'
                        ? 'received'
                        : 'system'
                    }`}
                  >
                    {/* Текстовая нода сообщения (если есть) */}
                    {message.text && <div className="text-content">{message.text}</div>}
                    
                    {/* 🔥 Вложение файла (если прикреплено) */}
                    {message.attachment && (
                      <MessageAttachment attachment={message.attachment} />
                    )}
                  </div>
                  
                  {showDateSeparator && (
                    <div className="date-separator">
                      {formatDateSeparator(message.ts)}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            
            {!messages.length && !isLoadingMore && (
              <div className="message received">Привет!</div>
            )}
          </div>

          <div className="chat-input-area">
            {/* 🔥 Скрытый системный инпут для работы с файловой системой браузера */}
            <input 
              title='Выбрать файл'
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept={acceptedFileTypes}
              onChange={handleFileUpload}
            />

            <div className="input-container">
              <button
                className="attachment-button"
                aria-label="Attach file"
                disabled={!isRoomReady || isUploadingFile}
                onClick={toggleAttachmentMenu}
              >
                {/* Если идет процесс хэширования файла, заменяем скрепку на спиннер */}
                {isUploadingFile ? (
                  <div className="spinner-icon" style={{ width: '18px', height: '18px', border: '2px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Paperclip size={20} className="attachment-icon" />
                )}
              </button>

              {isAttachmentMenuOpen && (
                <div 
                  className="attachment-context-menu" 
                  onClick={(e) => e.stopPropagation()} 
                >
                  <button onClick={() => triggerFileInput('image')}>
                    <ImageIcon size={16} />
                    <span>Фото/Видео</span>
                  </button>
                  <button onClick={() => triggerFileInput('file')}>
                    <File size={16} />
                    <span>Файл</span>
                  </button>
                  <button onClick={() => triggerFileInput('audio')}>
                    <Music size={16} />
                    <span>Аудио</span>
                  </button>
                </div>
              )}

              <textarea
                value={draft}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={isUploadingFile ? 'Подготовка файла к отправке P2P...' : getInputPlaceholder()}
                disabled={!isRoomReady || isUploadingFile}
              />
            </div>
            <button
              className="send-button"
              aria-label="Send message"
              onClick={handleSendMessage}
              disabled={!isRoomReady || !draft.trim() || isUploadingFile}
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