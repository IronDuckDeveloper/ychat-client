import { RefreshCw, Eye, EyeOff, User, HelpCircle } from 'lucide-react';
import { useAuthLogic } from '../hooks/useAuthLogic.ts';

const AuthScreen = () => {
  const {
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
    toastMessage // 👈 Достаем сообщение тоста
  } = useAuthLogic();

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
          {isRegister
            ? 'Уже есть аккаунт? Войти'
            : 'Нет аккаунта? Создать профиль'}
        </button>
      </div>

      {/* ТОСТ: отображаем поверх всего, если есть сообщение */}
      {toastMessage && <div className="toast-notification">{toastMessage}</div>}
    </div>
  );
};

export default function Auth() {
  return <AuthScreen />;
}