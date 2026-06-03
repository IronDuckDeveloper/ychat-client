// src/lib/p2p/services/initService.ts
// Добавляем импорт relayManager из твоего клиента!
import { createBrowserHelia, relayManager } from '../networking/heliaClient.ts';
import { getOrbitDB } from '../orbit/client.ts';
import { initProfileDB } from './profileService.ts';
import { generateDeviceFingerprint, getClientIpAddress } from '../utils/fingerprint.ts';
import { CONFIG } from '../config.ts';
import { RelayManager } from '../networking/RelayManager.ts';

export let globalHelia: any = null;
export let globalOrbitDB: any = null;
export let globalProfileDb: any = null;
export let globalRelayManager: RelayManager | null = null;

let dbReadyCallbacks: (() => void)[] = [];
export const onDbReady = (callback: () => void) => {
  if (globalProfileDb) {
    callback();
  } else {
    dbReadyCallbacks.push(callback);
  }
};

let isInitializing = false;

export async function initializeApp(nicknameForRegistration?: string) {
  if (globalHelia && globalProfileDb) {
    console.log('⚡️ [Init] P2P узел уже запущен, пропускаем повторную инициализацию.');
    return { helia: globalHelia, orbitdb: globalOrbitDB, profileDb: globalProfileDb };
  }

  if (isInitializing) {
    console.log('⏳ [Init] Инициализация уже в процессе, блокируем дублирующий вызов...');
    return;
  }

  isInitializing = true;

  try {
    console.log('🚀 [Init] Запуск IPFS узла и баз данных...');

    // 1. Просто привязываем готовый инстанс из heliaClient
    globalRelayManager = relayManager;

    // 2. Поднимаем IPFS (внутри createBrowserHelia уже происходит перебор релеев и запуск мониторинга!)
    globalHelia = await createBrowserHelia();
    
    const libp2p = (globalHelia as any).libp2p as any;

    // 3. Поднимаем OrbitDB и профиль
    globalOrbitDB = await getOrbitDB(globalHelia);
    globalProfileDb = await initProfileDB(globalOrbitDB);

    const pubsub = libp2p.services.pubsub;
    if (!pubsub) {
      throw new Error('PubSub service is not available on libp2p node');
    }

    await pubsub.subscribe(CONFIG.TOPICS.PEER_SYNC_REQUEST_TOPIC);

    // Оригинальный логгер сети
    setInterval(() => {
      if (globalHelia) {
        const allPeers = libp2p.getPeers();
        const pubsubPeers = pubsub.getPeers();
        const topics = pubsub.getTopics();

        console.log(
          `📊 Network: Peers=${allPeers.length} | PubSub=${pubsubPeers.length} | Topics=${JSON.stringify(topics)}`
        );
      }
    }, 5000);

    // ==========================================
    // 4. Логика регистрации С ЧЕСТНЫМ КУВЫРКОМ ПО РЕЛЕЯМ
    // ==========================================
    if (nicknameForRegistration) {
      console.log(`📝 [Init] Сохраняем никнейм: ${nicknameForRegistration}`);

      const fingerprint = await generateDeviceFingerprint();
      const ipAddress = await getClientIpAddress();
      
      await globalProfileDb.put(CONFIG.KEY_NICKNAME, nicknameForRegistration);
      await globalProfileDb.put(CONFIG.KEY_DATE_CREATED, Date.now());
      await globalProfileDb.put(CONFIG.KEY_FINGERPRINT, fingerprint);
      await globalProfileDb.put(CONFIG.KEY_IP_ADDRESS, ipAddress);

      const profileAddressStr = globalProfileDb.address.toString();
      
      const relays = globalRelayManager.getPool();
      let registrationSuccess = false;

      // Бежим по нашему пулу надежности
      for (const relay of relays) {
        try {
          console.log(`⏳ [Init] Пробуем зарегистрироваться через релей: ${relay.name}...`);

          const actionType = nicknameForRegistration ? 'REGISTER' : 'LOGIN';   
          
          // Шлем запрос именно на текущий в итерации relay.peerId
          const isRegistered = await globalRelayManager.registerWithRelay(
            libp2p,
            relay.peerId,
            profileAddressStr,
            fingerprint,
            ipAddress,
            actionType
          );

          // Если регистрация прошла успешно, выходим из цикла и фиксируем этот релей как активный в менеджере
          if (isRegistered) {
            registrationSuccess = true;
            
            // Фиксируем этот рабочий релей как активный в менеджере
            const activeIdx = relays.indexOf(relay);
            globalRelayManager.setActiveIndex(activeIdx);
            
            console.log(`🎉 [Init] Сетевой антифрод успешно пройден на релее ${relay.name}!`);
            break; // Успех! Выходим из цикла перебора релеев
          } else {
            console.warn(`⚠️ [Init] Релей ${relay.name} отклонил регистрацию (лимит), проверяем следующий...`);
          }

        } catch (relayError: any) {
          // Если сервер лежит (как твой старый IP 62.x) — ловим ошибку связи ЗДЕСЬ
          // Цикл НЕ прерывается, код спокойно идет к следующему релею в списке
          console.warn(`⚠️ [Init] Релей ${relay.name} недоступен по сети: ${relayError.message || relayError}`);
        }
      }

      // Если прошли весь цикл и ни один сервер не ответил успехом
      if (!registrationSuccess) {
        throw new Error('Не удалось зарегистрироваться: все релеи сети недоступны или превышен лимит устройств.');
      }
    }

    console.log('✅ [Init] Инициализация успешно завершена!');

    dbReadyCallbacks.forEach(cb => cb());
    dbReadyCallbacks = []; 

    return { helia: globalHelia, orbitdb: globalOrbitDB, profileDb: globalProfileDb };

  } catch (error) {
    console.error('❌ [Init] Ошибка инициализации:', error);

    try {
      console.log('🧹 [Init] Откат изменений: останавливаем базы и узел...');
      if (globalProfileDb) await globalProfileDb.close();
      if (globalOrbitDB) await globalOrbitDB.stop();
      if (globalHelia) await globalHelia.stop();
    } catch (cleanupError) {
      console.error('⚠️ [Init] Ошибка при очистке мусора:', cleanupError);
    }

    // Сбрасываем стейт
    globalHelia = null;
    globalOrbitDB = null;
    globalProfileDb = null;
    globalRelayManager = null;
    isInitializing = false;

    throw error;  // Пробрасываем ошибку дальше в Auth.tsx
  } finally {
    isInitializing = false;
  }
}