import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Eye, EyeOff } from 'lucide-react';

function Auth() {
  const [isRegister, setIsRegister] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState('');
  const [words, setWords] = useState(Array(6).fill(''));
  const navigate = useNavigate();

  // Эмуляция генерации слов при регистрации
  const generateWords = () => {
    const mockWords = ['яблоко', 'синий', 'трактор', 'ехать', 'быстро', 'лес'];
    setWords(mockWords);
  };

  const handleWordChange = (index: number, value: string) => {
    const newWords = [...words];
    newWords[index] = value;
    setWords(newWords);
  };

  const handleLogin = () => {
    if (!isRegister) {
      navigate('/contacts');
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-container">
        <h1>{isRegister ? 'Создать аккаунт' : 'С возвращением'}</h1>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="email-input"
        />

        <div className="words-grid">
          {words.map((word, i) => (
            <input
              key={i}
              type={showPass ? 'text' : 'password'}
              value={word}
              onChange={(e) => handleWordChange(i, e.target.value)}
              disabled={isRegister}
              placeholder={`Слово ${i + 1}`}
              className="word-input"
            />
          ))}
        </div>

        <div className="controls">
          <button
            onClick={() => setShowPass(!showPass)}
            className="toggle-visibility"
            aria-label={showPass ? 'Hide password' : 'Show password'}
          >
            {showPass ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
          {isRegister && (
            <button onClick={generateWords} className="refresh-words">
              <RefreshCw size={16} /> Обновить слова
            </button>
          )}
        </div>

        <button className="submit-btn" onClick={handleLogin}>
          {isRegister ? 'Зарегистрироваться' : 'Войти'}
        </button>

        <button
          onClick={() => {
            setIsRegister(!isRegister);
            if (!isRegister) generateWords();
          }}
          className="switch-mode"
        >
          {isRegister ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Регистрация'}
        </button>
      </div>
    </div>
  );
}

export default Auth;
