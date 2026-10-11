// App.tsx
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Auth from './pages/Auth';
import Chat from './pages/Chat';
import Contacts from './pages/Contacts';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { useEffect, useState } from 'react';
import { isAuthenticated } from './lib/p2p/crypto/crypto.ts';
import { initializeApp, globalHelia, globalRelayManager, pushProfileUpdateToContacts, globalContactsDb, syncContactRequests } from './lib/p2p/services/authService.ts';
import { clearAuthData } from './lib/p2p/crypto/crypto.ts';
import { NetworkOverlay } from './components/NetworkOverlay.tsx';
import { initNetworkStateMachine } from '../src/lib/p2p/networking/NetworkStateMachine.ts';
import { syncTopContactsHistory } from './lib/p2p/services/contactsService.ts';
import { startBackgroundProfileWatcher } from './lib/p2p/services/backgroundServices.ts';
import { checkAndSyncRelays } from './lib/p2p/networking/connectionManager.ts';
import { useUploadEvents } from './hooks/useUploadEvents'
import { createPortal } from 'react-dom';
import { CONFIG } from './lib/p2p/config.ts';
import { claimPrimaryTab, takeOverPrimaryTab, onPrimaryLost, handOffJoinLink, listenJoinLinks } from './lib/p2p/utils/tabLock.ts';
import './App.css';

// Основная вкладка принимает ссылки-приглашения, открытые во второй вкладке
function JoinLinkBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isAuthenticated()) return;
    return listenJoinLinks((hash) => {
      sessionStorage.setItem(CONFIG.KEY_PENDING_JOIN, hash);
      navigate('/contacts', { replace: true });
      window.dispatchEvent(new Event('ychat:join-link'));
    });
  }, [navigate]);
  return null;
}

function App() {
  const { t } = useTranslation();
  const toasts = useUploadEvents();
  const [tabRole, setTabRole] = useState<'checking' | 'primary' | 'handoff' | 'blocked'>('checking');

    // Один P2P-узел на аккаунт: вторая вкладка со ссылкой передаёт её первой и не стартует
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isAuthenticated() || globalHelia) { if (alive) setTabRole('primary'); return; }
      const isPrimary = await claimPrimaryTab();
      const pending = sessionStorage.getItem(CONFIG.KEY_PENDING_JOIN);
      if (!isPrimary && pending && (await handOffJoinLink(pending))) {
        sessionStorage.removeItem(CONFIG.KEY_PENDING_JOIN);
        if (alive) setTabRole('handoff');
        window.close(); // сработает только у вкладок, открытых скриптом; иначе остаётся экран ниже
        return;
      }
      if (alive) setTabRole(isPrimary ? 'primary' : 'blocked');
    })();
    return () => { alive = false; };
  }, []);

  // Другая вкладка забрала управление: перезагружаемся в заглушку, P2P-узел этой вкладки умирает вместе со страницей
  useEffect(() => onPrimaryLost(() => window.location.reload()), []);

  useEffect(() => {
    if (tabRole !== 'primary') return;
    if (isAuthenticated() && !globalHelia) {
      console.log('🔄 Запуск P2P сессии...');

      const pendingNickname = localStorage.getItem(CONFIG.KEY_PENDING_NICKNAME) || undefined;

      initializeApp(pendingNickname)
        .then(() => {
          if (pendingNickname) localStorage.removeItem(CONFIG.KEY_PENDING_NICKNAME);

          if (globalHelia && globalRelayManager) {
            const stateMachine = initNetworkStateMachine({
              libp2p: globalHelia.libp2p,
              relayManager: globalRelayManager,
              pushProfileUpdateToContacts: pushProfileUpdateToContacts,
              syncContactRequests: syncContactRequests
            });

        stateMachine.start();
        console.log('🛡️ [App] Network State Machine успешно запущена.');

        Promise.all([
          checkAndSyncRelays(globalHelia, true)
            .catch(err => console.error("❌ Ошибка checkAndSyncRelays:", err)),

          startBackgroundProfileWatcher(globalContactsDb)
            .catch(err => console.error("❌ Ошибка вотчера профилей:", err))
        ]).then(() => {
          console.log(`🚀 [Cold Start] Фоновые службы запущены. Запускаем синхронизацию историй... db: ${globalContactsDb?.address?.toString()}`);
          
          return syncTopContactsHistory(globalContactsDb, 10);
        })
        .then(() => {
          console.log("✅ [Cold Start] Синк историй успешно завершен на горячем канале!");
        })
        .catch(err => {
          console.error("❌ Ошибка синка историй:", err);
        });
          }
        })
        .catch(err => {
          console.error('Критическая ошибка при восстановлении P2P:', err);

          if (pendingNickname) {
            // Регистрация не подтвердилась ни одним релеем — сид ещё ничей, откатываем 1:1 как раньше делал Auth.tsx
            localStorage.removeItem(CONFIG.KEY_PENDING_NICKNAME);
            clearAuthData().finally(() => {
              localStorage.setItem(CONFIG.KEY_AUTH_ERROR, err.message || t('app.connectionError'));
              window.location.href = import.meta.env.BASE_URL;
            });
            return;
          }

          // LOGIN существующего аккаунта — сид не трогаем, показываем ошибку как раньше
          window.dispatchEvent(new CustomEvent('authError', { detail: { message: err.message || t('app.connectionError') } }));
        });
    }
  }, [t, tabRole]);

  if (tabRole === 'checking') return null;
  if (tabRole === 'handoff') {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        {t('app.joinHandedOff')}
      </div>
    );
  }

    if (tabRole === 'blocked') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100vh', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <p>{t('app.openElsewhere')}</p>
        <button
          className="modal-submit-btn"
          style={{ maxWidth: 260 }}
          onClick={() => takeOverPrimaryTab().then(() => setTabRole('primary'))}
        >
          {t('app.useHere')}
        </button>
      </div>
    );
  }

  return (
    <>
      <Router basename={import.meta.env.BASE_URL}>
        <JoinLinkBridge />
        <NetworkOverlay />
        <Routes>
          <Route path="/" element={<Auth />} />
          <Route 
            path="/chat/:peerId" 
            element={
              <ProtectedRoute>
                <Chat />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/contacts" 
            element={
              <ProtectedRoute>
                <Contacts />
              </ProtectedRoute>
            } 
          />
        </Routes>
      </Router>

    {createPortal(
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast-notification toast-${t.kind}`}>{t.message}</div>
        ))}
      </div>,
      document.body
    )}
    </>
  );
}

export default App;