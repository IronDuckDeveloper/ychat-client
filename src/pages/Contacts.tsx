import { User, Search, Share2, Plus, Trash2, RefreshCcw, MoreVertical, Ban, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import ProfileDrawer from '../components/ProfileDrawer';
import ContactAvatar from '../components/ContactAvatar.tsx';
import { ConfirmModal } from '../components/ConfirmModal';
import { useContactsLogic } from '../hooks/useContactsLogic.ts';
import HeaderActionButton from '../components/HeaderActionButton.tsx';
import { useCallback, useRef, useEffect } from 'react';
import Avatar from '../components/Avatar.tsx';

const ContactList = () => {
  const {
    navigate, isLoading, isProfileOpen, setIsProfileOpen,
    myNickname, myBio, myAvatarUrl, myPrivacy, peerId, contacts, filteredContacts, dialogConfig, 
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

  const { syncContactInQueue, /* другие методы */ } = useContactsLogic();
  
  // --- ОЧЕРЕДЬ ДЛЯ ЗАГРУЗКИ КОНТАКТОВ ---
  const observer = useRef<IntersectionObserver | null>(null);
  // Храним связь: DOM-элемент -> данные контакта
  const elementsMap = useRef(new Map<Element, any>());
  // Хранит таймеры для каждого элемента на экране
  const scrollTimers = useRef(new Map<Element, NodeJS.Timeout>());
  
  // 1. Создаем обсервер ОДИН РАЗ при монтировании
  useEffect(() => {
    observer.current = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const target = entry.target;
        const contact = elementsMap.current.get(target);

        if (entry.isIntersecting) {
          // 1. Контакт появился на экране. 
          // Не бежим сразу в базу! Запускаем таймер на 500 мс.
          if (contact && contact.id) {
            const timer = setTimeout(() => {
              console.log(`⏱️ [Smart Render] ${contact.nickname} задержался на экране. Добавляем в очередь.`);
              syncContactInQueue(contact);
              // Очищаем отработавший таймер
              scrollTimers.current.delete(target); 
            }, 500); // <-- Те самые 500 мс задержки
            
            // Сохраняем таймер, привязанный к DOM-элементу
            scrollTimers.current.set(target, timer);
          }
        } else {
          // 2. Контакт ушел с экрана.
          // Если таймер еще тикает (прошло меньше 500 мс), убиваем его!
          if (scrollTimers.current.has(target)) {
            clearTimeout(scrollTimers.current.get(target)!);
            scrollTimers.current.delete(target);
            // Раскомментируй для дебага, чтобы увидеть, как отсекается мусор:
            // console.log(`💨 [Smart Render] Фаст-скролл! Отменили синк для: ${contact?.nickname}`);
          }
        }
      });
    }, { threshold: 0.1 });

    return () => {
      if (observer.current) observer.current.disconnect();
      
      // Очищаем все таймеры при размонтировании компонента
      scrollTimers.current.forEach(timer => clearTimeout(timer));
      scrollTimers.current.clear();
      elementsMap.current.clear();
    };
  }, [syncContactInQueue]);

// 2. Эта функция просто привязывает элемент к обсерверу
const contactRef = useCallback((node: HTMLDivElement | null, contact: any) => {
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
          {/*  Аватар собеседника */}
          <Avatar 
            url={myAvatarUrl} 
            size={24}
            onClick={() => !isLoading && setIsProfileOpen(true)} 
          />
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
              // Привязываем реф к каждому элементу
              ref={(el) => contactRef(el, contact)}
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