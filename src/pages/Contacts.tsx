import jsQR from 'jsqr';
import { useState, useEffect, useRef, type MouseEvent } from 'react';
import { User, Search, Share2, Plus, Trash2, RefreshCcw, MoreVertical, Ban, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import ProfileDrawer from '../components/ProfileDrawer';
import ContactAvatar from '../components/ContactAvatar.tsx';

// Импортируем нашу логику
import { useContactsLogic } from '../hooks/useContactsLogic.ts';

const ContactList = () => {
  const {
    navigate,
    isLoading,
    dbInstance,
    isProfileOpen,
    setIsProfileOpen,
    myNickname,
    myBio,
    myAvatarUrl,
    peerId,
    contacts,
    handleRefreshContact,
    handleDeleteContact,
    handleSaveProfile,
    handleLogout,
    handleAdd, // Ваша функция добавления из хука
  } = useContactsLogic();

  // Состояния для меню контактов и хедера
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);

  // Состояния для Share-модалки, Add-модалки и тоста
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addPeerId, setAddPeerId] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Рефы для камеры в модалке добавления
  const addVideoRef = useRef<HTMLVideoElement>(null);
  const addStreamRef = useRef<MediaStream | null>(null);

  const addCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Закрытие ВСЕХ меню при клике вне их области
  useEffect(() => {
    const handleClickOutside = () => {
      setActiveMenuId(null);
      setIsHeaderMenuOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Управление камерой модалки добавления при её открытии/закрытии
  useEffect(() => {
    if (isAddModalOpen) {
      setAddPeerId('');
      startAddCamera();
    } else {
      stopAddCamera();
    }
    return () => stopAddCamera();
  }, [isAddModalOpen]);

  // Логика запуска камеры для добавления (facingMode: 'environment' для задней камеры)
  const startAddCamera = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'environment' } 
    });
    addStreamRef.current = stream;
    
    if (addVideoRef.current) {
      addVideoRef.current.srcObject = stream;
      // Как только видео начнет воспроизводиться, запускаем цикл сканирования
      addVideoRef.current.onloadedmetadata = () => {
        addVideoRef.current?.play();
        animationFrameRef.current = requestAnimationFrame(scanQRCode);
      };
    }
  } catch (err) {
    console.error("❌ [Camera] Нет доступа к камере для сканирования:", err);
  }
};

// Функция циклического анализа кадров
const scanQRCode = () => {
  const video = addVideoRef.current;
  
  // Создаем canvas в памяти, если еще не создали
  if (!addCanvasRef.current) {
    addCanvasRef.current = document.createElement('canvas');
  }
  const canvas = addCanvasRef.current;

  if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      // 1. Рисуем текущий кадр видео на canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // 2. Забираем массив пикселей
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // 3. Сканируем пиксели на наличие QR-кода
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });

      // 4. Если код найден — профит!
      if (code && code.data) {
        console.log("✅ [QR Scanner] Распознан код:", code.data);
        
        // Записываем распознанный Peer ID в инпут
        setAddPeerId(code.data);
        
        // Опционально: можно сразу автоматически вызывать onSubmitAddContact, 
        // но безопаснее просто подставить в инпут, чтобы юзер видел, что считалось, и нажал "Добавить"
        
        stopAddCamera(); // Останавливаем камеру, раз код уже считан
        return;
      }
    }
  }

  // Если код не найден, продолжаем сканировать следующий кадр
  if (isAddModalOpen && addStreamRef.current) {
    animationFrameRef.current = requestAnimationFrame(scanQRCode);
  }
};

// Не забываем подчищать за собой анимацию при остановке
const stopAddCamera = () => {
  if (animationFrameRef.current) {
    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }
  if (addStreamRef.current) {
    addStreamRef.current.getTracks().forEach(track => track.stop());
    addStreamRef.current = null;
  }
};

  const toggleContactMenu = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    setActiveMenuId(activeMenuId === id ? null : id);
  };

  const toggleHeaderMenu = (e: MouseEvent) => {
    e.stopPropagation();
    setIsHeaderMenuOpen(!isHeaderMenuOpen);
  };

  const handleCopyPeerId = async () => {
    if (!peerId) return;
    try {
      await navigator.clipboard.writeText(peerId);
      setToastMessage('Peer ID скопирован в буфер!');
    } catch (err) {
      setToastMessage('Ошибка при копировании');
    }
    setTimeout(() => setToastMessage(null), 3000);
  };

  const onSubmitAddContact = () => {
    if (!addPeerId.trim()) return;
    // Передаем введенный ID в вашу логику (подстройте под сигнатуру handleAdd, если нужно)
    handleAdd(addPeerId.trim()); 
    setIsAddModalOpen(false);
  };

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
        
        <div className="header-actions" onClick={(e) => e.stopPropagation()}>
          <button 
            className={`header-action-button ${isHeaderMenuOpen ? 'active' : ''}`}
            onClick={toggleHeaderMenu} 
            aria-label="Управление" 
            title="Управление"
          >
            <Share2 size={22} />
          </button>

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
          <input placeholder="Поиск чатов..." className="bg-transparent outline-none w-full text-sm" />
        </div>
      </div>

      <div className="contacts-list">
        {contacts.length === 0 ? (
          <div className="empty-state">
            Список контактов пуст.
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
                    <button onClick={(e) => { e.stopPropagation(); handleRefreshContact(e, contact.id); setActiveMenuId(null); }}>
                      <RefreshCcw size={16} /><span>Обновить</span>
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); console.log('Блокировка', contact.id); setActiveMenuId(null); }}>
                      <Ban size={16} /><span>Заблокировать</span>
                    </button>
                    <button className="delete-option" onClick={(e) => { e.stopPropagation(); handleDeleteContact(e, contact.id); setActiveMenuId(null); }}>
                      <Trash2 size={16} /><span>Удалить</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ========================================== */}
      {/* МОДАЛЬНОЕ ОКНО "РАСШАРИТЬ" */}
      {/* ========================================== */}
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

      {/* ========================================== */}
      {/* НОВОЕ МОДАЛЬНОЕ ОКНО "ДОБАВИТЬ КОНТАКТ" */}
      {/* ========================================== */}
      {isAddModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Закрыть" title="Закрыть" className="close-button" onClick={() => setIsAddModalOpen(false)}>
              <X size={20} />
            </button>
            
            <h3 className="modal-title">Добавить по Peer ID</h3>
            
            {/* Окно камеры вместо QR-кода */}
            <div className="modal-camera-wrapper">
              <video ref={addVideoRef} autoPlay playsInline muted className="modal-camera-video" />
            </div>

            {/* Группа инпута из ProfileDrawer */}
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

            {/* Кнопка действия снизу */}
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

      {/* ТОСТ */}
      {toastMessage && <div className="toast-notification">{toastMessage}</div>}
    </div>
  );
};

export default function Contacts() {
  return <ContactList />;
}