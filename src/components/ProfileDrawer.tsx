import { User, Edit2, Check, X, Info, LogOut, Upload, MonitorPlay, ArrowLeftFromLine } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  nickname: string;
  bio: string;
  avatarUrl: string | null; 
  onSave: (newNickname: string, newBio: string, newAvatarFile: Blob | null) => Promise<void> | void;
  onLogout?: () => void;
  showToast: (message: string) => void; // 👈 Добавили функцию тоста в пропсы
}

const ProfileDrawer = ({ isOpen, onClose, nickname, bio, avatarUrl, onSave, onLogout, showToast }: ProfileDrawerProps) => {
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
      stopCamera(); 
    }
  }, [isOpen, nickname, bio, avatarUrl]);

  // --- ЛОГИКА ВЕБ-КАМЕРЫ ---
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      
      setIsCameraActive(true); 

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 50);

    } catch (err) {
      console.error("Нет доступа к камере", err);
      showToast("⚠️ Не удалось получить доступ к камере.");
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
      
      const size = Math.min(video.videoWidth, video.videoHeight);
      canvas.width = size;
      canvas.height = size;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
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
    const blobToSave = draftAvatarBlob; 
    await onSave(editNickname, editBio, blobToSave);
    setIsEditing(false);
  };

  const displayUrl = isEditing ? draftAvatarUrl : avatarUrl;

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
            <ArrowLeftFromLine size={24} />
          </button>
        )}

        <div className="drawer-top">
          <div className="avatar-container">
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
            
            {!isCameraActive && isEditing && (
              <div className="avatar-edit-actions">
                <button 
                  className="avatar-action-btn"
                  onClick={() => fileInputRef.current?.click()} 
                  title="Из файла"
                  aria-label="Загрузить из файла"
                >
                  <Upload size={22} />
                </button>

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
                <h2 className="display-nickname">{nickname}</h2>
                <p className="display-bio">{bio || 'Биография не заполнена'}</p>
              </div>
            )}
          </div>
        </div>

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