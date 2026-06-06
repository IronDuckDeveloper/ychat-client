import { User, Search, Share2, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { globalProfileDb, onDbReady } from '../lib/p2p/services/authService.ts';
import { isAuthenticated } from '../lib/p2p/crypto/crypto.ts';
import { CONFIG } from '../lib/p2p/config.ts';
import ProfileDrawer from '../components/ProfileDrawer';

const ContactList = () => {
  const navigate = useNavigate();
  const [myNickname, setMyNickname] = useState<string>('Загрузка...');
  const [dbInstance, setDbInstance] = useState<any>(globalProfileDb);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);   // Состояние для управления боковым меню
  const [myBio, setMyBio] = useState<string>(''); // Добавляем стейт для Bio


  // 1. Проверка авторизации (токен/сид)
  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  // Блокировка перехода "Назад"
  useEffect(() => {
    // Добавляем текущую страницу в историю браузера искусственно.
    window.history.pushState(null, '', window.location.href);

    const handlePopState = () => {
      // Когда пользователь нажимает "Назад" (или делает свайп), 
      // мы снова пушим текущий URL, никуда его не отпуская.
      window.history.pushState(null, '', window.location.href);
    };

    window.addEventListener('popstate', handlePopState);

    // Подчищаем слушатель при размонтировании (уходе в чат)
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

// Загрузка профиля из базы
  useEffect(() => {
    if (!isAuthenticated()) return;

    const loadProfile = async (db: any) => {
      try {
        const name = await db.get(CONFIG.KEY_NICKNAME);
        // Предположим, у тебя в CONFIG есть ключ для био, например KEY_BIO. Если нет — подставь свою строку.
        const bio = await db.get('user_bio'); 
        
        setMyNickname(name || 'Аноним');
        setMyBio(bio || '');
      } catch (error) {
        console.error('Ошибка при чтении профиля:', error);
        setMyNickname('Ошибка');
      } finally {
        setIsLoading(false);
      }
    };

    if (globalProfileDb) {
      setDbInstance(globalProfileDb);
      loadProfile(globalProfileDb);
    } else {
      onDbReady(() => {
        setDbInstance(globalProfileDb);
        loadProfile(globalProfileDb);
      });
    }
  }, []);

  // Функция сохранения, которая вызывается СТРОГО при нажатии галочки «Применить»
  const handleSaveProfile = async (newNickname: string, newBio: string) => {
    if (!dbInstance) return;
    
    try {
      // 1. Пишем в P2P базу данных
      await dbInstance.put(CONFIG.KEY_NICKNAME, newNickname);
      await dbInstance.put('user_bio', newBio);
      
      // 2. Обновляем основной стейт экрана контактов только после успешной записи
      setMyNickname(newNickname);
      setMyBio(newBio);
    } catch (error) {
      console.error('Не удалось сохранить профиль в P2P:', error);
    }
  };

  const handleLogout = () => {
    // Твоя логика очистки сессии/сид-фразы
    localStorage.clear();
    navigate('/', { replace: true });
  };

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
      {/* Подключаем боковое меню */}
      <ProfileDrawer 
        isOpen={isProfileOpen} 
        onClose={() => setIsProfileOpen(false)} 
        nickname={myNickname}
        bio={myBio}
        onSave={handleSaveProfile}
        onLogout={handleLogout}
      />
      {/* Header */}
      <div className="contacts-header">
        <div className="header-left">
          {/* Контейнер аватара, который мы стилизовали */}
          <div className="avatar" onClick={() => setIsProfileOpen(true)}>
            {/* Иконка, размер 24 хорошо подходит в контейнер 48px */}
            <User size={24} />
              </div>
            <span className="username">{myNickname}</span>
          </div>
          {/* Кнопки внутри контейнера actions */}
          <div className="header-actions">
            <button className="header-action-button" aria-label="Поделиться" title="Поделиться">
              <Share2 size={22} />
            </button>
            <button className="header-action-button" aria-label="Добавить" title="Добавить">
              <Plus size={22} />
            </button>
          </div>
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