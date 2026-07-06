import { User, ArrowRightFromLine } from 'lucide-react';
import HeaderActionButton from './HeaderActionButton.tsx';

interface ContactProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  nickname: string;
  bio: string;
  avatarUrl: string | null;
}

const ContactProfileDrawer = ({ isOpen, onClose, nickname, bio, avatarUrl }: ContactProfileDrawerProps) => {
  return (
    <>
      <div className={`drawer-overlay ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <div className={`profile-drawer right-side ${isOpen ? 'open' : ''}`}>
        
        <div className="drawer-header">
          <div className="header-left">
            {/* Оставляем пустым для выравнивания */}
          </div>
          <div className="header-actions left-side">
            <HeaderActionButton 
              onClick={onClose} 
              icon={<ArrowRightFromLine size={20} />} 
              title="Закрыть" 
            />
          </div>
        </div>

        <div className="drawer-content">
          <div className="avatar-container">
            <div className="drawer-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="user-avatar-image" />
              ) : (
                <User size={64} className="user-icon" />
              )}
            </div>
          </div>

          <div className="profile-info-container">
            <div className="info-display">
              <h2 className="display-nickname">{nickname}</h2>
              <p className="display-bio">{bio || 'Биография не заполнена'}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ContactProfileDrawer;