import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  saveSeedFromAuth, 
  generateNewMnemonic, 
  isValidMnemonic, 
  getSeedFromMnemonic, 
  isAuthenticated,
  clearAuthData
} from '../lib/p2p/crypto/crypto.ts';
import { CONFIG } from '../lib/p2p/config.ts';

export const useAuthLogic = () => {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const [isRegister, setIsRegister] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [nickname, setNickname] = useState('');
  const [words, setWords] = useState<string[]>(Array(12).fill(''));
  const navigate = useNavigate();

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const generateWords = () => {
    const mnemonic = generateNewMnemonic();
    setWords(mnemonic);
  };

  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/contacts', { replace: true });
      return;
    }
    
    setIsLoading(false);
    setWords(Array(12).fill(''));
    setNickname('');
    setShowPass(false);

    if (isRegister) {
      generateWords();
    }

    const pendingError = localStorage.getItem(CONFIG.KEY_AUTH_ERROR);
    if (pendingError) {
      localStorage.removeItem(CONFIG.KEY_AUTH_ERROR);
      showToast(`❌ ${pendingError}`);
    }
  }, [isRegister, navigate]);

  const handleWordChange = (index: number, value: string) => {
    const trimmed = value.trim();

    if (trimmed.includes(' ')) {
      const parsedWords = trimmed.split(/\s+/);
      const newWords = [...words];
      
      parsedWords.forEach((word, i) => {
        if (index + i < 12) {
          newWords[index + i] = word.toLowerCase();
        }
      });
      
      setWords(newWords);
      return;
    }

    const newWords = [...words];
    newWords[index] = value.trim().toLowerCase();
    setWords(newWords);
  };

  const copyWords = async () => {
    const phrase = words.join(' ').trim();
    if (!phrase) {
      showToast(t('authLogic.noWordsToCopy'));
      return;
    }

    try {
      await navigator.clipboard.writeText(phrase);
      showToast(t('authLogic.wordsCopied'));
    } catch (err) {
      console.error('Ошибка при копировании:', err);
      showToast(t('authLogic.copyFailed'));
    }
  };

  const handleLoginOrRegister = async () => {
    if (isRegister) {
      if (!nickname.trim()) {
        showToast(t('authLogic.enterNickname'));
        return;
      }
      if (words.some((w) => !w)) {
        showToast(t('authLogic.generateWordsFirst'));
        return;
      }
      console.log('Начинаем регистрацию...');
    } else {
      if (words.some((w) => !w)) {
        showToast(t('authLogic.fillAllWords'));
        return;
      }
      if (!isValidMnemonic(words)) {
        showToast(t('authLogic.invalidMnemonic'));
        return;
      }
      
      console.log('Начинаем вход...');
    }

    try {
      const seedBuffer = await getSeedFromMnemonic(words);
      const seed64 = new Uint8Array(seedBuffer);
      const seed32 = seed64.slice(0, 32);

      await saveSeedFromAuth(seed32);

      // Соединение открывает только App.tsx на /contacts. Если открыть его здесь
      // и тут же убить хардредиректом — на релее остаётся битый gossipsub-mesh
      // для этого PeerId (см. диагностику PEER-SYNC).
      if (isRegister) {
        localStorage.setItem(CONFIG.KEY_PENDING_NICKNAME, nickname);
      }

      window.location.href = import.meta.env.BASE_URL + 'contacts';

    } catch (error: any) {
      console.error('Ошибка авторизации:', error);

      if (isRegister) {
        console.log('🔄 Откат изменений: удаляем фейковые ключи из памяти...');
        await clearAuthData(); 
        setNickname('');
        generateWords(); 
      }
      
      showToast(error.message ? `❌ ${error.message}` : t('authLogic.genericError'));
    }
  };

  return {
    isLoading,
    isRegister,
    setIsRegister,
    showPass,
    setShowPass,
    nickname,
    setNickname,
    words,
    handleWordChange,
    generateWords,
    copyWords,
    handleLoginOrRegister,
    toastMessage,
    showToast
  };
};