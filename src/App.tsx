import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Auth from './pages/Auth';
import Chat from './pages/Chat';
import Contacts from './pages/Contacts';
import { ProtectedRoute } from './components/ProtectedRoute.js';

function App() {
  return (
    <Router>
      <Routes>
        {/* Свободная зона: сюда пускаем всех */}
        <Route path="/" element={<Auth />} />
        
        {/* Защищенная зона: если нет ключей, роутер сам выкинет на "/" */}
        <Route 
          path="/chat/:contactName" 
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