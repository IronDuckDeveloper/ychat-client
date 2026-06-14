import React, { useState, useEffect, useRef } from 'react';
import { globalNetworkState, NET_STATE } from '../lib/p2p/networking/NetworkStateMachine';
import '../styles/NetworkOverlay.scss'; // Импортируем вынесенные стили


export const NetworkOverlay: React.FC = () => {
  const [status, setStatus] = useState(globalNetworkState?.state || NET_STATE.CONNECTING);
  const wasSleeping = useRef(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const trySubscribe = () => {
      if (globalNetworkState && !unsubscribe) {
        unsubscribe = globalNetworkState.subscribe((newState) => {
          setStatus(newState);

          if (newState === NET_STATE.SLEEPING || newState === NET_STATE.RECOVERING) {
            wasSleeping.current = true;
          }

          if (newState === NET_STATE.CONNECTED && wasSleeping.current) {
            console.log('🔄 [NetworkOverlay] Сеть восстановлена после сна. Перезагружаем UI...');
            window.location.reload();
          }
        });
        
        setStatus(globalNetworkState.state);
      }
    };

    trySubscribe();

    const timer = setInterval(() => {
      if (!unsubscribe) trySubscribe();
    }, 500);

    return () => {
      clearInterval(timer);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  if (status === NET_STATE.CONNECTED) return null;

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

  // Весь inline-стиль ушел, остались только классы
  return (
    <div className="network-overlay">
      <div className="spinner">
        {icon}
      </div>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
};