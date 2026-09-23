// App.tsx
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Auth from './pages/Auth';
import Chat from './pages/Chat';
import Contacts from './pages/Contacts';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { useEffect } from 'react';
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
import './App.css';

function App() {
  const { t } = useTranslation();
  const toasts = useUploadEvents();

  useEffect(() => {
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
  }, [t]);

  return (
    <>
      <Router basename={import.meta.env.BASE_URL}>
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