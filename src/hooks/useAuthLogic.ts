import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { initializeApp } from '../lib/p2p/services/authService.ts';
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
    
    setWords(Array(12).fill(''));
    setNickname('');
    setShowPass(false);

    if (isRegister) {
      generateWords();
    }
  }, [isRegister, navigate]);

  const handleWordChange = (index: number, value: string) => {
    const newWords = [...words];
    newWords[index] = value.trim();
    setWords(newWords);
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

      localStorage.setItem(CONFIG.IS_LODING, 'true');

      if (isRegister) {
        console.log('✅ Регистрация завершена, профиль создан.');
      } else {
        console.log('✅ Вход выполнен, профиль восстановлен.');
      }
      
      navigate('/contacts', { replace: true });

    } catch (error: any) {
      console.error('Ошибка авторизации:', error);

      if (isRegister) {
        console.log('🔄 Откат изменений: удаляем фейковые ключи из памяти...');
        await clearAuthData(); 
        localStorage.removeItem(CONFIG.IS_LODING);
        setNickname('');
        generateWords(); 
      }
      
      showToast(error.message ? `❌ ${error.message}` : '❌ Произошла ошибка. Регистрация прервана.');
    }
  };

  // Возвращаем тост и метод наружу
  return {
    isRegister,
    setIsRegister,
    showPass,
    setShowPass,
    nickname,
    setNickname,
    words,
    handleWordChange,
    generateWords,
    handleLoginOrRegister,
    toastMessage,
    showToast
  };
};