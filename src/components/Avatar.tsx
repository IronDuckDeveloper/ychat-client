import React from 'react';
import { User } from 'lucide-react'; // Или та библиотека иконок, которую ты используешь
import '../styles/avatar.scss';

interface AvatarProps {
  url?: string | null;
  size?: number;          // Размер дефолтной иконки внутри, если нет фото
  className?: string;     // Для дополнительных внешних отступов, если понадобятся
  onClick?: () => void;   // Опциональный клик
}

const Avatar: React.FC<AvatarProps> = ({ url, size = 24, className = '', onClick }) => {
  const isClickable = !!onClick;

  return (
    <div 
      className={`ui-avatar ${isClickable ? 'clickable' : ''} ${className}`}
      onClick={onClick}
    >
      {url ? (
        <img src={url} alt="Avatar" />
      ) : (
        <User size={size} />
      )}
    </div>
  );
};

export default Avatar;