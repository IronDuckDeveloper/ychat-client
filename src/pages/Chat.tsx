import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Send,
  Paperclip,
  Image as ImageIcon,
  File,
  Music,
  MoreVertical,
  Download,
  Forward,
  Trash2,
} from 'lucide-react';
import '../styles/chat.scss';
import { useChatLogic } from '../hooks/useChatLogic.ts';
import { globalContactsDb } from '../lib/p2p/services/authService.ts';
import { getPeerRestrictionStatus } from '../lib/p2p/services/contactsService';
import ContactProfileDrawer from '../components/ContactProfileDrawer.tsx';
import Avatar from '../components/Avatar.tsx';
import MessageAttachment from '../components/MessageAttachment.tsx'; // 🔥 Импорт нового компонента
import ContextMenu from '../components/ContextMenu';
import { ConfirmModal } from '../components/ConfirmModal.tsx';
import { CONFIG } from '../lib/p2p/config.ts';

// Вспомогательная функция для форматирования даты (например: "28 мая 2026")
const formatDateSeparator = (ts: number) => {
  const date = new Date(ts);
  return date
    .toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    .replace(' г.', '');
};

const Chat = () => {
  const { id } = useParams();

  const [isBlocked, setIsBlocked] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [isContactProfileOpen, setIsContactProfileOpen] = useState(false);
  const [openTextMenuId, setOpenTextMenuId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!openTextMenuId) return;

    const close = () => {
      setOpenTextMenuId(null)
      setMenuAnchor(null);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openTextMenuId]);

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
    handleDeleteMessage,
    fileInputRef,
    isUploadingFile,
    acceptedFileTypes,
    triggerFileInput,
    handleFileUpload,
    dialogConfig,
    closeDialog,
    handleDownloadMessageText,
  } = useChatLogic();

  useEffect(() => {
    if (!isAttachmentMenuOpen) {
      setMenuAnchor(null);
    }
  }, [isAttachmentMenuOpen]);

  useEffect(() => {
    const checkAccessStatus = async () => {
      if (!id || !globalContactsDb) return;

      const { isBlocked: blocked, isDeleted: deleted } =
        await getPeerRestrictionStatus(globalContactsDb, id);

      setIsBlocked(blocked);
      setIsDeleted(deleted);

      if (blocked || deleted) {
        console.warn(
          `🚫 Доступ в чат ${id} ограничен: ${blocked ? 'заблокирован' : 'удален'}.`,
        );
      }
    };

    checkAccessStatus();
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
          <button
            title="Назад"
            className="back-button"
            onClick={() => navigate('/contacts', { replace: true })}
          >
            <ArrowLeft className="back-icon" size={20} />
          </button>
          <span className="contact-name">
            {contact?.nickname || displayName || 'Неизвестный'}
          </span>
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
                    {message.text && (
                    <>
                      <div className="text-content">{message.text}</div>

                    {message.text !== CONFIG.MSG.MESSAGE_DELETED && (
                      <div
                        className="message-menu-wrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="message-menu-btn"
                          title="Опции"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (openTextMenuId === message.id) {
                              setOpenTextMenuId(null);
                              setMenuAnchor(null);
                            } else {
                              setOpenTextMenuId(message.id);
                              setMenuAnchor(e.currentTarget);
                            }
                          }}
                        >
                          <MoreVertical size={14} />
                        </button>

                        {openTextMenuId === message.id && (
                          <ContextMenu
                            className="attachment-item-menu"
                            anchorEl={menuAnchor}
                            items={[
                              {
                                label: 'Скачать',
                                icon: <Download size={16} />,
                                onClick: () => {
                                  handleDownloadMessageText(message.text);
                                  setOpenTextMenuId(null);
                                },
                              },
                              {
                                label: 'Переслать',
                                icon: <Forward size={16} />,
                                onClick: () => {
                                  // TODO: логика пересылки
                                  console.log('Переслать', message.id);
                                  setOpenTextMenuId(null);
                                  setMenuAnchor(null);
                                },
                              },
                              {
                                label: 'Удалить',
                                icon: <Trash2 size={16} />,
                                danger: true,
                                onClick: () => {
                                  handleDeleteMessage(
                                    message.id,
                                    undefined,
                                    undefined,
                                    undefined,
                                    message.type === 'sent',
                                  );
                                  setOpenTextMenuId(null);
                                  setMenuAnchor(null);
                                },
                              },
                            ]}
                          />
                        )}
                      </div>
                    )}
                    </>
                  )}

                    {/* Вложение файла (если прикреплено) */}
                    {message.attachment && (
                      <MessageAttachment
                        attachment={message.attachment}
                        // Передаем и ID, и CID
                        onDelete={() =>
                          handleDeleteMessage(
                            message.id,
                            message.attachment?.cid,
                            message.attachment?.serverCid,
                            message.attachment?.serverRelays,
                            message.type === 'sent',
                          )
                        }
                      />
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
              title="Выбрать файл"
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
                onClick={(e) => {
                  e.stopPropagation();
                  if (isAttachmentMenuOpen) {
                    setMenuAnchor(null);
                  } else {
                    setMenuAnchor(e.currentTarget);
                  }
                  toggleAttachmentMenu(e);
                }}
              >
                {/* Если идет процесс хэширования файла, заменяем скрепку на спиннер */}
                {isUploadingFile ? (
                  <div
                    className="spinner-icon"
                    style={{
                      width: '18px',
                      height: '18px',
                      border: '2px solid #e2e8f0',
                      borderTopColor: '#3b82f6',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }}
                  />
                ) : (
                  <Paperclip size={20} className="attachment-icon" />
                )}
              </button>

              {isAttachmentMenuOpen && (
                <ContextMenu
                  className="attachment-chat-context-menu"
                  onClick={(e) => e.stopPropagation()}
                  anchorEl={menuAnchor}
                  items={[
                    {
                      label: 'Фото/Видео',
                      icon: <ImageIcon size={16} />,
                      onClick: () => {
                        triggerFileInput('image');
                        setMenuAnchor(null);
                      },
                    },
                    {
                      label: 'Файл',
                      icon: <File size={16} />,
                      onClick: () => {
                        triggerFileInput('file');
                        setMenuAnchor(null);
                      },
                    },
                    {
                      label: 'Аудио',
                      icon: <Music size={16} />,
                      onClick: () => {
                        triggerFileInput('audio');
                        setMenuAnchor(null);
                      },
                    },
                  ]}
                />
              )}

              <textarea
                value={draft}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={
                  isUploadingFile
                    ? 'Подготовка файла к отправке P2P...'
                    : getInputPlaceholder()
                }
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
      <ConfirmModal
        isOpen={dialogConfig.isOpen}
        title={dialogConfig.title}
        message={dialogConfig.message}
        confirmText={dialogConfig.confirmText}
        isDanger={dialogConfig.isDanger}
        onConfirm={dialogConfig.onConfirm}
        onCancel={closeDialog}
      />
    </div>
  );
};

export default Chat;
