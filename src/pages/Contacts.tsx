import { User, Search, Share2, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { globalProfileDb, onDbReady, globalHelia } from '../lib/p2p/services/authService.ts';
import { isAuthenticated } from '../lib/p2p/crypto/crypto.ts';
import { CONFIG } from '../lib/p2p/config.ts';
import ProfileDrawer from '../components/ProfileDrawer';
import { uploadAvatarToHelia, fetchAvatarFromHelia } from '../lib/p2p/services/avatarService';

const ContactList = () => {
  const navigate = useNavigate();
  const [myNickname, setMyNickname] = useState<string>('Загрузка...');
  const [dbInstance, setDbInstance] = useState<any>(globalProfileDb);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);   // Состояние для управления боковым меню
  const [myBio, setMyBio] = useState<string>(''); // Добавляем стейт для Bio
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);

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
        const name = await db.get(CONFIG.PROFILE.KEY_NICKNAME);
        const bio = await db.get(CONFIG.PROFILE.KEY_BIO);
        const avatarCID = await db.get(CONFIG.PROFILE.KEY_AVATAR_CID);
        const created = await db.get(CONFIG.PROFILE.KEY_DATE_CREATED);
        const updated = await db.get(CONFIG.PROFILE.KEY_LAST_UPDATED);
        
        setMyNickname(name || 'Аноним');
        setMyBio(bio || '');

        // Если есть CID, достаем файл из сети (Helia)
        // Используем globalHelia вместо db.ipfs
        if (avatarCID && globalHelia) { 
          console.log('🔄 Грузим аватар по CID:', avatarCID);
          const url = await fetchAvatarFromHelia(globalHelia, avatarCID);
          setMyAvatarUrl(url);
        }

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
  const handleSaveProfile = async (newNickname: string, newBio: string, newAvatarBlob: Blob | null) => {
    if (!dbInstance) return;
    
    try {
      const timestamp = Date.now();

      // 1. Пишем в P2P базу данных
      await dbInstance.put(CONFIG.PROFILE.KEY_NICKNAME, newNickname);
      await dbInstance.put(CONFIG.PROFILE.KEY_BIO, newBio);
      await dbInstance.put(CONFIG.PROFILE.KEY_LAST_UPDATED, timestamp);

      // Если пользователь выбрал новую картинку
      if (newAvatarBlob && globalHelia) {
        console.log('🚀 Начинаем загрузку аватара в Helia...');
        const cid = await uploadAvatarToHelia(globalHelia, newAvatarBlob);
        await dbInstance.put(CONFIG.PROFILE.KEY_AVATAR_CID, cid);
        
        const localUrl = URL.createObjectURL(newAvatarBlob);
        setMyAvatarUrl(localUrl);
        console.log('✅ Аватар успешно обновлен в UI и БД!');
      } else if (newAvatarBlob && !globalHelia) {
          console.error('❌ Ошибка: globalHelia не найден. Аватар не сохранен.');
      }
      
      // 2. Обновляем основной стейт экрана контактов только после успешной записи
      setMyNickname(newNickname);
      setMyBio(newBio);

      // ЗДЕСЬ ПОЗЖЕ БУДЕТ ШАГ 4: Отправка PubSub уведомления

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
        avatarUrl={myAvatarUrl} // <-- Передаем URL
        onSave={handleSaveProfile} // <-- Принимает 3 аргумента
        onLogout={handleLogout}
      />
      
      {/* Header */}
      <div className="contacts-header">
        <div className="header-left">
          <div className="avatar" onClick={() => setIsProfileOpen(true)}>
            {myAvatarUrl ? (
                <img 
                src={myAvatarUrl} 
                alt="Avatar" 
                />
            ) : (
                <User size={24} />
            )}
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