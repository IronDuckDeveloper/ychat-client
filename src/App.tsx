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
            // 🔥 ВЫЗЫВАЕМ СИНХРОНИЗАЦИЮ ДИНАМИЧЕСКИХ РЕЛЕЕВ И РЕЕСТРА ПРИ СТАРТЕ
              checkAndSyncRelays(globalHelia, true)
                .catch(err => console.error("❌ Ошибка checkAndSyncRelays:", err));

              // 1. Включаем фоновые службы
              startGlobalNotificationListener(globalHelia, globalContactsDb)
                .catch(err => console.error("❌ Ошибка пуш-нотификатора:", err));

              startBackgroundProfileWatcher(globalContactsDb)
                .catch(err => console.error("❌ Ошибка вотчера профилей:", err));

            // 2. Синхронизация историй Нужно ли вызывать здесь если у нас уже есть синк в contacts.tsx? observer.current = new IntersectionObserver((entries)
            setTimeout(() => {
              console.log(`🚀 [Cold Start] Сеть стабилизировалась. Запускаем синхронизацию историй... db: ${globalContactsDb?.address?.toString()}`);
              
              syncTopContactsHistory(globalContactsDb, 10)
                .then(() => console.log("✅ [Cold Start] Синк историй успешно завершен на горячем канале!"))
                .catch(err => console.error("❌ Ошибка синка историй:", err));
            }, 3000);
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