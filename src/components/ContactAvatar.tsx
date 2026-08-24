import { useState, useEffect } from 'react';
import { User, RefreshCw } from 'lucide-react';

import { globalHelia } from '../lib/p2p/services/authService.ts';
import { fetchAvatarFromHelia } from '../lib/p2p/services/avatarService';
import '../styles/contactAvatar.scss';

function ContactAvatar({ 
  cid, 
  serverCid, 
  encryptionKey,
  serverRelays
}: { 
  cid: string | undefined,
  serverCid?: string,
  encryptionKey?: string,
  serverRelays?: string[]
}) {
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
        const url = await fetchAvatarFromHelia(
          globalHelia, 
          cid, 
          15000, 
          serverCid, 
          encryptionKey,
          isManualRefresh,
          serverRelays
        );
        
        console.log(`🖼️ [Avatar UI] Результат fetch:`, url ? 'Успешно получен Blob URL ✅' : 'URL не получен ❌');

        if (isMounted && url) {
          setAvatarUrl(url);
        }
      } catch (e) {
        console.error('🖼️ [Avatar UI] Ошибка загрузки аватара контакта:', e);
      } finally {
        if (isMounted) setIsRetrying(false);
      }
    };

    loadAvatar();

    return () => {
      isMounted = false; 
    };
  }, [cid, serverCid, encryptionKey, retryCount]); 

  if (avatarUrl) {
    return (
      <img 
        src={avatarUrl} 
        alt="avatar" 
        className="contact-avatar-img"
      />
    );
  }

  if (isRetrying) {
    return (
      <div className="contact-avatar-wrapper contact-avatar-loading">
        <RefreshCw size={20} />
      </div>
    );
  }

  if (!cid) {
    return (
      <div className="contact-avatar-wrapper">
        <User size={24} />
      </div>
    );
  }

  return (
    <div 
      onClick={(e) => {
        e.stopPropagation();
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