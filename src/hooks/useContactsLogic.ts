import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CID } from 'multiformats/cid';

import { globalProfileDb, globalContactsDb, onDbReady, globalHelia, broadcastMyProfile } from '../lib/p2p/services/authService.ts'; 
import { getAllContacts, saveContact, deleteContact } from '../lib/p2p/services/contactsService.ts';
import { isAuthenticated } from '../lib/p2p/crypto/crypto.ts';
import { CONFIG, type ContactItem } from '../lib/p2p/config.ts';
import { uploadAvatarToHelia, fetchAvatarFromHelia } from '../lib/p2p/services/avatarService';
import { requestPeerProfile } from '../lib/p2p/services/profileService.ts';

export const useContactsLogic = () => {
  const navigate = useNavigate();
  
  const [myNickname, setMyNickname] = useState<string>('Загрузка...');
  const [myBio, setMyBio] = useState<string>(''); 
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  
  const [dbInstance, setDbInstance] = useState<any>(globalProfileDb);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  
  const [contacts, setContacts] = useState<ContactItem[]>([]);

  useEffect(() => {
    const handleContactsUpdate = async () => {
      if (globalContactsDb) {
        const updatedList = await getAllContacts(globalContactsDb);
        setContacts(updatedList);
      }
    };
    window.addEventListener('onContactsUpdated', handleContactsUpdate);
    return () => window.removeEventListener('onContactsUpdated', handleContactsUpdate);
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) navigate('/', { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!isAuthenticated()) return;

    const loadData = async (profileDb: any) => {
      try {
        const name = await profileDb.get(CONFIG.PROFILE.KEY_NICKNAME);
        const bio = await profileDb.get(CONFIG.PROFILE.KEY_BIO);
        const avatarCID = await profileDb.get(CONFIG.PROFILE.KEY_AVATAR_CID);
        
        setMyNickname(name || 'Аноним');
        setMyBio(bio || '');

        if (avatarCID && globalHelia) { 
          const url = await fetchAvatarFromHelia(globalHelia, avatarCID);
          setMyAvatarUrl(url);
        }

        if (globalContactsDb) {
          const rawContacts = await getAllContacts(globalContactsDb);
          setContacts(rawContacts);
        }
      } catch (error) {
        console.error('Ошибка при чтении данных:', error);
        setMyNickname('Ошибка');
      } finally {
        setIsLoading(false);
      }
    };

    if (globalProfileDb && globalContactsDb) {
      setDbInstance(globalProfileDb);
      loadData(globalProfileDb);
    } else {
      onDbReady(() => {
        setDbInstance(globalProfileDb);
        loadData(globalProfileDb);
      });
    }
  }, [navigate]);

  const handleRefreshContact = async (e: React.MouseEvent, targetPeerId: string) => {
    e.stopPropagation();
    if (globalHelia) await requestPeerProfile(globalHelia, targetPeerId);
  };

  const handleDeleteContact = async (e: React.MouseEvent, contactId: string) => {
    e.stopPropagation(); 
    if (window.confirm('Точно удалить этот contact?')) {
      const success = await deleteContact(globalContactsDb, contactId);
      if (success) setContacts(await getAllContacts(globalContactsDb));
    }
  };

  const handleSaveProfile = async (newNickname: string, newBio: string, newAvatarBlob: Blob | null) => {
    if (!dbInstance) return;
    try {
      const timestamp = Date.now();
      await dbInstance.put(CONFIG.PROFILE.KEY_NICKNAME, newNickname);
      await dbInstance.put(CONFIG.PROFILE.KEY_BIO, newBio);
      await dbInstance.put(CONFIG.PROFILE.KEY_LAST_UPDATED, timestamp);

      if (newAvatarBlob && globalHelia) {
        const cid = await uploadAvatarToHelia(globalHelia, newAvatarBlob);
        try {
          const dht = globalHelia.libp2p.dht;
          if (dht && typeof dht.provide === 'function') {
            await dht.provide(CID.parse(cid)).catch(() => {});
          }
        } catch {}
        await dbInstance.put(CONFIG.PROFILE.KEY_AVATAR_CID, cid);
        setMyAvatarUrl(URL.createObjectURL(newAvatarBlob));
      }
      
      setMyNickname(newNickname);
      setMyBio(newBio);
      if (globalHelia) await broadcastMyProfile();
    } catch (error) {
      console.error('Не удалось сохранить профиль в P2P:', error);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate('/', { replace: true });
  };

  const handleShare = async () => {
    if (!globalHelia || !globalProfileDb) return alert('Сеть еще не готова!');
    try {
      const tokenObj = { id: globalHelia.libp2p.peerId.toString(), profile: globalProfileDb.address.toString() };
      await navigator.clipboard.writeText(btoa(JSON.stringify(tokenObj)));
      alert('Твой код скопирован!');
    } catch {}
  };

  const handleAdd = async () => {
    const token = window.prompt('Вставь код контакта:');
    if (!token) return;
    try {
      const decoded = JSON.parse(atob(token));
      if (!decoded.id || !decoded.profile) throw new Error('Кривой токен');
      if (globalHelia && decoded.id === globalHelia.libp2p.peerId.toString()) return alert('Нельзя добавить себя');

      const newContact: ContactItem = {
        id: decoded.id,
        profileDbAddress: decoded.profile,
        chatDbAddress: '', 
        nickname: `Пир: ${decoded.id.slice(0, 8)}...`, 
        avatarCid: '',
        updatedAt: Date.now()
      };

      await saveContact(globalContactsDb, newContact);
      setContacts(await getAllContacts(globalContactsDb));

      if (globalHelia) await requestPeerProfile(globalHelia, decoded.id);
    } catch {
      alert('Неверный формат кода!');
    }
  };

  return {
    navigate, isLoading, dbInstance, isProfileOpen, setIsProfileOpen,
    myNickname, myBio, myAvatarUrl, contacts,
    handleRefreshContact, handleDeleteContact, handleSaveProfile, handleLogout, handleShare, handleAdd
  };
};