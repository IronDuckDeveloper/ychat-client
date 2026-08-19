import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { broadcastMyProfile, initializeApp } from '../lib/p2p/services/authService.ts';
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
  const [isLoading, setIsLoading] = useState(true);
  const [isRegister, setIsRegister] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [nickname, setNickname] = useState('');
  const [words, setWords] = useState<string[]>(Array(12).fill(''));
  const navigate = useNavigate();

  // Добавляем стейт тоста
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Хелпер для показа тоста
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
    
    // Если не авторизован — снимаем загрузку и готовим форму
    setIsLoading(false);
    setWords(Array(12).fill(''));
    setNickname('');
    setShowPass(false);

    if (isRegister) {
      generateWords();
    }
  }, [isRegister, navigate]);

  // Ввод одного слова или авто-распределение при вставке нескольких слов через пробел
  const handleWordChange = (index: number, value: string) => {
    const trimmed = value.trim();

    // Если вставлена строка из нескольких слов
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

  // Копирование всех 12 слов в одну строку через пробел
  const copyWords = async () => {
    const phrase = words.join(' ').trim();
    if (!phrase) {
      showToast('⚠️ Нет слов для копирования');
      return;
    }

    try {
      await navigator.clipboard.writeText(phrase);
      showToast('✅ 12 слов скопированы в буфер обмена');
    } catch (err) {
      console.error('Ошибка при копировании:', err);
      showToast('❌ Не удалось скопировать в буфер обмена');
    }
  };

  const handleLoginOrRegister = async () => {
    if (isRegister) {
      if (!nickname.trim()) {
        showToast('⚠️ Пожалуйста, введите никнейм');
        return;
      }
      if (words.some((w) => !w)) {
        showToast('⚠️ Пожалуйста, сгенерируйте и сохраните слова');
        return;
      }
      console.log('Начинаем регистрацию...');
    } else {
      if (words.some((w) => !w)) {
        showToast('⚠️ Пожалуйста, заполните все 12 слов');
        return;
      }
      if (!isValidMnemonic(words)) {
        showToast('❌ Некорректная сид-фраза. Проверьте правильность слов и их порядок.');
        return;
      }
      console.log('Начинаем вход...');
    }

    try {
      const seedBuffer = await getSeedFromMnemonic(words);
      const seed64 = new Uint8Array(seedBuffer);
      const seed32 = seed64.slice(0, 32);

      await saveSeedFromAuth(seed32);
      await initializeApp(isRegister ? nickname : undefined);

      if (isRegister) {
        console.log('📢 [Register] Отправляем профиль в сеть перед перезагрузкой...');
        try {
          await broadcastMyProfile();
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.warn('⚠️ Не удалось забросить профиль перед редиректом:', e);
        }
      }

      localStorage.setItem(CONFIG.IS_LOADING, 'true');
      window.location.href = '/contacts';

    } catch (error: any) {
      console.error('Ошибка авторизации:', error);

      if (isRegister) {
        console.log('🔄 Откат изменений: удаляем фейковые ключи из памяти...');
        await clearAuthData(); 
        localStorage.removeItem(CONFIG.IS_LOADING);
        setNickname('');
        generateWords(); 
      }
      
      showToast(error.message ? `❌ ${error.message}` : '❌ Произошла ошибка. Регистрация прервана.');
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