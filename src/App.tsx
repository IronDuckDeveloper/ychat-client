import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Auth from './pages/Auth';
import Chat from './pages/Chat';
import Contacts from './pages/Contacts';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { useEffect } from 'react';
import { isAuthenticated } from './lib/p2p/crypto/crypto.ts';
import { initializeApp, globalHelia } from './lib/p2p/services/authService.ts';

function App() {
  useEffect(() => {
    // Если пользователь авторизован, но нода еще не запущена (например, после F5)
    if (isAuthenticated() && !globalHelia) {
      console.log('🔄 Восстановление P2P сессии после перезагрузки...');
      initializeApp().catch(err => {
        console.error('Критическая ошибка при восстановлении P2P:', err);
      });
    }
  }, []);

  return (
    <Router>
      <Routes>
        {/* Свободная зона: сюда пускаем всех */}
        <Route path="/" element={<Auth />} />
        
        {/* Защищенная зона: если нет ключей, роутер сам выкинет на "/" */}
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
  );
}

export default App;