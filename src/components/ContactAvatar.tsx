import { useState, useEffect } from 'react';
import { User, RefreshCw } from 'lucide-react';

import { globalHelia } from '../lib/p2p/services/authService.ts';
import { fetchAvatarFromHelia } from '../lib/p2p/services/avatarService';
import '../styles/ContactAvatar.scss';

function ContactAvatar({ cid }: { cid: string | undefined }) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0); 

  useEffect(() => {
    if (!cid || !globalHelia) return;
    
    let isMounted = true;

    const loadAvatar = async () => {
      setIsRetrying(true);
      try {
        const isManualRefresh = retryCount > 0;
        const url = await fetchAvatarFromHelia(globalHelia, cid, 5000, isManualRefresh);
        
        if (isMounted && url) {
          setAvatarUrl(url);
        }
      } catch (e) {
        console.error('Ошибка загрузки аватара контакта:', e);
      } finally {
        if (isMounted) setIsRetrying(false);
      }
    };

    loadAvatar();

    return () => {
      isMounted = false; 
    };
  }, [cid, retryCount]); 

  // 1. Успешный вариант: картинка есть
  if (avatarUrl) {
    return (
      <img 
        src={avatarUrl} 
        alt="avatar" 
        className="contact-avatar-img"
      />
    );
  }

  // 2. Процесс: идет загрузка из сети (крутится чистый SCSS)
  if (isRetrying) {
    return (
      <div className="contact-avatar-wrapper contact-avatar-loading">
        <RefreshCw size={20} />
      </div>
    );
  }

  // 3. Пустой профиль: CID нет, показываем обычного человечка цвета $hint
  if (!cid) {
    return (
      <div className="contact-avatar-wrapper">
        <User size={24} />
      </div>
    );
  }

  // 4. Ошибка сети: CID есть, но картинка не пришла.
  // Иконка рефреша цвета $hint, которая при ховере плавно станет $accent-prime
  return (
    <div 
      onClick={(e) => {
        e.stopPropagation(); // Блокируем переход в чат
        setRetryCount(prev => prev + 1); 
      }}
      title="Повторить загрузку аватара"
      className="contact-avatar-wrapper contact-avatar-clickable"
    >
      <RefreshCw size={22} />
    </div>
  );
}

export default ContactAvatar;