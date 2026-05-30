import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Eye, EyeOff, User, HelpCircle } from 'lucide-react';
import * as bip39 from 'bip39';
import { saveSeedFromAuth } from '../lib/p2p/crypto';



function Auth() {
  const [isRegister, setIsRegister] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [nickname, setNickname] = useState('');
  const [words, setWords] = useState<string[]>(Array(12).fill(''));
  const navigate = useNavigate();

  // Функция генерации настоящей BIP39 мнемоники (12 слов)
  const generateWords = () => {
    const mnemonic = bip39.generateMnemonic(128); 
    setWords(mnemonic.split(' '));
  };

  // Эффект для очистки полей при переключении между Входом и Регистрацией
  useEffect(() => {
    // Если ключ уже есть в localStorage — отправляем пользователя в чат
    if (localStorage.getItem('browser-private-key')) {
      navigate('/contacts', { replace: true });
      return;
    }
    
    setWords(Array(12).fill(''));
    setNickname('');
    setShowPass(false);

    if (isRegister) {
      generateWords();
    }
  }, [isRegister]);

  const handleWordChange = (index: number, value: string) => {
    const newWords = [...words];
    newWords[index] = value.trim(); 
    setWords(newWords);
  };

// Делаем функцию асинхронной
  const handleLoginOrRegister = async () => {
    // Собираем массив слов в одну строку
    const enteredMnemonic = words.join(' ').trim();

    if (isRegister) {
      if (!nickname.trim()) {
        alert('Пожалуйста, введите никнейм');
        return;
      }
      if (words.some(w => !w)) {
        alert('Пожалуйста, сгенерируйте и сохраните слова');
        return;
      }

      console.log('Начинаем регистрацию...');
      
    } else {
      if (words.some(w => !w)) {
        alert('Пожалуйста, заполните все 12 слов');
        return;
      }

      // Проверка валидности мнемоники (чексумма и словарь)
      if (!bip39.validateMnemonic(enteredMnemonic)) {
        alert('Некорректная сид-фраза. Проверьте правильность написания слов и их порядок.');
        return;
      }

      console.log('Начинаем вход...');
    }

try {
      // 1. Конвертируем слова в Seed
      const seedBuffer = await bip39.mnemonicToSeed(enteredMnemonic);
      const seed64 = new Uint8Array(seedBuffer);

      // 2. Отрезаем 32 байта для Ed25519
      const seed32 = seed64.slice(0, 32);

      // 3. ПЕРЕДАЕМ ОТВЕТСТВЕННОСТЬ твоему crypto.ts!
      // Он сам сохранит базу, очистит старый кэш IndexedDB и подготовит почву.
      await saveSeedFromAuth(seed32);

      if (isRegister) {
        console.log('Регистрация завершена, ключи сохранены.');
        // Здесь мы будем вызывать создание OrbitDB БД для профиля (никнейма)
        // Но пока просто редирект:
        navigate('/contacts', { replace: true });
      } else {
        console.log('Вход выполнен, ключи восстановлены.');
        // Для входа ключи сохранены, можно пускать пользователя дальше:
        navigate('/contacts', { replace: true });
      }

    } catch (error) {
      console.error('Ошибка авторизации:', error);
      alert('Произошла ошибка при обработке данных.');
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-container">
        
        <div className="auth-header">
          <h1>{isRegister ? 'Создать аккаунт' : 'С возвращением'}</h1>
          <p className="auth-subtitle">
            {isRegister 
              ? 'Сохраните эти 12 слов в надежном месте' 
              : 'Введите вашу секретную фразу для входа'}
            
            <span 
              className="tooltip-trigger" 
              data-tooltip="Эти 12 слов — ваш единственный ключ к аккаунту. Они не хранятся на серверах. Если вы потеряете их, восстановить доступ к профилю и чатам будет невозможно. Никогда и никому не передавайте свою фразу!"
            >
              <HelpCircle size={14} className="help-icon" />
            </span>
          </p>
        </div>

        {isRegister && (
          <div className="input-wrapper">
            <User className="input-icon" size={18} />
            <input
              type="text"
              placeholder="Придумайте никнейм (например, AlexP2P)"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="nickname-input"
            />
          </div>
        )}

        {/* Сетка слов */}
        <div className="words-grid">
          {words.map((word, i) => (
            <input
              key={i}
              type={showPass ? 'text' : 'password'}
              value={word}
              onChange={(e) => handleWordChange(i, e.target.value)}
              disabled={isRegister}
              placeholder={`${i + 1}`}
              className="word-input"
            />
          ))}
        </div>

        <div className="words-actions-bar">
          <button
            onClick={() => setShowPass(!showPass)}
            className="action-link"
            aria-label={showPass ? 'Скрыть слова' : 'Показать слова'}
          >
            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            <span>{showPass ? 'Скрыть слова' : 'Показать слова'}</span>
          </button>
          
          {isRegister && (
            <button onClick={generateWords} className="action-link primary">
              <RefreshCw size={14} />
              <span>Обновить слова</span>
            </button>
          )}
        </div>

        <button className="submit-btn" onClick={handleLoginOrRegister}>
          {isRegister ? 'Зарегистрироваться' : 'Войти в аккаунт'}
        </button>

        <button
          onClick={() => setIsRegister(!isRegister)}
          className="switch-mode"
        >
          {isRegister ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Создать профиль'}
        </button>
      </div>
    </div>
  );
}

export default Auth;