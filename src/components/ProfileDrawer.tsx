import { User, Camera, Edit2, Check, X, Info, LogOut } from 'lucide-react';
import { useState, useEffect } from 'react';

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  nickname: string;
  bio: string;
  onSave: (newNickname: string, newBio: string) => Promise<void> | void;
  onLogout?: () => void;
}

const ProfileDrawer = ({ isOpen, onClose, nickname, bio, onSave, onLogout }: ProfileDrawerProps) => {
  const [isEditing, setIsEditing] = useState(false);
  
  // Локальный стейт для полей ввода (черновик)
  const [editNickname, setEditNickname] = useState(nickname);
  const [editBio, setEditBio] = useState(bio);

  // Синхронизируем локальный стейт с оригиналом ТОЛЬКО когда меню открывается
  useEffect(() => {
    if (isOpen) {
      setEditNickname(nickname);
      setEditBio(bio);
      setIsEditing(false); // Всегда открываем в режиме просмотра
    }
  }, [isOpen, nickname, bio]);

  const handleClose = () => {
    // Просто закрываем, локальный стейт сбросится при следующем открытии
    setIsEditing(false);
    onClose();
  };

  const handleCancelEdit = () => {
    // Отмена редактирования: возвращаем локальные поля к исходным пропсам
    setEditNickname(nickname);
    setEditBio(bio);
    setIsEditing(false);
  };

  const handleSave = async () => {
    // Сохранение происходит строго здесь! Передаем измененные данные наверх
    await onSave(editNickname, editBio);
    setIsEditing(false);
  };

  return (
    <>
      <div 
        className={`drawer-overlay ${isOpen ? 'open' : ''}`} 
        onClick={handleClose}
      />

      <div className={`profile-drawer ${isOpen ? 'open' : ''}`}>
        
        {/* Кнопка закрыть / отменить */}
        {isEditing ? (
          <button 
            className="close-btn" 
            onClick={handleCancelEdit}
            aria-label="Отменить редактирование"
            title="Отменить редактирование"
          >
            <X size={24} />
          </button>
        ) : (
          <button 
            className="close-btn" 
            onClick={handleClose}
            aria-label="Закрыть меню"
            title="Закрыть меню"
          >
            <X size={24} />
          </button>
        )}

        {/* Верхний блок */}
        <div className="drawer-top">
          <div className="avatar-container">
            <div className="drawer-avatar">
              <User size={64} className="user-icon" />
              {isEditing && (
                <div className="avatar-edit-overlay">
                  <Camera size={28} className="camera-icon" />
                </div>
              )}
            </div>
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
          {/* Слева: Выйти */}
          <button 
            className="round-action-btn logout-btn" 
            onClick={onLogout}
            aria-label="Выйти из аккаунта"
            title="Выйти из аккаунта"
          >
            <LogOut size={24} />
          </button>

          {/* Справа: Изменить / Применить */}
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