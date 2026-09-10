import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { globalNetworkState, NET_STATE } from '../lib/p2p/networking/NetworkStateMachine';
import '../styles/networkOverlay.scss';
import { CONFIG } from '../lib/p2p/config.ts';

export const NetworkOverlay: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const [status, setStatus] = useState(globalNetworkState?.state || NET_STATE.CONNECTING);
  const wasSleeping = useRef(false);
  // const isAuthed = localStorage.getItem(CONFIG.IS_LOADING) === 'true';

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

  if (location.pathname === '/') return null;

  if (status === NET_STATE.CONNECTED) return null;

  // if (status === NET_STATE.CONNECTING && isAuthed) return null;

  let title = t('networkOverlay.waitingTitle');
  let subtitle = t('networkOverlay.waitingSubtitle');
  let icon = '⏳';

  switch (status) {
    case NET_STATE.SLEEPING:
      title = t('networkOverlay.sleepingTitle');
      subtitle = t('networkOverlay.sleepingSubtitle');
      icon = '💤';
      break;
    case NET_STATE.RECOVERING:
      title = t('networkOverlay.recoveringTitle');
      subtitle = t('networkOverlay.recoveringSubtitle');
      icon = '🔄';
      break;
    case NET_STATE.CONNECTING:
      title = t('networkOverlay.connectingTitle');
      subtitle = t('networkOverlay.connectingSubtitle');
      icon = '🚀';
      break;
    case NET_STATE.DISCONNECTED:
      title = t('networkOverlay.disconnectedTitle');
      subtitle = t('networkOverlay.disconnectedSubtitle');
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