import { User, Settings, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ContactList = () => {
  const navigate = useNavigate();

  return (
    <div className="contacts-container">
      {/* Header */}
      <div className="contacts-header">
        <div className="header-left">
          <div className="avatar">
            <User size={24} />
          </div>
          <span className="font-bold">Egor Lachimov</span>
        </div>
        <button className="settings-button" aria-label="Settings">
          <Settings size={24} className="settings-icon" />
        </button>
      </div>

      {/* Search */}
      <div className="contacts-search">
        <div className="search-input-container">
          <Search size={18} className="search-icon" />
          <input
            placeholder="Поиск чатов..."
            className="bg-transparent outline-none w-full text-sm"
          />
        </div>
      </div>

      {/* List */}
      <div className="contacts-list">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="contact-item"
            onClick={() => navigate(`/chat/Пользователь ${i}`)}
          >
            <div className="contact-avatar">U{i}</div>
            <div className="contact-info">
              <div className="contact-name">Пользователь {i}</div>
              <div className="contact-last-message">
                Последнее сообщение из чата...
              </div>
            </div>
            <div className="contact-time">14:20</div>
          </div>
        ))}
      </div>
    </div>
  );
};

function Contacts() {
  return <ContactList />;
}

export default Contacts;
