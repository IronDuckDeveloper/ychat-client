import { User, Search, Share2, Plus, Trash2, RefreshCcw, MoreVertical, Ban, X, Copy } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReplyPreview from '../components/ReplyPreview.tsx';
import type { ReplyInfo } from '../lib/p2p/services/roomService.ts';
import { QRCodeSVG } from 'qrcode.react';
import ProfileDrawer from '../components/ProfileDrawer';
import ContactAvatar from '../components/ContactAvatar.tsx';
import { ConfirmModal } from '../components/ConfirmModal';
import { useContactsLogic } from '../hooks/useContactsLogic.ts';
import HeaderActionButton from '../components/HeaderActionButton.tsx';
import { useCallback, useRef, useEffect, useState } from 'react';
import Avatar from '../components/Avatar.tsx';
import type { ContactItem } from '../lib/p2p/services/contactsService.ts';
import ContextMenu from '../components/ContextMenu';
import { CONFIG } from '../lib/p2p/config.ts';

const ContactList = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const forwardMessage = location.state?.forwardMessage as ReplyInfo | undefined;

  const dismissForwardMessage = () => {
    const { forwardMessage: _drop, ...rest } = (location.state as any) || {};
    navigate(location.pathname, { replace: true, state: rest });
  };

  const {
    navigate: navigateLogic, isLoading, isProfileOpen, setIsProfileOpen,
    myNickname, myBio, myAvatarUrl, myPrivacy, peerId, contacts, filteredContacts, dialogConfig, 
    toastMessage, showToast, isNetworkReady, handleCopyContactId,
    
    searchQuery, setSearchQuery,
    activeMenuId, setActiveMenuId,
    isHeaderMenuOpen, setIsHeaderMenuOpen,
    isShareModalOpen, setIsShareModalOpen,
    isAddModalOpen, setIsAddModalOpen,
    addPeerId, setAddPeerId,
    
    addVideoRef, closeDialog, toggleContactMenu, toggleHeaderMenu, 
    handleCopyPeerId, onSubmitAddContact, handleRefreshContact, 
    handleDeleteContact, handleSaveProfile, handleLogout, 
    handleBlockContact, handleUnblockAndRefresh, syncContactInQueue
  } = useContactsLogic();
  
  const observer = useRef<IntersectionObserver | null>(null);
  const elementsMap = useRef(new Map<Element, any>());
  const scrollTimers = useRef(new Map<Element, NodeJS.Timeout>());

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  
  useEffect(() => {
    observer.current = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const target = entry.target;
        const contact = elementsMap.current.get(target);

        if (entry.isIntersecting) {
          if (contact && contact.id) {
            const timer = setTimeout(() => {
              console.log(`⏱️ [Smart Render] ${contact.nickname} задержался на экране. Добавляем в очередь.`);
              syncContactInQueue(contact);
              scrollTimers.current.delete(target); 
            }, 2000);
            
            scrollTimers.current.set(target, timer);
          }
        } else {
          if (scrollTimers.current.has(target)) {
            clearTimeout(scrollTimers.current.get(target)!);
            scrollTimers.current.delete(target);
          }
        }
      });
    }, { threshold: 0.1 });

    return () => {
      if (observer.current) observer.current.disconnect();
      
      scrollTimers.current.forEach(timer => clearTimeout(timer));
      scrollTimers.current.clear();
      elementsMap.current.clear();
    };
  }, [syncContactInQueue]);

const contactRef = useCallback((node: HTMLDivElement | null, contact: ContactItem) => {
  if (node) {
    elementsMap.current.set(node, contact);
    if (observer.current) observer.current.observe(node);
  }
}, []);

  return (
    <div className="contacts-container">
      <ProfileDrawer 
        isOpen={isProfileOpen} 
        onClose={() => setIsProfileOpen(false)} 
        nickname={myNickname}
        bio={myBio}
        avatarUrl={myAvatarUrl}
        privacy={myPrivacy || 'public'}
        onSave={handleSaveProfile}
        onLogout={handleLogout}
        showToast={showToast}
      />
      
      <div className="contacts-header">
        <div className="header-left">
          <Avatar 
            url={myAvatarUrl} 
            size={24}
            onClick={() => !isLoading && setIsProfileOpen(true)} 
          />
          <span className="username">{myNickname}</span>
        </div>
        
        <div className="header-actions" onClick={(e) => 
          e.stopPropagation()}>
          <HeaderActionButton 
            onClick={(e) => {
              e.stopPropagation();
              if (isHeaderMenuOpen) {
                setIsHeaderMenuOpen(false);
                setMenuAnchor(null);
              } else {
                setIsHeaderMenuOpen(true);
                setMenuAnchor(e.currentTarget);
              }
            }}
            icon={<Share2 size={22} />} 
            title={t('contactsPage.shareContact')} 
            disabled={isLoading}
          />

          {isHeaderMenuOpen && (
            <ContextMenu
              className="header-context-menu"
              anchorEl={menuAnchor}
              items={[
                {
                  label: t('contactsPage.add'),
                  icon: <Plus size={16} />,
                  onClick: () => {
                    setIsAddModalOpen(true);
                    setIsHeaderMenuOpen(false);
                    setMenuAnchor(null);
                  },
                },
                {
                  label: t('contactsPage.share'),
                  icon: <Share2 size={16} />,
                  onClick: () => {
                    setIsShareModalOpen(true);
                    setIsHeaderMenuOpen(false);
                    setMenuAnchor(null);
                  },
                },
              ]}
            />
          )}
        </div>
      </div>

      <div className="contacts-search">
        <div className="search-input-container">
          <Search size={18} className="search-icon" />
          <input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('contactsPage.searchPlaceholder')} 
            className="bg-transparent outline-none w-full text-sm" 
            disabled={isLoading} 
          />
        </div>
      </div>

      <div className="contacts-list">
      {!isNetworkReady ? (
        <div className="empty-state">
          {/* Иконка "Нет сети" */}
        </div>
      ) : isLoading ? (
        <div className="empty-state">
          <div className="animate-spin" style={{ marginBottom: '8px' }}>⏳</div>
          {t('contactsPage.syncing')}
        </div>
      ) : contacts.length === 0 ? (
        <div className="empty-state">
          {t('contactsPage.emptyContacts')}
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="empty-state">
          {t('contactsPage.emptySearch')}
        </div>
      ) : (
          filteredContacts.map((contact) => (
            <div
              key={contact.id}
              ref={(el) => contactRef(el, contact)}
              className={`contact-item ${contact.isBlocked ? 'blocked' : ''} ${activeMenuId === contact.id ? 'menu-open' : ''}`}
              onClick={(e) => {
                if (contact.isBlocked) {
                  e.preventDefault(); 
                  e.stopPropagation();
                  return;
                }
                navigateLogic(`/chat/${contact.id}`, { 
                  state: { 
                    contactName: contact.nickname || contact.id, 
                    contact: contact,
                    forwardMessage: forwardMessage,
                  } 
                });
              }}
            >
              <div className="contact-avatar">
                <ContactAvatar cid={contact.avatarCid} serverCid={contact.avatarServerCid} encryptionKey={contact.avatarEncryptionKey} serverRelays={contact.serverRelays} />
                {contact.unreadCount && contact.unreadCount > 0 ? (
                  <span className="unread-badge">
                    {contact.unreadCount > 9 ? '9+' : contact.unreadCount}
                  </span>
                ) : null}
              </div>
              <div className="contact-info">
                <div className="contact-name">{contact.nickname}</div>
                <div className="contact-last-message">
                  {contact.lastMessage === CONFIG.MSG.MESSAGE_DELETED
                    ? t('chat.messageDeletedLabel')
                    : (contact.lastMessage || t('contactsPage.noMessages'))}
                </div>
              </div>
              <div className="contact-time">
                {contact.lastMessageTime && contact.lastMessage && contact.lastMessage !== CONFIG.MSG.MESSAGE_DELETED && (
                  <span>
                    {new Date(contact.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              
              <div className="contact-actions" onClick={(e) => e.stopPropagation()}>
                <button 
                  className="menu-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (activeMenuId === contact.id) {
                      setActiveMenuId(null);
                      setMenuAnchor(null);
                    } else {
                      setActiveMenuId(contact.id);
                      setMenuAnchor(e.currentTarget);
                    }
                  }}
                  title={t('contactsPage.options')}
                >
                  <MoreVertical size={20} />
                </button>

                {activeMenuId === contact.id && (
                  <ContextMenu
                    className="item-contact-context-menu"
                    anchorEl={menuAnchor}
                    items={[
                      ...(!contact.isBlocked
                        ? [
                            {
                              label: t('contactsPage.refreshProfile'),
                              icon: <RefreshCcw size={16} />,
                              onClick: (e: React.MouseEvent) => {
                                handleRefreshContact(e, contact.id);
                                setActiveMenuId(null);
                                setMenuAnchor(null);
                              },
                            },
                            {
                              label: t('contactsPage.block'),
                              icon: <Ban size={16} />,
                              onClick: (e: React.MouseEvent) => {
                                handleBlockContact(e, contact.id);
                                setActiveMenuId(null);
                                setMenuAnchor(null);
                              },
                            },
                          ]
                        : [
                            {
                              label: t('contactsPage.unblockAndRefresh'),
                              icon: <RefreshCcw size={16} />,
                              onClick: (e: React.MouseEvent) => {
                                handleUnblockAndRefresh(e, contact.id);
                                setActiveMenuId(null);
                                setMenuAnchor(null);
                              },
                            },
                          ]),
                      {
                        label: t('contactsPage.copyId'),
                        icon: <Copy size={16} />,
                        onClick: (e) => {
                          handleCopyContactId(e, contact.id);
                          setActiveMenuId(null);
                          setMenuAnchor(null);
                        },
                      },
                      {
                        label: t('contactsPage.delete'),
                        icon: <Trash2 size={16} />,
                        danger: true,
                        onClick: (e) => {
                          handleDeleteContact(e, contact.id);
                          setActiveMenuId(null);
                          setMenuAnchor(null);
                        },
                      },
                    ]}
                  />
                )}
              </div>
            </div>
          ))
        )
      }
      </div>

      {forwardMessage && (
        <div className="forward-preview-container">
          <ReplyPreview
            replyTo={forwardMessage}
            title={t('contactsPage.forwardedTitle')}
            variant="composer"
            onRemove={dismissForwardMessage}
          />
        </div>
      )}

      {isShareModalOpen && (
        <div className="modal-overlay" onClick={() => setIsShareModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button aria-label={t('contactsPage.close')} title={t('contactsPage.close')} className="close-button" onClick={() => setIsShareModalOpen(false)}>
              <X size={20} />
            </button>
            <h3 className="modal-title">{t('contactsPage.shareProfileTitle')}</h3>
            <div className="qr-wrapper" onClick={handleCopyPeerId} title={t('contactsPage.copyHint')}>
              <QRCodeSVG value={peerId || t('contactsPage.unknownPeer')} size={180} />
            </div>
            <div className="peer-info">
              <span className="peer-label">{t('contactsPage.yourPeerId')}</span>
              <code className="peer-value">{peerId || t('contactsPage.loading')}</code>
            </div>
            <p className="modal-hint">{t('contactsPage.qrHint')}</p>
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button aria-label={t('contactsPage.close')} title={t('contactsPage.close')} className="close-button" onClick={() => setIsAddModalOpen(false)}>
              <X size={20} />
            </button>
            
            <h3 className="modal-title">{t('contactsPage.addByPeerIdTitle')}</h3>
            
            <div className="modal-camera-wrapper">
              <video ref={addVideoRef} autoPlay playsInline muted className="modal-camera-video" />
            </div>

            <div className="modal-inputs-group">
              <div className="modal-input-wrapper">
                <User size={18} className="modal-input-icon" />
                <input
                  type="text"
                  className="modal-peer-input"
                  value={addPeerId}
                  onChange={(e) => setAddPeerId(e.target.value)}
                  placeholder={t('contactsPage.peerIdPlaceholder')}
                />
              </div>
            </div>

            <button 
              className="modal-submit-btn" 
              onClick={onSubmitAddContact}
              disabled={!addPeerId.trim()}
            >
              {t('contactsPage.add')}
            </button>
          </div>
        </div>
      )}

      {toastMessage && <div className="toast-notification">{toastMessage}</div>}

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

export default function Contacts() {
  return <ContactList />;
}