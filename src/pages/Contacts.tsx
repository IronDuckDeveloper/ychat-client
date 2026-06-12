import { User, Search, Share2, Plus, Trash2, RefreshCcw } from 'lucide-react';
import ProfileDrawer from '../components/ProfileDrawer';
import ContactAvatar from '../components/ContactAvatar.tsx';

// Импортируем нашу логику
import { useContactsLogic } from '../hooks/useContactsLogic.ts';

const ContactList = () => {
  // Достаем все данные и методы из хука
  const {
    navigate,
    isLoading,
    dbInstance,
    isProfileOpen,
    setIsProfileOpen,
    myNickname,
    myBio,
    myAvatarUrl,
    contacts,
    handleRefreshContact,
    handleDeleteContact,
    handleSaveProfile,
    handleLogout,
    handleShare,
    handleAdd
  } = useContactsLogic();

  // ==========================================
  // РЕНДЕР
  // ==========================================

  if (isLoading || !dbInstance) {
    return (
      <div className="contacts-container loading">
        <div className="loading-content">
          <div className="animate-spin spinner">⏳</div>
          <p>Синхронизация с P2P сетью...</p>
        </div>
      </div>
    );
  }

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
      />
      
      <div className="contacts-header">
        <div className="header-left">
          <div className="avatar" onClick={() => setIsProfileOpen(true)}>
            {myAvatarUrl ? <img src={myAvatarUrl} alt="Avatar" /> : <User size={24} />}
          </div>
          <span className="username">{myNickname}</span>
        </div>
        <div className="header-actions">
          <button className="header-action-button" onClick={handleShare} aria-label="Поделиться" title="Поделиться">
            <Share2 size={22} />
          </button>
          <button className="header-action-button" onClick={handleAdd} aria-label="Добавить" title="Добавить">
            <Plus size={22} />
          </button>
        </div>
      </div>

      <div className="contacts-search">
        <div className="search-input-container">
          <Search size={18} className="search-icon" />
          <input placeholder="Поиск чатов..." className="bg-transparent outline-none w-full text-sm" />
        </div>
      </div>

      <div className="contacts-list">
        {contacts.length === 0 ? (
          <div className="empty-state">
            Список контактов пуст.<br/>Нажми + чтобы добавить.
          </div>
        ) : (
          contacts.map((contact) => (
            <div
              key={contact.id}
              className="contact-item"
              onClick={() => navigate(`/chat/${contact.id}`, { 
                state: { contactName: contact.nickname || contact.id } 
              })}
            >
              <div className="contact-avatar">
                <ContactAvatar cid={contact.avatarCid} />
                {/* Выводим бейдж, только если есть непрочитанные */}
                {contact.unreadCount && contact.unreadCount > 0 ? (
                  <span className="unread-badge">{contact.unreadCount}</span>
                ) : null}
              </div>
              <div className="contact-info">
                <div className="contact-name">{contact.nickname}</div>
                <div className="contact-last-message">
                  {contact.lastMessage || 'Нет сообщений'}
                </div>
              </div>
              <div className="contact-time">
                {/* Вывод времени последнего сообщения */}
                {contact.lastMessageTime && (
                  <span className="contact-time">
                    {new Date(contact.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              </div>
              <button 
                onClick={(e) => handleRefreshContact(e, contact.id)}
                className="text-gray-400 hover:text-teal-500 transition-colors"
                title="Запросить обновление профиля"
              >
                <RefreshCcw size={16} />
              </button>
              <button 
                onClick={(e) => handleDeleteContact(e, contact.id)}
                className="text-gray-300 hover:text-red-500 transition-colors"
                title="Удалить контакт"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default function Contacts() {
  return <ContactList />;
}