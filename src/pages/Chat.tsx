import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  Camera,
  Video,
  Mic,
} from 'lucide-react';
import '../styles/chat.scss';
import { useChatLogic } from '../hooks/useChatLogic.ts';
import { globalContactsDb } from '../lib/p2p/services/authService.ts';
import { getPeerRestrictionStatus } from '../lib/p2p/services/contactsService';
import ContactProfileDrawer from '../components/ContactProfileDrawer.tsx';
import Avatar from '../components/Avatar.tsx';
import MessageAttachment from '../components/MessageAttachment.tsx';
import SelectedFilePreview from '../components/SelectedFilePreview.tsx';
import ReplyPreview from '../components/ReplyPreview.tsx';
import ContextMenu from '../components/ContextMenu';
import { ConfirmModal } from '../components/ConfirmModal.tsx';
import { CONFIG } from '../lib/p2p/config.ts';
import CameraCaptureModal from '../components/CameraCaptureModal.tsx';
import VideoCaptureModal from '../components/VideoCaptureModal.tsx';
import AudioRecordModal from '../components/AudioRecordModal.tsx';

// Локаль для форматирования даты берётся из текущего языка i18n
const localeMap: Record<string, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  es: 'es-ES',
};

const formatDateSeparator = (ts: number, lang: string) => {
  const date = new Date(ts);
  const locale = localeMap[lang] || 'en-US';
  return date
    .toLocaleDateString(locale, {
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
  const { t, i18n } = useTranslation();
  const { id } = useParams();

  const [isBlocked, setIsBlocked] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [isContactProfileOpen, setIsContactProfileOpen] = useState(false);
  const [openTextMenuId, setOpenTextMenuId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
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
    cancelForward,
    forwardMessage,
    cameraInputRef,
    triggerCameraCapture,
    isCameraModalOpen,
    closeCameraModal,
    handleCameraCapture,
    videoInputRef,
    triggerVideoCapture,
    isVideoModalOpen,
    closeVideoModal,
    handleVideoCapture,
    audioInputRef,
    triggerAudioCapture,
    isAudioModalOpen,
    closeAudioModal,
    handleAudioCapture,
  } = useChatLogic();

  const [expandedHiddenIds, setExpandedHiddenIds] = useState<Set<string>>(
    new Set(),
  );

  const getForwardInfo = (messageToForward: any) => {
    const senderName =
      messageToForward.forwardedFrom?.senderName ||
      (messageToForward.type === 'sent'
        ? t('chat.you', { defaultValue: 'Я' })
        : contact?.nickname || displayName || t('chat.unknownContact'));

    return {
      ...messageToForward,
      senderName,
    };
  };

  const toggleHiddenExpand = (id: string) => {
    setExpandedHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const renderMessageText = (text: string) => {
    if (!text) return null;

    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      const isUrl = /^https?:\/\/|^www\./i.test(part);

      if (isUrl) {
        const match = part.match(/^(.*?)([.?!,)]*)$/);
        const cleanUrl = match ? match[1] : part;
        const trailingPunctuation = match ? match[2] : '';

        const href = cleanUrl.toLowerCase().startsWith('www.')
          ? `https://${cleanUrl}`
          : cleanUrl;

        return (
          <React.Fragment key={index}>
            
              <a href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="chat-message-link"
              onClick={(e) => e.stopPropagation()}
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
        nickname={contact?.nickname || displayName || t('chat.unknownContact')}
        bio={contact?.bio || ''}
        avatarUrl={avatarUrl}
      />

      <header className="chat-header">
        <div className="header-left">
          <button
            title={t('chat.back')}
            className="back-button"
            onClick={() => navigate('/contacts', { replace: true })}
          >
            <ArrowLeft className="back-icon" size={20} />
          </button>
          <span className="contact-name">
            {contact?.nickname || displayName || t('chat.unknownContact')}
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
          <p>{t('chat.userBlocked')}</p>
          <button className="unblock-delete-btn" onClick={onBack}>
            {t('chat.back')}
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
              <div className="message system">{t('chat.loadingOlderMessages')}</div>
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
                    id={`msg-${message.id}`}
                    className={`message-wrapper ${
                      message.type === 'sent'
                        ? 'sent'
                        : message.type === 'received'
                          ? 'received'
                          : 'system'
                    } ${highlightedId === message.id ? 'highlighted' : ''}`}
                  >
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
                              <>
                                <div
                                  className="hidden-message-collapsed"
                                  onClick={() => toggleHiddenExpand(message.id)}
                                >
                                  <span>{t('chat.hiddenMessageLabel')}</span>
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
                                    title={t('chat.options')}
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
                                          label: t('chat.delete'),
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
                              <>
                                  {message.replyTo && !isDeleted && (
                                    <div className="reply-message-indicator">
                                      <span>{t('chat.replyingToLabel')}</span>
                                      <ReplyPreview
                                        replyTo={message.replyTo}
                                        variant="quote"
                                        onClick={() =>
                                          scrollToMessage(message.replyTo!.id)
                                        }
                                      />
                                    </div>
                                  )}

                                  {message.forwardedFrom && !isDeleted && (
                                    <div className="forwarded-message-indicator">
                                      <Forward size={14} className="forwarded-icon" />
                                      <span>
                                        {t('chat.forwardedFromLabel', {
                                          name: message.forwardedFrom.senderName,
                                        })}
                                      </span>
                                    </div>
                                  )}

                                {message.attachment && (
                                  <MessageAttachment
                                    attachment={message.attachment}
                                    hidden={message.hidden && !isDeleted}
                                    onToggleCollapse={() =>
                                      toggleHiddenExpand(message.id)
                                    }
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
                                    onForward={() => {
                                      navigate('/contacts', {
                                        state: {
                                          forwardMessage: getForwardInfo(message)
                                        },
                                      });
                                    }}
                                  />
                                )}

                                {message.text && (
                                  <div className="text-content">
                                    {message.text === CONFIG.MSG.MESSAGE_DELETED
                                      ? t('chat.messageDeletedLabel')
                                      : renderMessageText(message.text)}
                                  </div>
                                )}

                                {!isDeleted && !message.attachment && (
                                  <div
                                    className="message-menu-wrap"
                                    onClick={(e) => e.stopPropagation()}
                                  >

                                    {message.hidden &&
                                      !isDeleted &&
                                      !message.attachment && (
                                        <button
                                          type="button"
                                          className="hidden-message-collapse-btn"
                                          title={t('chat.collapse')}
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
                                      
                                    <button
                                      type="button"
                                      className="message-menu-btn"
                                      title={t('chat.options')}
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
                                            label: t('chat.reply'),
                                            icon: <Reply size={16} />,
                                            onClick: () => {
                                              handleReplyToMessage(message);
                                              setOpenTextMenuId(null);
                                              setMenuAnchor(null);
                                            },
                                          },
                                          ...(message.text
                                            ? [
                                                {
                                                  label: t('chat.download'),
                                                  icon: <Download size={16} />,
                                                  onClick: () => {
                                                    handleDownloadMessageText(
                                                      message.text,
                                                    );
                                                    setOpenTextMenuId(null);
                                                  },
                                                },
                                              ]
                                            : []),
                                          {
                                            label: t('chat.forward'),
                                            icon: <Forward size={16} />,
                                            onClick: () => {
                                              setOpenTextMenuId(null);
                                              setMenuAnchor(null);

                                              navigate('/contacts', {
                                                state: {
                                                  forwardMessage:
                                                    getForwardInfo(message),
                                                },
                                              });
                                            },
                                          },
                                          {
                                            label: t('chat.delete'),
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
                                )}
                              </>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {message.ts && message.text !== CONFIG.MSG.MESSAGE_DELETED && (
                      <span className="message-time">{formatTime(message.ts)}</span>
                    )}
                  </div>

                  {showDateSeparator && (
                    <div className="date-separator">
                      {formatDateSeparator(message.ts, i18n.language)}
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {!messages.length && !isLoadingMore && (
              <div className="message system">{t('chat.loadingOlderMessages')}</div>
            )}
          </div>

          <div className="chat-input-area">
            <input
              title={t('chat.selectFile')}
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept={acceptedFileTypes}
              onChange={handleFileSelect}
            />

            <input
              title={t('chat.takePhoto')}
              type="file"
              ref={cameraInputRef}
              style={{ display: 'none' }}
              accept="image/*"
              capture="environment"
              onChange={handleFileSelect}
            />

            <input
              title={t('chat.recordVideo')}
              type="file"
              ref={videoInputRef}
              style={{ display: 'none' }}
              accept="video/*"
              capture="environment"
              onChange={handleFileSelect}
            />

            <input
              title={t('chat.recordVoice')}
              type="file"
              ref={audioInputRef}
              style={{ display: 'none' }}
              accept="audio/*"
              capture="user"
              onChange={handleFileSelect}
            />

            {selectedFile && (
              <SelectedFilePreview
                file={selectedFile}
                onRemove={removeSelectedFile}
                disabled={isUploadingFile}
              />
            )}

            {replyingTo && (
              <ReplyPreview
                replyTo={replyingTo}
                title={t('chat.replyToTitle')}
                variant="composer"
                onRemove={cancelReply}
              />
            )}

            {forwardMessage && (
              <ReplyPreview
                replyTo={forwardMessage}
                title={t('chat.forwardedTitle')}
                variant="composer"
                onRemove={cancelForward}
              />
            )}

            <div className="chat-input-row">
              <div className="input-container">
                {!selectedFile && !replyingTo && !forwardMessage && (
                  <button
                    className="attachment-button"
                    aria-label={t('chat.attachFile')}
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
                  aria-label={t('chat.hiddenMessageLabel')}
                  title={
                    isHiddenMode
                      ? t('chat.hiddenActiveHint')
                      : t('chat.hiddenInactiveHint')
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
                        label: t('chat.photoVideo'),
                        icon: <ImageIcon size={16} />,
                        onClick: () => {
                          triggerFileInput('image');
                          setMenuAnchor(null);
                        },
                      },
                      {
                        label: t('chat.file'),
                        icon: <File size={16} />,
                        onClick: () => {
                          triggerFileInput('file');
                          setMenuAnchor(null);
                        },
                      },
                      {
                        label: t('chat.audio'),
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
                      ? t('chat.preparingFile')
                      : getInputPlaceholder()
                  }
                  disabled={!isRoomReady || isUploadingFile}
                />

                {!selectedFile && !replyingTo && !forwardMessage && (
                  <>
                    <button
                      type="button"
                      className="camera-button"
                      aria-label={t('chat.recordVideo')}
                      title={t('chat.recordVideo')}
                      disabled={!isRoomReady || isUploadingFile}
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerVideoCapture();
                      }}
                    >
                      <Video size={20} className="camera-icon" />
                    </button>

                    <button
                      type="button"
                      className="camera-button"
                      aria-label={t('chat.takePhoto')}
                      title={t('chat.takePhoto')}
                      disabled={!isRoomReady || isUploadingFile}
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerCameraCapture();
                      }}
                    >
                      <Camera size={20} className="camera-icon" />
                    </button>

                        <button
                          type="button"
                          className="camera-button"
                          aria-label={t('chat.recordVoice')}
                          title={t('chat.recordVoice')}
                          disabled={!isRoomReady || isUploadingFile}
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerAudioCapture();
                          }}
                        >
                          <Mic size={20} className="camera-icon" />
                        </button>
                  </>
                )}
              </div>
              <button
                className="send-button"
                aria-label={t('chat.sendMessage')}
                onClick={handleSendMessage}
                disabled={
                  !isRoomReady ||
                  isUploadingFile ||
                  (!draft.trim() && !selectedFile && !forwardMessage)
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

      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={closeCameraModal}
        onCapture={handleCameraCapture}
      />

      <VideoCaptureModal
        isOpen={isVideoModalOpen}
        onClose={closeVideoModal}
        onCapture={handleVideoCapture}
      />

      <AudioRecordModal
        isOpen={isAudioModalOpen}
        onClose={closeAudioModal}
        onCapture={handleAudioCapture}
      />
    </div>
  );
};

export default Chat;