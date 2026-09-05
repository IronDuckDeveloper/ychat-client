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
  Reply,
  Eye,
  EyeOff,
  ChevronUp,
} from 'lucide-react';
import '../styles/chat.scss';
import { useChatLogic } from '../hooks/useChatLogic.ts';
import { globalContactsDb } from '../lib/p2p/services/authService.ts';
import { getPeerRestrictionStatus } from '../lib/p2p/services/contactsService';
import ContactProfileDrawer from '../components/ContactProfileDrawer.tsx';
import Avatar from '../components/Avatar.tsx';
import MessageAttachment from '../components/MessageAttachment.tsx'; // 🔥 Импорт нового компонента
import SelectedFilePreview from '../components/SelectedFilePreview.tsx'; // 🔥 Превью файла перед отправкой
import ReplyPreview from '../components/ReplyPreview.tsx'; // 🔥 Цитата сообщения-ответа
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

const formatTime = (ts?: number) => {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const Chat = () => {
  const { id } = useParams();

  const [isBlocked, setIsBlocked] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [isContactProfileOpen, setIsContactProfileOpen] = useState(false);
  const [openTextMenuId, setOpenTextMenuId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  // 🔥 Подсветка сообщения при переходе по цитате ответа
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    if (!openTextMenuId) return;

    const close = () => {
      setOpenTextMenuId(null);
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
    handleFileSelect,
    selectedFile,
    removeSelectedFile,
    replyingTo,
    handleReplyToMessage,
    cancelReply,
    dialogConfig,
    closeDialog,
    handleDownloadMessageText,
    isHiddenMode,
    toggleHiddenMode,
  } = useChatLogic();

  const [expandedHiddenIds, setExpandedHiddenIds] = useState<Set<string>>(
    new Set(),
  );

  const toggleHiddenExpand = (id: string) => {
    setExpandedHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 🔥 Переход к сообщению-оригиналу по клику на цитату ответа.
  // Работает, только если оригинал уже подгружен в текущий чанк истории.
  const scrollToMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedId(messageId);
    window.setTimeout(() => {
      setHighlightedId((prev) => (prev === messageId ? null : prev));
    }, 1200);
  };

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

  // Вспомогательная функция для распознавания и рендеринга ссылок в тексте
  const renderMessageText = (text: string) => {
    if (!text) return null;

    // Регулярное выражение для поиска веб-ссылок (http, https, www)
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      const isUrl = /^https?:\/\/|^www\./i.test(part);

      if (isUrl) {
        // Отделяем знаки препинания в конце ссылки (например, "https://example.com.")
        const match = part.match(/^(.*?)([.?!,)]*)$/);
        const cleanUrl = match ? match[1] : part;
        const trailingPunctuation = match ? match[2] : '';

        const href = cleanUrl.toLowerCase().startsWith('www.')
          ? `https://${cleanUrl}`
          : cleanUrl;

        return (
          <React.Fragment key={index}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="chat-message-link"
              onClick={(e) => e.stopPropagation()} // Предотвращаем клик по контекстному меню сообщения
            >
              {cleanUrl}
            </a>
            {trailingPunctuation}
          </React.Fragment>
        );
      }

      return part;
    });
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
                  {/* 🔥 Общая обёртка сообщения и времени */}
                  <div
                    id={`msg-${message.id}`}
                    className={`message-wrapper ${
                      message.type === 'sent'
                        ? 'sent'
                        : message.type === 'received'
                          ? 'received'
                          : 'system'
                    } ${highlightedId === message.id ? 'highlighted' : ''}`}
                  >
                    {/* 1. БАББЛ СООБЩЕНИЯ */}
                    <div className="message">
                      {(() => {
                        const isDeleted =
                          message.text === CONFIG.MSG.MESSAGE_DELETED;
                        const isHiddenCollapsed =
                          message.hidden &&
                          !expandedHiddenIds.has(message.id) &&
                          !isDeleted;

                        return (
                          <>
                            {isHiddenCollapsed ? (
                              /* --- СВЕРНУТОЕ СОСТОЯНИЕ --- */
                              <>
                                <div
                                  className="hidden-message-collapsed"
                                  onClick={() => toggleHiddenExpand(message.id)}
                                >
                                  <span>{CONFIG.MSG.HIDDEN_MESSAGE_LABEL}</span>
                                  <ChevronUp
                                    size={16}
                                    className="hidden-message-arrow"
                                  />
                                </div>

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
                                          label: 'Удалить',
                                          icon: <Trash2 size={16} />,
                                          danger: true,
                                          onClick: () => {
                                            handleDeleteMessage(
                                              message.id,
                                              message.attachment?.cid,
                                              message.attachment?.serverCid,
                                              message.attachment?.serverRelays,
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
                              </>
                            ) : (
                              /* --- РАЗВЕРНУТОЕ СОСТОЯНИЕ --- */
                              <>
                                {message.replyTo && (
                                  <ReplyPreview
                                    replyTo={message.replyTo}
                                    variant="quote"
                                    onClick={() =>
                                      scrollToMessage(message.replyTo!.id)
                                    }
                                  />
                                )}

                                {message.attachment && (
                                  <MessageAttachment
                                    attachment={message.attachment}
                                    hidden={message.hidden && !isDeleted}
                                    onToggleCollapse={() => toggleHiddenExpand(message.id)}
                                    onReply={() => handleReplyToMessage(message)}
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

                                {message.text && (
                                  <>
                                    <div className="text-content">
                                      {renderMessageText(message.text)}

                                      {message.hidden &&
                                        !isDeleted &&
                                        !message.attachment && (
                                          <button
                                            type="button"
                                            className="hidden-message-collapse-btn"
                                            title="Свернуть"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleHiddenExpand(message.id);
                                            }}
                                          >
                                            <ChevronUp
                                              size={16}
                                              className="hidden-message-arrow expanded"
                                            />
                                          </button>
                                        )}
                                    </div>

                                    {!isDeleted && !message.attachment && (
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
                                                label: 'Ответить',
                                                icon: <Reply size={16} />,
                                                onClick: () => {
                                                  handleReplyToMessage(message);
                                                  setOpenTextMenuId(null);
                                                  setMenuAnchor(null);
                                                },
                                              },
                                              {
                                                label: 'Скачать',
                                                icon: <Download size={16} />,
                                                onClick: () => {
                                                  handleDownloadMessageText(
                                                    message.text,
                                                  );
                                                  setOpenTextMenuId(null);
                                                },
                                              },
                                              {
                                                label: 'Переслать',
                                                icon: <Forward size={16} />,
                                                onClick: () => {
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
                                                    message.attachment?.cid,
                                                    message.attachment?.serverCid,
                                                    message.attachment
                                                      ?.serverRelays,
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
                              </>
                            )}
                          </>
                        );
                      })()}
                    </div>

                  {/* 2. ВРЕМЯ (показываем, только если есть ts и сообщение НЕ удалено) */}
                  {message.ts && message.text !== CONFIG.MSG.MESSAGE_DELETED && (
                    <span className="message-time">
                      {formatTime(message.ts)}
                    </span>
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
              <div className="message system">Загрузка старых сообщений..</div>
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
              onChange={handleFileSelect}
            />

            {/* 🔥 Превью выбранного, но ещё не отправленного файла */}
            {selectedFile && (
              <SelectedFilePreview
                file={selectedFile}
                onRemove={removeSelectedFile}
                disabled={isUploadingFile}
              />
            )}

            {/* 🔥 Превью сообщения, на которое отвечаем */}
            {replyingTo && (
              <ReplyPreview
                replyTo={replyingTo}
                variant="composer"
                onRemove={cancelReply}
              />
            )}

            <div className="chat-input-row">
              <div className="input-container">
                {/* Скрепка пропадает, пока в превью лежит файл или готовится ответ */}
                {!selectedFile && !replyingTo && (
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
                )}

                <button
                  type="button"
                  className={`hidden-mode-button ${isHiddenMode ? 'active' : ''}`}
                  aria-label="Скрытое сообщение"
                  title={
                    isHiddenMode
                      ? 'Сообщение будет скрыто'
                      : 'Отправить как скрытое'
                  }
                  disabled={!isRoomReady || isUploadingFile}
                  onClick={toggleHiddenMode}
                >
                  {isHiddenMode ? <EyeOff size={20} /> : <Eye size={20} />}
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
                disabled={
                  !isRoomReady ||
                  isUploadingFile ||
                  (!draft.trim() && !selectedFile && !replyingTo)
                }
              >
                <Send size={20} />
              </button>
            </div>
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
