// App.tsx
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Auth from './pages/Auth';
import Chat from './pages/Chat';
import Contacts from './pages/Contacts';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { useEffect } from 'react';
import { isAuthenticated } from './lib/p2p/crypto/crypto.ts';
// Обрати внимание: добавили импорты broadcastMyProfile и pokeOrbitDbs
import { initializeApp, globalHelia, globalRelayManager, broadcastMyProfile, pokeOrbitDbs } from './lib/p2p/services/authService.ts';
import { NetworkOverlay } from './components/NetworkOverlay.tsx';
import { initNetworkStateMachine } from '../src/lib/p2p/networking/NetworkStateMachine.ts';

function App() {
  useEffect(() => {
    // Если пользователь авторизован, но нода еще не запущена
    if (isAuthenticated() && !globalHelia) {
      console.log('🔄 Запуск P2P сессии...');
      
      initializeApp()
        .then(() => {
          // 🚀 НОДА ЗАПУЩЕНА! ТЕПЕРЬ ВКЛЮЧАЕМ СТЕЙТ-МАШИНУ
          if (globalHelia && globalRelayManager) {
            const stateMachine = initNetworkStateMachine({
              libp2p: globalHelia.libp2p,
              relayManager: globalRelayManager,
              broadcastMyProfile: broadcastMyProfile,
              pokeOrbitDbs: pokeOrbitDbs
            });
            
            // Запускаем контроль сети
            stateMachine.start();
            console.log('🛡️ [App] Network State Machine успешно запущена и следит за сетью.');
          }
        })
        .catch(err => {
          console.error('Критическая ошибка при восстановлении P2P:', err);
        });
    }
  }, []);

  return (
    <>
      <NetworkOverlay />
      <Router>
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