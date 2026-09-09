import { RefreshCw, Eye, EyeOff, User, HelpCircle, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthLogic } from '../hooks/useAuthLogic.ts';
import '../styles/auth.scss';

const AuthScreen = () => {
  const { t } = useTranslation();
  const {
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
    toastMessage
  } = useAuthLogic();

  if (isLoading) {
    return null;
  }

  return (
    <div className="auth-screen">
      <form
        className="auth-container"
        onSubmit={(e) => {
          e.preventDefault();
          handleLoginOrRegister();
        }}
      >
        <div className="auth-header">
          <h1>{isRegister ? t('authScreen.createAccountTitle') : t('authScreen.welcomeBackTitle')}</h1>
          <p className="auth-subtitle">
            {isRegister
              ? t('authScreen.createSubtitle')
              : t('authScreen.loginSubtitle')}

            <span
              className="tooltip-trigger"
              data-tooltip={t('authScreen.helpTooltip')}
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
              placeholder={t('authScreen.nicknamePlaceholder')}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="nickname-input"
            />
          </div>
        )}

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
              autoComplete={showPass ? 'off' : 'current-password'}
            />
          ))}
        </div>

        <div className="words-actions-bar">
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            className="action-link"
            aria-label={showPass ? t('authScreen.hideWords') : t('authScreen.showWords')}
          >
            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            <span>{showPass ? t('authScreen.hideWords') : t('authScreen.showWords')}</span>
          </button>

          <button
            type="button"
            onClick={copyWords}
            className="action-link"
          >
            <Copy size={16} />
            <span>{t('authScreen.copyToClipboard')}</span>
          </button>

          {isRegister && (
            <button
              type="button"
              onClick={generateWords}
              className="action-link primary"
            >
              <RefreshCw size={14} />
              <span>{t('authScreen.refreshWords')}</span>
            </button>
          )}
        </div>

        <button type="submit" className="submit-btn">
          {isRegister ? t('authScreen.registerSubmit') : t('authScreen.loginSubmit')}
        </button>

        <button
          type="button"
          onClick={() => setIsRegister(!isRegister)}
          className="switch-mode"
        >
          {isRegister
            ? t('authScreen.switchToLogin')
            : t('authScreen.switchToRegister')}
        </button>
      </form>

      {toastMessage && <div className="toast-notification">{toastMessage}</div>}
    </div>
  );
};

export default function Auth() {
  return <AuthScreen />;
}