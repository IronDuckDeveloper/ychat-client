// src/network/NetworkStateMachine.ts
import { peerIdFromString } from '@libp2p/peer-id';
import { CONFIG } from '../config.ts';

// 1. Заменяем enum на чистый JS-объект с "as const"
export const NET_STATE = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  SLEEPING: 'SLEEPING',
  RECOVERING: 'RECOVERING'
} as const;

// 2. Создаем тип на основе значений объекта для аннотаций в методах
export type NetState = typeof NET_STATE[keyof typeof NET_STATE];

export class NetworkStateMachine {
  // Объявляем типы с использованием нового NetState
  public libp2p: any;
  public relayManager: any;
  public pubsubTopic: string;
  public broadcastMyProfile: () => Promise<void>;
  
  public state: NetState; // Использовали тут
  private watchdogTimer: any;
  private listeners: Set<(state: NetState) => void>; // И тут

  constructor(config: {
    libp2p: any;
    relayManager: any;
    pubsubTopic?: string;
    broadcastMyProfile: () => Promise<void>;
  }) {
    this.libp2p = config.libp2p;
    this.relayManager = config.relayManager;
    this.pubsubTopic = config.pubsubTopic || CONFIG.TOPICS.WAKEUP_SYNC_TOPIC || 'ychat-global';
    this.broadcastMyProfile = config.broadcastMyProfile;

    this.state = NET_STATE.DISCONNECTED;
    this.watchdogTimer = null;
    this.listeners = new Set();

    this._setupBrowserEvents();
  }

  public subscribe(callback: (state: NetState) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private transitionTo(newState: NetState) {
    if (this.state === newState) return;
    console.log(`🚥 [State Machine] Переход: ${this.state} ➡️ ${newState}`);
    this.state = newState;
    
    this.listeners.forEach(cb => cb(this.state));

    if (newState === NET_STATE.CONNECTED) {
      this.startWatchdog();
    } else {
      this.stopWatchdog();
    }
  }

  private _setupBrowserEvents() {
    if (typeof window === 'undefined') return;

    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.transitionTo(NET_STATE.SLEEPING);
      } else if (document.visibilityState === 'visible') {
        if (this.state === NET_STATE.SLEEPING) {
          this.recoverNetwork();
        }
      }
    });

    window.addEventListener('online', () => this.recoverNetwork());
    window.addEventListener('offline', () => this.transitionTo(NET_STATE.DISCONNECTED));
  }

private startWatchdog() {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(async () => {
      // Если вкладка скрыта или мы не в состоянии CONNECTED - ничего не делаем
      if (document.visibilityState !== 'visible' || this.state !== NET_STATE.CONNECTED) return;
      
      try {
        // 1. Проверяем, есть ли вообще соединения
        const connections = this.libp2p.getConnections();
        if (connections.length === 0) {
          console.warn('⚠️ [Watchdog] Нет активных P2P соединений. Запускаем recovery...');
          this.recoverNetwork();
          return;
        }

        // 2. Достаем активный релей (используем ?? чтобы 0 не превратился в false)
        const activeIndex = this.relayManager.getActiveIndex();
        const activeRelay = this.relayManager.getPool()[activeIndex ?? 0];
        
        if (!activeRelay) return;
        
        // 3. Проверяем, есть ли наш релей в списке живых соединений
        const isConnectedToRelay = connections.some((conn: any) => 
          conn.remotePeer.toString() === activeRelay.peerId
        );

        if (isConnectedToRelay) {
          // Если соединение висит в пуле libp2p, значит сокет жив. Дергать ping не обязательно.
          return; 
        }

        // 4. Если в списке соединений релея нет, но другие пиры есть — пробуем достучаться
        console.warn(`⚠️ [Watchdog] Релея ${activeRelay.peerId} нет в прямых коннектах. Пробуем ping...`);
        await this.libp2p.services.ping.ping(peerIdFromString(activeRelay.peerId));

      } catch (err) {
        // Теперь выводим реальную ошибку, чтобы понимать причину
        console.warn('⚠️ [Watchdog] Пинг релея провалился:', err);
        this.recoverNetwork();
      }
    }, 15000);
  }

  private stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  public async recoverNetwork() {
    if (this.state === NET_STATE.RECOVERING) return;
    this.transitionTo(NET_STATE.RECOVERING);

    // 🧹 АМНИСТИЯ: Сбрасываем карантин перед попытками дозвона!
    // Это предотвратит блокировку рабочих релеев Connection Gater'ом.
    if (this.relayManager && typeof this.relayManager.clearQuarantine === 'function') {
      this.relayManager.clearQuarantine();
    }

    try {
      const activeRelay = this.relayManager.getPool()[this.relayManager.getActiveIndex() || 0];
      
      if (activeRelay) {
        try {
          // 1. Сначала пробуем просто пингануть (быстрая проверка)
          await this.libp2p.services.ping.ping(peerIdFromString(activeRelay.peerId));
        } catch (pingErr) {
          console.warn('⚠️ [Network] Пинг релея не прошел, пробуем переподключиться...');
          const { multiaddr } = await import('@multiformats/multiaddr');
          const targetStr = `${activeRelay.address}/p2p/${activeRelay.peerId}`;
          
          try {
            // 2. ЖДЕМ результата дозвона. Это критически важно!
            await this.libp2p.dial(multiaddr(targetStr));
          } catch (dialErr: any) {
            console.warn('⚠️ [Network] Фоновый dial не удался:', dialErr.message);
            
            // 3. ❌ РЕЛЕЙ МЕРТВ. Сбрасываем стейт и заставляем менеджер искать новый!
            this.transitionTo(NET_STATE.DISCONNECTED);
            
            if (this.relayManager.switchToNextRelay) {
              await this.relayManager.switchToNextRelay();
              
              // 🔥 ИСПРАВЛЕНИЕ ЗДЕСЬ:
              // Релей успешно сменился. Запускаем рекавери заново, 
              // чтобы пройти процесс с новым рабочим релеем!
              this.recoverNetwork();
            }
            
            // Прерываем текущий цикл, так как мы запустили новый круг восстановления
            return; 
          }
        }
      }

      // --- ЕСЛИ МЫ ДОШЛИ СЮДА, ЗНАЧИТ СВЯЗЬ С РЕЛЕЕМ УСТАНОВЛЕНА ---

      // 4. Подписываемся на топики
      try {
        this.libp2p.services.pubsub.subscribe(this.pubsubTopic);
      } catch (e) { /* Игнорируем */ }

      // 5. Отправляем профиль
      if (this.broadcastMyProfile) this.broadcastMyProfile().catch(() => {});

      // 6. Пытаемся кинуть WAKEUP
      try {
        const wakeupMsg = new TextEncoder().encode(JSON.stringify({ type: CONFIG.MSG?.WAKEUP || 'WAKEUP' }));
        this.libp2p.services.pubsub.publish(this.pubsubTopic, wakeupMsg).catch(() => {});
      } catch (e) {}

      // 7. Только теперь честно переходим в CONNECTED
      this.transitionTo(NET_STATE.CONNECTED);

    } catch (error) {
      console.error('❌ [Network] Фатальная ошибка восстановления:', error);
      this.transitionTo(NET_STATE.DISCONNECTED);
    }
  }

  public async start() {
    this.transitionTo(NET_STATE.CONNECTING);
    this.transitionTo(NET_STATE.CONNECTED);
  }
}

export let globalNetworkState: NetworkStateMachine | null = null;

export function initNetworkStateMachine(config: any) {
  if (!globalNetworkState) {
    globalNetworkState = new NetworkStateMachine(config);
  }
  return globalNetworkState;
}