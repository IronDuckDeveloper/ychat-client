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

function App() {
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

      // 1. Включаем фоновые службы сразу (они пассивные, просто ждут ивентов)
      startGlobalNotificationListener(globalHelia, globalContactsDb)
        .catch(err => console.error("❌ Ошибка пуш-нотификатора:", err));

      startBackgroundProfileWatcher(globalContactsDb)
        .catch(err => console.error("❌ Ошибка вотчера профилей:", err));

        console.log(`🚀 [Cold Start] Сеть стабилизировалась. Запускаем синхронизацию историй... db: ${globalContactsDb}`);
        
        syncTopContactsHistory(globalContactsDb, 10)
          .then(() => console.log("✅ [Cold Start] Синк историй успешно завершен на горячем канале!"))
          .catch(err => console.error("❌ Ошибка синка историй:", err));
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