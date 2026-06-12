import { User, Camera, Edit2, Check, X, Info, LogOut, Upload, MonitorPlay } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
// import { globalHelia, globalOrbitDB, globalProfileDb, globalContactsDb } from '../lib/p2p/services/authService.ts';

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  nickname: string;
  bio: string;
  avatarUrl: string | null; // <-- Добавили пропс для текущей картинки
  onSave: (newNickname: string, newBio: string, newAvatarFile: Blob | null) => Promise<void> | void;
  onLogout?: () => void;
}

// export const wipeP2PDataAndReload = async () => {
//   const confirm = window.confirm(
//     "Это удалит локальный кэш файлов и контактов. Приложение перезагрузится, а данные скачаются из P2P сети заново. Ваш аккаунт не будет удален. Продолжить?"
//   );
  
//   if (!confirm) return;

//   try {
//     console.log('Останавливаем P2P ноды для разблокировки файлов...');
    
//     // 1. Аккуратно глушим базы и ноду, чтобы они отпустили локи в IndexedDB
//     if (globalProfileDb) await globalProfileDb.close();
//     if (globalContactsDb) await globalContactsDb.close();
//     if (globalOrbitDB) await globalOrbitDB.stop();
//     if (globalHelia) await globalHelia.stop();

//     // 2. Получаем список всех баз в браузере (IndexedDB)
//     const databases = await window.indexedDB.databases();

//     // 3. Удаляем их все (Local Storage при этом остается целым!)
//     const deletionPromises = databases.map(db => {
//       return new Promise((resolve) => {
//         if (!db.name) return resolve(true);
        
//         const req = window.indexedDB.deleteDatabase(db.name);
        
//         req.onsuccess = () => resolve(true);
//         req.onerror = () => {
//           console.warn(`Не удалось удалить БД: ${db.name}`);
//           resolve(false); 
//         };
//         req.onblocked = () => {
//           console.warn(`БД ${db.name} заблокирована. Пропускаем.`);
//           resolve(false);
//         };
//       });
//     });

//     await Promise.all(deletionPromises);
//     console.log('✅ Кэш очищен. Перезапускаем матрицу...');

//     // 4. Жесткая перезагрузка страницы
//     window.location.reload();
    
//   } catch (error) {
//     console.error('❌ Ошибка при сбросе кэша:', error);
//     alert('Не удалось полностью очистить кэш. Попробуйте перезагрузить страницу.');
//   }
// };

const ProfileDrawer = ({ isOpen, onClose, nickname, bio, avatarUrl, onSave, onLogout }: ProfileDrawerProps) => {
  const [isEditing, setIsEditing] = useState(false);
  
  const [editNickname, setEditNickname] = useState(nickname);
  const [editBio, setEditBio] = useState(bio);
  
  // Стейты для работы с аватаром
  const [draftAvatarUrl, setDraftAvatarUrl] = useState<string | null>(avatarUrl);
  const [draftAvatarBlob, setDraftAvatarBlob] = useState<Blob | null>(null);
  
  // Стейты камеры
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEditNickname(nickname);
      setEditBio(bio);
      setDraftAvatarUrl(avatarUrl);
      setDraftAvatarBlob(null);
      setIsEditing(false);
      setIsCameraActive(false);
    } else {
      stopCamera(); // Выключаем камеру при закрытии меню
    }
  }, [isOpen, nickname, bio, avatarUrl]);

  // --- ЛОГИКА ВЕБ-КАМЕРЫ ---
const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      
      // 1. Сначала говорим React показать интерфейс камеры (отрендерить тег <video>)
      setIsCameraActive(true); 

      // 2. Даем браузеру долю секунды, чтобы тег <video> появился в DOM, и привязываем поток
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 50);

    } catch (err) {
      console.error("Нет доступа к камере", err);
      alert("Не удалось получить доступ к камере.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

const takePhoto = () => {
  if (videoRef.current && canvasRef.current) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Делаем фото квадратным
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Вырезаем центр видео, чтобы фото не было сплюснутым
      const startX = (video.videoWidth - size) / 2;
      const startY = (video.videoHeight - size) / 2;
      
      ctx.drawImage(video, startX, startY, size, size, 0, 0, size, size);
      
      canvas.toBlob((blob) => {
        if (blob) {
          setDraftAvatarBlob(blob);
          setDraftAvatarUrl(URL.createObjectURL(blob));
          stopCamera();
        }
      }, 'image/jpeg', 0.8);
    }
  }
};

  // --- ЛОГИКА ФАЙЛА ---
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDraftAvatarBlob(file);
      setDraftAvatarUrl(URL.createObjectURL(file));
    }
  };

  const handleClose = () => {
    stopCamera();
    setIsEditing(false);
    onClose();
  };

  const handleCancelEdit = () => {
    stopCamera();
    setEditNickname(nickname);
    setEditBio(bio);
    setDraftAvatarUrl(avatarUrl);
    setDraftAvatarBlob(null);
    setIsEditing(false);
  };

  const handleSave = async () => {
    // Если blob не изменился, передаем null, чтобы сервис не делал лишнюю работу
    const blobToSave = draftAvatarBlob; 
    await onSave(editNickname, editBio, blobToSave);
    setIsEditing(false);
  };

    // Решаем, что показывать в кружочке профиля
    const displayUrl = isEditing ? draftAvatarUrl : avatarUrl;
        <button 
          className="close-btn" 
          onClick={handleCancelEdit}
          aria-label="Отменить редактирование"
          title="Отменить редактирование"
          ></button>
    return (
      <>
      <div className={`drawer-overlay ${isOpen ? 'open' : ''}`} onClick={handleClose}/>
      <div className={`profile-drawer ${isOpen ? 'open' : ''}`}>
        
        {isEditing ? (
          
          <button className="close-btn" 
          onClick={handleCancelEdit} 
          aria-label="Отменить редактирование" 
          title="Отменить редактирование">
            <X size={24} />
            </button>
        ) : (
          <button 
          className="close-btn" 
          onClick={handleClose} 
          aria-label="Закрыть" 
          title="Закрыть">
            <X size={24} />
          </button>
        )}

        <div className="drawer-top">
          <div className="avatar-container">
            {/* Скрытые элементы для обработки файлов и фото */}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileSelect}
              style={{ display: 'none' }} 
              placeholder="Выберите изображение"
              accept="image/*" 
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {isCameraActive ? (
              <div className="camera-view">
                <video ref={videoRef} autoPlay playsInline muted className="drawer-avatar-video" />
                <button className="snap-btn" onClick={takePhoto}>Снять</button>
              </div>
            ) : (
              <div className="drawer-avatar">
                {displayUrl ? (
                  <img src={displayUrl} alt="Avatar" className="user-avatar-image" />
                ) : (
                  <User size={64} className="user-icon" />
                )}
              </div>
            )}
            {/* Кнопка добавления фото */}
            {!isCameraActive && isEditing && (
              
                  <div className="avatar-edit-actions">
                    {/* Кнопка "Из файла" — слева */}
                    <button 
                      className="avatar-action-btn"
                      onClick={() => fileInputRef.current?.click()} 
                      title="Из файла"
                      aria-label="Загрузить из файла"
                    >
                      <Upload size={22} />
                    </button>

                    {/* Кнопка "С камеры" — справа */}
                    <button 
                      className="avatar-action-btn"
                      onClick={startCamera} 
                      title="С камеры"
                      aria-label="Сделать фото"
                    >
                      <MonitorPlay size={22} />
                    </button>
                  </div>
                )}
          </div>

          <div className="profile-info-container">
            {isEditing ? (
              <div className="drawer-inputs-group">
                {/* Никнейм */}
                <div className="drawer-input-wrapper">
                  <User size={18} className="drawer-input-icon" />
                  <input
                    type="text"
                    className="drawer-nickname-input"
                    value={editNickname}
                    onChange={(e) => setEditNickname(e.target.value)}
                    maxLength={32}
                    placeholder="Ваш никнейм"
                  />
                </div>
                
                {/* Био */}
                <div className="drawer-input-wrapper alignment-top">
                  <Info size={18} className="drawer-input-icon textarea-icon" />
                  <textarea
                    className="drawer-nickname-input bio-textarea"
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    maxLength={500}
                    placeholder="Расскажите о себе..."
                    rows={4}
                  />
                </div>
              </div>
            ) : (
              <div className="info-display">
                <h2 className="display-nickname">{nickname}</h2> {/* Показываем оригинальный пропс */}
                <p className="display-bio">{bio || 'Биография не заполнена'}</p> {/* Показываем оригинальный пропс */}
              </div>
            )}
          </div>
        </div>

        {/* Нижний блок с круглыми кнопками */}
        <div className="drawer-bottom">
          <button 
          className="round-action-btn logout-btn" 
          onClick={onLogout}
          aria-label="Выйти из аккаунта"
          title="Выйти из аккаунта"
          >
            <LogOut size={24} />
            </button>
          {isEditing ? (
            <button 
              className="round-action-btn save-btn" 
              onClick={handleSave}
              aria-label="Применить изменения"
              title="Применить изменения"
            >
              <Check size={24} />
            </button>
          ) : (
            <button 
              className="round-action-btn edit-btn" 
              onClick={() => setIsEditing(true)}
              aria-label="Редактировать профиль"
              title="Редактировать профиль"
            >
              <Edit2 size={24} />
            </button>
          )}
        </div>
      </div>
    </>
  );
};

export default ProfileDrawer;