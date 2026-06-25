import { User, Search, Share2, Plus, Trash2, RefreshCcw, MoreVertical, Ban, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import ProfileDrawer from '../components/ProfileDrawer';
import ContactAvatar from '../components/ContactAvatar.tsx';
import { ConfirmModal } from '../components/ConfirmModal';
import { useContactsLogic } from '../hooks/useContactsLogic.ts';
import HeaderActionButton from '../components/HeaderActionButton.tsx';

const ContactList = () => {
  const {
    navigate, isLoading, isProfileOpen, setIsProfileOpen,
    myNickname, myBio, myAvatarUrl, peerId, contacts, filteredContacts, dialogConfig, 
    toastMessage, showToast, isNetworkReady,
    
    // Стейты UI и поиска
    searchQuery, setSearchQuery,
    activeMenuId, setActiveMenuId,
    isHeaderMenuOpen, setIsHeaderMenuOpen,
    isShareModalOpen, setIsShareModalOpen,
    isAddModalOpen, setIsAddModalOpen,
    addPeerId, setAddPeerId,
    
    // Рефы и методы
    addVideoRef, closeDialog, toggleContactMenu, toggleHeaderMenu, 
    handleCopyPeerId, onSubmitAddContact, handleRefreshContact, 
    handleDeleteContact, handleSaveProfile, handleLogout, 
    handleBlockContact, handleUnblockAndRefresh,
  } = useContactsLogic();

  return (
    <div className="contacts-container">
      <ProfileDrawer 
        isOpen={isProfileOpen} 
        onClose={() => setIsProfileOpen(false)} 
        nickname={myNickname}
        bio={myBio}
        avatarUrl={myAvatarUrl}
        onSave={handleSaveProfile}
        onLogout={handleLogout}
        showToast={showToast}
      />
      
      <div className="contacts-header">
        <div className="header-left">
          <div className="avatar" onClick={() => !isLoading && setIsProfileOpen(true)}>
            {myAvatarUrl ? <img src={myAvatarUrl} alt="Avatar" /> : <User size={24} />}
          </div>
          <span className="username">{myNickname}</span>
        </div>
        
        <div className="header-actions" onClick={(e) => e.stopPropagation()}>
          <HeaderActionButton 
            onClick={toggleHeaderMenu}
            icon={<Share2 size={22} />} 
            title="Обменяться контактом" 
            disabled={isLoading}
          />

          {isHeaderMenuOpen && (
            <div className="header-context-menu">
              <button onClick={() => { setIsAddModalOpen(true); setIsHeaderMenuOpen(false); }}>
                <Plus size={16} />
                <span>Добавить</span>
              </button>
              <button onClick={() => { setIsShareModalOpen(true); setIsHeaderMenuOpen(false); }}>
                <Share2 size={16} />
                <span>Расшарить</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="contacts-search">
        <div className="search-input-container">
          <Search size={18} className="search-icon" />
          <input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск чатов..." 
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
          Синхронизация локальной базы...
        </div>
      ) : contacts.length === 0 ? (
        <div className="empty-state">
          Список контактов пуст.
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="empty-state">
          Ничего не найдено
        </div>
      ) : (
          filteredContacts.map((contact) => (
            <div
              key={contact.id}
              className={`contact-item ${contact.isBlocked ? 'blocked' : ''} ${activeMenuId === contact.id ? 'menu-open' : ''}`}
              onClick={(e) => {
                if (contact.isBlocked) {
                  e.preventDefault(); 
                  e.stopPropagation();
                  return;
                }
                navigate(`/chat/${contact.id}`, { 
                  state: { contactName: contact.nickname || contact.id, contact: contact } 
                });
              }}
            >
              <div className="contact-avatar">
                <ContactAvatar cid={contact.avatarCid} />
                {contact.unreadCount && contact.unreadCount > 0 ? (
                  <span className="unread-badge">
                    {contact.unreadCount > 9 ? '9+' : contact.unreadCount}
                  </span>
                ) : null}
              </div>
              <div className="contact-info">
                <div className="contact-name">{contact.nickname}</div>
                <div className="contact-last-message">
                  {contact.lastMessage || 'Нет сообщений'}
                </div>
              </div>
              <div className="contact-time">
                {contact.lastMessageTime && (
                  <span>
                    {new Date(contact.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              
              <div className="contact-actions" onClick={(e) => e.stopPropagation()}>
                <button 
                  className="menu-button"
                  onClick={(e) => toggleContactMenu(e, contact.id)}
                  title="Опции"
                >
                  <MoreVertical size={20} />
                </button>

                {activeMenuId === contact.id && (
                  <div className="context-menu">
                    {!contact.isBlocked ? (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); handleRefreshContact(e, contact.id); setActiveMenuId(null); }}>
                          <RefreshCcw size={16} /><span>Обновить профиль</span>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleBlockContact(e, contact.id); setActiveMenuId(null); }}>
                          <Ban size={16} /><span>Заблокировать</span>
                        </button>
                      </>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); handleUnblockAndRefresh(e, contact.id); setActiveMenuId(null); }}>
                        <RefreshCcw size={16} /><span>Разблокировать и обновить</span>
                      </button>
                    )}
                    <button className="delete-option" onClick={(e) => { e.stopPropagation(); handleDeleteContact(e, contact.id); setActiveMenuId(null); }}>
                      <Trash2 size={16} /><span>Удалить</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )
      }
      </div>

      {isShareModalOpen && (
        <div className="modal-overlay" onClick={() => setIsShareModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Закрыть" title="Закрыть" className="close-button" onClick={() => setIsShareModalOpen(false)}>
              <X size={20} />
            </button>
            <h3 className="modal-title">Поделиться профилем</h3>
            <div className="qr-wrapper" onClick={handleCopyPeerId} title="Нажми, чтобы скопировать">
              <QRCodeSVG value={peerId || 'Unknown Peer'} size={180} />
            </div>
            <div className="peer-info">
              <span className="peer-label">Ваш Peer ID:</span>
              <code className="peer-value">{peerId || 'Загрузка...'}</code>
            </div>
            <p className="modal-hint">Нажми на QR-код, чтобы скопировать ID</p>
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Закрыть" title="Закрыть" className="close-button" onClick={() => setIsAddModalOpen(false)}>
              <X size={20} />
            </button>
            
            <h3 className="modal-title">Добавить по Peer ID</h3>
            
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
                  placeholder="Введите Peer ID пользователя"
                />
              </div>
            </div>

            <button 
              className="modal-submit-btn" 
              onClick={onSubmitAddContact}
              disabled={!addPeerId.trim()}
            >
              Добавить
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