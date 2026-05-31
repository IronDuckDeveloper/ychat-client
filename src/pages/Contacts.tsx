import { User, Settings, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { globalProfileDb, onDbReady } from '../lib/p2p/services/authService.ts';
import { isAuthenticated } from '../lib/p2p/crypto/crypto.ts';
import { CONFIG } from '../lib/p2p/config.ts';

const ContactList = () => {
  const navigate = useNavigate();
  const [myNickname, setMyNickname] = useState<string>('Загрузка...');
  const [dbInstance, setDbInstance] = useState<any>(globalProfileDb);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 1. Проверка авторизации (токен/сид)
  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  // 2. Ожидание инициализации P2P-базы и загрузка профиля
  useEffect(() => {
    if (!isAuthenticated()) return;

    const loadProfile = async (db: any) => {
      try {
        const name = await db.get(CONFIG.KEY_NICKNAME);
        setMyNickname(name || 'Аноним');
      } catch (error) {
        console.error('Ошибка при чтении профиля:', error);
        setMyNickname('Ошибка');
      } finally {
        setIsLoading(false);
      }
    };

    // Если база уже готова на момент монтирования
    if (globalProfileDb) {
      setDbInstance(globalProfileDb);
      loadProfile(globalProfileDb);
    } else {
      // Если база еще создается, подписываемся на её готовность
      onDbReady(() => {
        setDbInstance(globalProfileDb);
        loadProfile(globalProfileDb);
      });
    }
  }, []);

  // Если сессия есть, но OrbitDB на бэкграунде еще запускается — висит лоадер
  if (isLoading || !dbInstance) {
    return (
      <div className="contacts-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center', color: '#666' }}>
          <div className="animate-spin" style={{ marginBottom: '10px', fontSize: '24px' }}>⏳</div>
          <p style={{ fontSize: '14px' }}>Синхронизация с P2P сетью...</p>
          <span style={{ fontSize: '11px', opacity: 0.6 }}>Это может занять некоторое время при первом запуске</span>
        </div>
      </div>
    );
  }

  return (
    <div className="contacts-container">
      {/* Header */}
      <div className="contacts-header">
        <div className="header-left">
          <div className="avatar">
            <User size={24} />
          </div>
          <span className="username">{myNickname}</span>
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
              <div className="contact-last-message">Последнее сообщение...</div>
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