import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { globalNetworkState, NET_STATE } from '../lib/p2p/networking/NetworkStateMachine';
import '../styles/networkOverlay.scss';
import { CONFIG } from '../lib/p2p/config.ts';

export const NetworkOverlay: React.FC = () => {
  // 1. Все хуки вызываем строго здесь, без условий
  const location = useLocation();
  const [status, setStatus] = useState(globalNetworkState?.state || NET_STATE.CONNECTING);
  const wasSleeping = useRef(false);
  const isAuthed = localStorage.getItem(CONFIG.IS_LODING) === 'true';

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const trySubscribe = () => {
      if (globalNetworkState && !unsubscribe) {
        unsubscribe = globalNetworkState.subscribe((newState) => {
          setStatus(newState);
          if (newState === NET_STATE.SLEEPING) wasSleeping.current = true;
          if (newState === NET_STATE.CONNECTED && wasSleeping.current) {
            window.location.reload();
          }
        });
        setStatus(globalNetworkState.state);
      }
    };
    trySubscribe();
    const timer = setInterval(() => { if (!unsubscribe) trySubscribe(); }, 500);
    return () => {
      clearInterval(timer);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // 2. Только ПОСЛЕ вызова всех хуков делаем проверки для рендера
  
  // Не показываем оверлей на странице входа
  if (location.pathname === '/') return null;

  // Не показываем оверлей, если сеть подключена
  if (status === NET_STATE.CONNECTED) return null;

  // Не показываем оверлей при запуске, если юзер уже был залогинен
  if (status === NET_STATE.CONNECTING && isAuthed) return null;

  let title = 'Ожидание сети...';
  let subtitle = 'Пожалуйста, подождите';
  let icon = '⏳';

  switch (status) {
    case NET_STATE.SLEEPING:
      title = 'Спящий режим';
      subtitle = 'Вкладка неактивна, P2P-соединения приостановлены...';
      icon = '💤';
      break;
    case NET_STATE.RECOVERING:
      title = 'Восстановление сети';
      subtitle = 'Переподключение к релеям и базам данных...';
      icon = '🔄';
      break;
    case NET_STATE.CONNECTING:
      title = 'Запуск P2P сети';
      subtitle = 'Инициализация криптографии и хранилищ...';
      icon = '🚀';
      break;
    case NET_STATE.DISCONNECTED:
      title = 'Связь с P2P сетью потеряна';
      subtitle = 'Ищем резервные узлы...';
      icon = '❌';
      break;
  }

  return (
    <div className="network-overlay">
      <div className="spinner">{icon}</div>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
};