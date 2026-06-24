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

  // Функция генерации настоящей BIP39 мнемоники (12 слов)
  const generateWords = () => {
    const mnemonic = generateNewMnemonic();
    setWords(mnemonic);
  };

  // Эффект для очистки полей при переключении между Входом и Регистрацией
  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/contacts', { replace: true });
      return;
    }
    
    // Очистка полей при переключении
    setWords(Array(12).fill(''));
    setNickname('');
    setShowPass(false);

    // Генерация только если мы перешли в режим регистрации
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
        alert('Пожалуйста, введите никнейм');
        return;
      }
      if (words.some((w) => !w)) {
        alert('Пожалуйста, сгенерируйте и сохраните слова');
        return;
      }
      console.log('Начинаем регистрацию...');
    } else {
      if (words.some((w) => !w)) {
        alert('Пожалуйста, заполните все 12 слов');
        return;
      }
      if (!isValidMnemonic(words)) {
        alert('Некорректная сид-фраза. Проверьте правильность написания слов и их порядок.');
        return;
      }
      console.log('Начинаем вход...');
    }

    try {
      // 1. Конвертируем слова в Seed
      const seedBuffer = await getSeedFromMnemonic(words);
      const seed64 = new Uint8Array(seedBuffer);
      // 2. Отрезаем 32 байта для Ed25519
      const seed32 = seed64.slice(0, 32);

      // 3. ПЕРЕДАЕМ ОТВЕТСТВЕННОСТЬ crypto.ts
      await saveSeedFromAuth(seed32);

      // ЗАПУСКАЕМ СЕТЬ И ПРОФИЛЬ
      await initializeApp(isRegister ? nickname : undefined);

      // ⚡️ СЕТЬ И БАЗЫ ПОДНЯЛИСЬ — СТАВИМ СИНХРОННЫЙ ФЛАГ
      localStorage.setItem(CONFIG.IS_LODING, 'true');

      if (isRegister) {
        console.log('✅ Регистрация завершена, профиль создан.');
      } else {
        console.log('✅ Вход выполнен, профиль восстановлен.');
      }
      
      // Переходим к контактам
      navigate('/contacts', { replace: true });

    } catch (error: any) {
      console.error('Ошибка авторизации:', error);

      // 🛑 ОТКАТ ПРИ ОШИБКЕ РЕГИСТРАЦИИ
      if (isRegister) {
        console.log('🔄 Откат изменений: удаляем фейковые ключи из памяти...');
        await clearAuthData(); 

        // ⚡️ УБИРАЕМ ФЛАГ, ЧТОБЫ НЕ ПУСТИТЬ В ПРИЛОЖЕНИЕ С ПУСТОЙ БАЗОЙ
        localStorage.removeItem(CONFIG.IS_LODING);

        setNickname('');
        generateWords(); 
      }
      
      alert(error.message || 'Произошла ошибка при обработке данных. Регистрация прервана.');
    }
  };

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
    handleLoginOrRegister
  };
};