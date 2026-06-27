import { User, Edit2, Check, X, Info, LogOut, Upload, Camera, ArrowLeftFromLine } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import HeaderActionButton from './HeaderActionButton.tsx';
import type { PrivacyType } from '../lib/p2p/config.ts';

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  nickname: string;
  bio: string;
  avatarUrl: string | null; 
  privacy: PrivacyType;
  onSave: (newNickname: string, newBio: string, newAvatarFile: Blob | null, newPrivacy: PrivacyType) => Promise<void> | void;
  onLogout: () => void;
  showToast: (message: string) => void;
}

const ProfileDrawer = ({ isOpen, onClose, nickname, bio, avatarUrl, privacy = 'public', onSave, onLogout, showToast }: ProfileDrawerProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editNickname, setEditNickname] = useState(nickname);
  const [editBio, setEditBio] = useState(bio);
  const [editPrivacy, setEditPrivacy] = useState<PrivacyType>(privacy);
  const [draftAvatarUrl, setDraftAvatarUrl] = useState<string | null>(avatarUrl);
  const [draftAvatarBlob, setDraftAvatarBlob] = useState<Blob | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEditNickname(nickname);
      setEditBio(bio);
      setEditPrivacy(privacy);
      setDraftAvatarUrl(avatarUrl);
      setDraftAvatarBlob(null);
      setIsEditing(false);
      setIsCameraActive(false);
    } else {
      stopCamera(); 
    }
  }, [isOpen, nickname, bio, avatarUrl]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      setIsCameraActive(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 50);
    } catch (err) {
      showToast("⚠️ Не удалось получить доступ к камере.");
    }
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const size = Math.min(video.videoWidth, video.videoHeight);
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, size, size);
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDraftAvatarBlob(file);
      setDraftAvatarUrl(URL.createObjectURL(file));
    }
  };

  const handleCancelEdit = () => {
    stopCamera();
    setEditNickname(nickname);
    setEditBio(bio);
    setEditPrivacy(privacy);
    setDraftAvatarUrl(avatarUrl);
    setDraftAvatarBlob(null);
    setIsEditing(false);
  };

  const [privacyLabels] = useState({
    public: 'Все',
    contacts_only: 'Список контактов',
    private: 'Только ВЫ'
  });

  const handleSave = async () => {
    await onSave(editNickname, editBio, draftAvatarBlob, editPrivacy);
    setIsEditing(false);
  };

  const displayUrl = isEditing ? draftAvatarUrl : avatarUrl;

  return (
    <>
      <div className={`drawer-overlay ${isOpen ? 'open' : ''}`} onClick={onClose}/>
      <div className={`profile-drawer ${isOpen ? 'open' : ''}`}>
        
        {/* ВЕРХНЯЯ ПАНЕЛЬ (как в Contacts) */}
        <div className="drawer-header">
          <div className="header-left">
            {!isEditing && (
              <HeaderActionButton 
                onClick={onLogout} 
                icon={<LogOut size={20} />} 
                title="Выйти" 
                variant="logout" 
              />  
            )}
          </div>

<div className="header-actions">
            {!isEditing ? (
              <HeaderActionButton 
                onClick={() => setIsEditing(true)} 
                icon={<Edit2 size={20} />} 
                title="Редактировать" 
              />
            ) : (
              // Показываем кнопку "Сохранить" только если камера ВЫКЛЮЧЕНА
              !isCameraActive && (
                <HeaderActionButton 
                  onClick={handleSave} 
                  icon={<Check size={20} />} 
                  title="Сохранить" 
                />
              )
            )}
            
            {/* Умная кнопка "Закрыть" */}
            <HeaderActionButton 
              onClick={() => {
                if (isCameraActive) {
                  stopCamera(); // Если включена камера - просто вырубаем её, оставаясь в режиме редактирования
                } else if (isEditing) {
                  handleCancelEdit(); // Если просто редактируем - сбрасываем всё
                } else {
                  onClose(); // Если просто смотрим профиль - закрываем шторку
                }
              }} 
              icon={isEditing ? <X size={20} /> : <ArrowLeftFromLine size={20} />} 
              title={isCameraActive ? "Остановить камеру" : "Закрыть"} 
            />
          </div>
        </div>

        {/* ОСНОВНОЙ КОНТЕНТ */}
        <div className="drawer-content">

          {/* НАСТРОЙКА ПРИВАТНОСТИ ПРОФИЛЯ */}
          <div className="profile-privacy-badge">
            <span className="privacy-label">Кто видит профиль:</span>
            {isEditing ? (
              <select 
                title="Кто видит профиль"
                className="privacy-select"
                value={editPrivacy} 
                onChange={(e) => setEditPrivacy(e.target.value as PrivacyType)}
              >
                <option value="public">Все</option>
                <option value="contacts_only">Список контактов</option>
                <option value="private">Только ВЫ</option>
              </select>
            ) : (
              <span className="privacy-value">{privacyLabels[privacy] || 'Все'}</span>
            )}
          </div>

          {/* АВАТАРКА */}
          <div className="avatar-container">
            <input title='Био' type="file" ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} accept="image/*" />
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {isCameraActive ? (
              <div className="camera-view">
                <video ref={videoRef} autoPlay playsInline muted className="drawer-avatar-video" />
                <button className="snap-btn" onClick={takePhoto}>Снять</button>
              </div>
            ) : (
              <div className="drawer-avatar">
                {displayUrl ? <img src={displayUrl} alt="Avatar" className="user-avatar-image" /> : <User size={64} className="user-icon" />}
              </div>
            )}
            
            {!isCameraActive && isEditing && (
              <div className="avatar-edit-actions">
                <button title='Файл' className="avatar-action-btn" onClick={() => fileInputRef.current?.click()}><Upload size={22} /></button>
                <button title='Камера' className="avatar-action-btn" onClick={startCamera}><Camera size={22} /></button>
              </div>
            )}
          </div>

          <div className="profile-info-container">
            {isEditing ? (
              <div className="drawer-inputs-group">
                <div className="drawer-input-wrapper"><User size={18} className="drawer-input-icon" /><input type="text" className="drawer-nickname-input" value={editNickname} onChange={(e) => setEditNickname(e.target.value)} maxLength={32} placeholder="Ваш никнейм" /></div>
                <div className="drawer-input-wrapper alignment-top"><Info size={18} className="drawer-input-icon textarea-icon" /><textarea className="drawer-nickname-input bio-textarea" value={editBio} onChange={(e) => setEditBio(e.target.value)} maxLength={500} placeholder="Расскажите о себе..." rows={4} /></div>
              </div>
            ) : (
              <div className="info-display">
                <h2 className="display-nickname">{nickname}</h2>
                <p className="display-bio">{bio || 'Биография не заполнена'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ProfileDrawer;