import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2p } from '@libp2p/interface';
import { CONFIG, type RelayConfig } from '../config.ts';
import { pipe } from 'it-pipe';
import * as lp from 'it-length-prefixed';
import { peerIdFromString } from '@libp2p/peer-id';

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

  // Получить весь текущий пул для перебора при старте
  public getPool(): RelayConfig[] {
    return this.relayPool;
  }

  // Зафиксировать рабочий релей, если старт прошел не с первого в списке
  public setActiveIndex(index: number): void {
    if (index >= 0 && index < this.relayPool.length) {
      this.currentIdx = index;
    }
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
      const stream = await this.libp2p.dialProtocol(targetTarget, CONFIG.TOPICS.ANNOUNCE);
      
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

  // Получить текущий активный релей
  public getActiveRelay(): RelayConfig | null {
    return this.relayPool[this.currentIdx] || null;
  }

  /**
   * Отправляет запрос на регистрацию Архивариусу
   * @returns boolean - успешна ли регистрация
   */
  public async registerWithRelay(
    libp2p: Libp2p,
    relayPeerIdString: string,
    profileDbAddress: string,
    fingerprint: string,
    ipAddress: string
  ): Promise<boolean> {

    try {
      console.log(`🔄 [RPC] Отправляем запрос Архивариусу: ${relayPeerIdString.slice(-6)}...`);
      
      const relayPeerId = peerIdFromString(relayPeerIdString);
      const stream = await libp2p.dialProtocol(relayPeerId, CONFIG.TOPICS.RPC_PROTOCOL);

      const payload = JSON.stringify({
        action: 'REGISTER',
        profileDbAddress: profileDbAddress,
        fingerprint: fingerprint,
        ipAddress: ipAddress
      });

      // ==========================================
      // 1. ОТПРАВКА ДАННЫХ (Глушим типы pipe полностью)
      // ==========================================
      // Передаем lp.encode БЕЗ скобок. Радикально отключаем проверку типов пайпа.
      await (pipe as any)(
        [new TextEncoder().encode(payload)],
        lp.encode,
        stream.sink
      );

      // ==========================================
      // 2. ПОЛУЧЕНИЕ ОТВЕТА
      // ==========================================
      let isSuccess = false;

      // Передаем lp.decode БЕЗ скобок. Полностью изолируем цепочку вывода типов.
      await (pipe as any)(
        stream.source,
        lp.decode,
        async function (source: any) {
          for await (const chunk of source) {
            // chunk гарантированно будет иметь метод .subarray() в рантайме
            const responseString = new TextDecoder().decode(chunk.subarray());
            const response = JSON.parse(responseString);
            
            console.log('📬 [RPC] Ответ Архивариуса:', response);
            
            if (response.status === CONFIG.MSG.SUCCESS) {
              isSuccess = true;
              console.log(`✅ [RPC] Успешная регистрация: ${response.message}`);
            } else if (response.status === CONFIG.MSG.FORBIDDEN) { 
              isSuccess = false;
              console.error(`🚨 [RPC] Отказ в регистрации: ${response.message}`);
            } else {
              console.error(`🚨 [RPC] Неизвестный статус: ${response.status}`);
            }
            break; // Нужен только один пакет
          }
        }
      );

      await stream.close();
      return isSuccess;
    } catch (error: any) {
      console.error('❌ [RPC Error] Ошибка связи с Архивариусом:', error);
      // РАДИКАЛЬНОЕ РЕШЕНИЕ: вместо return false кидаем ошибку сети наверх
      throw new Error(`Сбой связи с Архивариусом: ${error.message || error}`);
    }
  }
}