import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2p } from '@libp2p/interface';

interface RelayConfig {
  name: string;
  address: string;
  peerId: string;
}

export class RelayManager {
  private relayPool: RelayConfig[] = [];
  private currentIdx: number = 0;
  private libp2p: Libp2p | null = null;
  private isSwitching: boolean = false;

  constructor(allRelaysFromSchema: RelayConfig[], poolSize = 5) {
    // 1. Шафлим весь глобальный список и берем подмножество (например, 5 штук)
    const shuffled = [...allRelaysFromSchema].sort(() => Math.random() - 0.5);
    this.relayPool = shuffled.slice(0, poolSize);
    
    console.log(`📦 [RelayManager] Сформирован пул надежности из ${this.relayPool.length} релеев.`);
  }

  // Получить multiaddr текущего активного релея для начального bootstrap
  public getInitialBootstrapList(): string[] {
    if (this.relayPool.length === 0) return [];
    const r = this.relayPool[0];
    return [`${r.address}/p2p/${r.peerId}`];
  }

  // Привязываем инстанс libp2p после его старта
  public startMonitoring(libp2p: Libp2p, onRelayChanged?: (newRelay: RelayConfig) => void) {
    this.libp2p = libp2p;

    // Слушаем событие отключения пиров
    this.libp2p.addEventListener('peer:disconnect', async (evt) => {
      const disconnectedPeerId = evt.detail.toString();
      const currentActiveRelay = this.relayPool[this.currentIdx];

      // Если отвалился именно тот релей, через который мы сейчас работаем
      if (currentActiveRelay && currentActiveRelay.peerId === disconnectedPeerId) {
        console.warn(`🚨 [RelayManager] Активный релей ${currentActiveRelay.name} отключился!`);
        await this.switchToNextRelay(onRelayChanged);
      }
    });
  }

  /**
 * Проверить, принадлежит ли Peer ID к нашему пулу надежности
 */
  public isRelay(peerId: string): boolean {
  return this.relayPool.some(r => r.peerId === peerId);
}

  /**
   * 📡 ОТПРАВКА АНОНСА КОМНАТЫ НА АКТИВНЫЙ РЕЛЕЙ (Heartbeat)
   */
  public async announceRoom(roomAddress: string): Promise<void> {
    if (!this.libp2p) {
      console.warn('⚠️ [RelayManager] Сбой анонса: libp2p еще не инициализирован.');
      return;
    }

    const currentRelay = this.relayPool[this.currentIdx];
    if (!currentRelay) {
      console.warn('⚠️ [RelayManager] Сбой анонса: нет активного релея в пуле.');
      return;
    }

    try {
      // Строим multiaddr текущего релея
      const targetTarget = multiaddr(`${currentRelay.address}/p2p/${currentRelay.peerId}`);
      
      // Открываем прямой стрим к релею по протоколу анонсов
      const stream = await this.libp2p.dialProtocol(targetTarget, '/p2p-relay/v1/announce');
      
      // Динамически импортируем pipe, чтобы не было проблем с типами ESM
      const { pipe } = await import('it-pipe');
      const encodedAddress = new TextEncoder().encode(roomAddress);
      
      // Пушим адрес в стрим
      await pipe([encodedAddress], stream);
      
      console.log(`💓 [Heartbeat] Анонсирована комната ${roomAddress.slice(-12)} на релей ${currentRelay.name}`);
    } catch (err: any) {
      console.error(`❌ [RelayManager] Ошибка отправки анонса на ${currentRelay.name}:`, err.message);
    }
  }

  // Функция экстренного переключения на запасной релей
  private async switchToNextRelay(onRelayChanged?: (newRelay: RelayConfig) => void) {
    if (this.isSwitching || !this.libp2p) return;
    this.isSwitching = true;

    let success = false;
    let attempts = 0;

    // Крутим цикл по пулу, пока не найдем живой релей
    while (!success && attempts < this.relayPool.length) {
      this.currentIdx = (this.currentIdx + 1) % this.relayPool.length;
      const nextRelay = this.relayPool[this.currentIdx];
      attempts++;

      console.log(`⏳ [RelayManager] Пробуем переключиться на резервный релей: ${nextRelay.name}...`);

      try {
        const targetTarget = multiaddr(`${nextRelay.address}/p2p/${nextRelay.peerId}`);
        
        // Принудительно подключаемся к новому релею налету!
        await this.libp2p.dial(targetTarget, {
          signal: AbortSignal.timeout(5000) // Если за 5 секунд не ответил — пропускаем
        });

        console.log(`✅ [RelayManager] Успешно переключено на резервный релей: ${nextRelay.name}`);
        success = true;
        
        if (onRelayChanged) {
          onRelayChanged(nextRelay);
        }
      } catch (err: any) {
        console.error(`❌ [RelayManager] Не удалось подключиться к резерву ${nextRelay.name}:`, err.message);
      }
    }

    if (!success) {
      console.error('🛑 [RelayManager] Все релеи в пуле недоступны! Ожидание обновления конфига...');
    }
    
    this.isSwitching = false;
  }
}