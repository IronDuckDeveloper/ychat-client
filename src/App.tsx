// App.tsx
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Auth from './pages/Auth';
import Chat from './pages/Chat';
import Contacts from './pages/Contacts';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { useEffect } from 'react';
import { isAuthenticated } from './lib/p2p/crypto/crypto.ts';
import { initializeApp, globalHelia, globalRelayManager, broadcastMyProfile, globalContactsDb } from './lib/p2p/services/authService.ts';
import { NetworkOverlay } from './components/NetworkOverlay.tsx';
import { initNetworkStateMachine } from '../src/lib/p2p/networking/NetworkStateMachine.ts';
import { syncTopContactsHistory } from './lib/p2p/services/contactsService.ts';
import { startGlobalNotificationListener, startBackgroundProfileWatcher } from './lib/p2p/services/backgroundServices.ts';
import { checkAndSyncRelays } from './lib/p2p/networking/connectionManager.ts';
import { useUploadEvents } from './hooks/useUploadEvents';

function App() {
  const toasts = useUploadEvents();

  useEffect(() => {
    if (isAuthenticated() && !globalHelia) {
      console.log('🔄 Запуск P2P сессии...');
      initializeApp()
        .then(() => {
          if (globalHelia && globalRelayManager) {
            const stateMachine = initNetworkStateMachine({
              libp2p: globalHelia.libp2p,
              relayManager: globalRelayManager,
              broadcastMyProfile: broadcastMyProfile
            });

        // Запускаем контроль сети (стейт-машина переходит в CONNECTING -> CONNECTED)
        stateMachine.start();
        console.log('🛡️ [App] Network State Machine успешно запущена.');

        // 🔥 Объединяем все стартовые функции в один Promise.all
        Promise.all([
          checkAndSyncRelays(globalHelia, true)
            .catch(err => console.error("❌ Ошибка checkAndSyncRelays:", err)),

          startGlobalNotificationListener(globalHelia, globalContactsDb)
            .catch(err => console.error("❌ Ошибка пуш-нотификатора:", err)),

          startBackgroundProfileWatcher(globalContactsDb)
            .catch(err => console.error("❌ Ошибка вотчера профилей:", err))
        ]).then(() => {
          // Этот блок кода выполнится ровно тогда, когда ВСЕ три функции выше отработают.
          // Никаких таймаутов!
          console.log(`🚀 [Cold Start] Фоновые службы запущены. Запускаем синхронизацию историй... db: ${globalContactsDb?.address?.toString()}`);
          
          return syncTopContactsHistory(globalContactsDb, 10);
        })
        .then(() => {
          console.log("✅ [Cold Start] Синк историй успешно завершен на горячем канале!");
        })
        .catch(err => {
          // Перехватит ошибку, если syncTopContactsHistory упадет
          console.error("❌ Ошибка синка историй:", err);
        });
          }
        })
        .catch(err => {
          console.error('Критическая ошибка при восстановлении P2P:', err);
        });
    }
  }, []);

  return (
    <>
      <Router>
        <NetworkOverlay />
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.message}</div>
        ))}
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
    </>
  );
}

export default App;