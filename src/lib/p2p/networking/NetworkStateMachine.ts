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
  public pokeOrbitDbs: () => Promise<void>;
  
  public state: NetState; // Использовали тут
  private watchdogTimer: any;
  private listeners: Set<(state: NetState) => void>; // И тут

  constructor(config: {
    libp2p: any;
    relayManager: any;
    pubsubTopic?: string;
    broadcastMyProfile: () => Promise<void>;
    pokeOrbitDbs: () => Promise<void>;
  }) {
    this.libp2p = config.libp2p;
    this.relayManager = config.relayManager;
    this.pubsubTopic = config.pubsubTopic || CONFIG.TOPICS.WAKEUP_SYNC_TOPIC || 'ychat-global';
    this.broadcastMyProfile = config.broadcastMyProfile;
    this.pokeOrbitDbs = config.pokeOrbitDbs;

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
      if (document.visibilityState !== 'visible' || this.state !== NET_STATE.CONNECTED) return;
      
      try {
        const activeRelay = this.relayManager.getPool()[this.relayManager.getActiveIndex() || 0];
        if (!activeRelay) return;
        
        await this.libp2p.services.ping.ping(peerIdFromString(activeRelay.peerId));
      } catch (err) {
        console.warn('⚠️ [Watchdog] Пинг релея провалился. Запускаем recovery...');
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

    try {
      const activeRelay = this.relayManager.getPool()[this.relayManager.getActiveIndex() || 0];
      let isRelayAlive = false;

      if (activeRelay) {
        try {
          await this.libp2p.services.ping.ping(peerIdFromString(activeRelay.peerId));
          isRelayAlive = true;
        } catch (err) {
          console.warn('⚠️ [Network] Текущий релей не отвечает.');
        }
      }

      if (!isRelayAlive && activeRelay) {
          const { multiaddr } = await import('@multiformats/multiaddr');
          const targetStr = `${activeRelay.address}/p2p/${activeRelay.peerId}`;
          try {
            await this.libp2p.dial(multiaddr(targetStr));
          } catch (e) {
            console.warn('⚠️ [Network] Не удалось восстановить связь с релеем напрямую.');
          }
      }

      try {
        this.libp2p.services.pubsub.subscribe(this.pubsubTopic);
      } catch (e) { /* Игнорируем ошибку */ }

      if (this.broadcastMyProfile) await this.broadcastMyProfile();
      if (this.pokeOrbitDbs) await this.pokeOrbitDbs();

      try {
        const wakeupMsg = new TextEncoder().encode(JSON.stringify({ type: CONFIG.MSG?.WAKEUP || 'WAKEUP' }));
        await this.libp2p.services.pubsub.publish(this.pubsubTopic, wakeupMsg);
      } catch (e) {
        console.warn('⚠️ [Network] Не удалось отправить WAKEUP');
      }

      setTimeout(() => {
        if (this.pokeOrbitDbs) this.pokeOrbitDbs();
      }, 3000);

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