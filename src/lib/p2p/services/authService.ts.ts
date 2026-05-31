// src/lib/p2p/services/initService.ts
import { createBrowserHelia } from '../networking/heliaClient.ts';
import { getOrbitDB } from '../orbit/client.ts';
import { initProfileDB } from './profileService.ts';
import { generateDeviceFingerprint, getClientIpAddress } from '../utils/fingerprint.ts';
import { CONFIG } from '../config.ts';

// Сохраняем глобальные инстансы
export let globalHelia: any = null;
export let globalOrbitDB: any = null;
export let globalProfileDb: any = null;

// Нам понадобится способ оповестить компоненты об изменении
let dbReadyCallbacks: (() => void)[] = [];
export const onDbReady = (callback: () => void) => {
  if (globalProfileDb) {
    callback();
  } else {
    dbReadyCallbacks.push(callback);
  }
};

// Флаг блокировки
let isInitializing = false;

export async function initializeApp(nicknameForRegistration?: string) {
  // Если уже инициализировано — просто возвращаем готовые инстансы
  if (globalHelia && globalProfileDb) {
    console.log('⚡️ [Init] P2P узел уже запущен, пропускаем повторную инициализацию.');
    return { helia: globalHelia, orbitdb: globalOrbitDB, profileDb: globalProfileDb };
  }

  // Если процесс УЖЕ идет прямо сейчас (React Strict Mode вызвал функцию дважды) — прерываем дубликат
  if (isInitializing) {
    console.log('⏳ [Init] Инициализация уже в процессе, блокируем дублирующий вызов...');
    return;
  }

  isInitializing = true; // Закрываем замок

  try {
    console.log('🚀 [Init] Запуск IPFS узла и баз данных...');

    // 1. Поднимаем IPFS (Helia)
    globalHelia = await createBrowserHelia();
    // 2. Поднимаем OrbitDB
    globalOrbitDB = await getOrbitDB(globalHelia);
    // 3. Открываем профиль
    globalProfileDb = await initProfileDB(globalOrbitDB);

    const libp2p = (globalHelia as any).libp2p as any;
    const pubsub = libp2p.services.pubsub;

    if (!pubsub) {
      throw new Error('PubSub service is not available on libp2p node');
    }

    // Подписываем клиента на входящие запросы синхронизации релеев
    await pubsub.subscribe(CONFIG.TOPICS.PEER_SYNC_REQUEST_TOPIC);

    // Оригинальный логгер для траблшутинга (оставляем как есть!)
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

    // 4. Если это первая регистрация — записываем имя
    if (nicknameForRegistration) {
      console.log(`📝 [Init] Сохраняем никнейм: ${nicknameForRegistration}`);

      // Собираем IP и Fingerprint прямо в момент создания
      const fingerprint = await generateDeviceFingerprint();
      const ipAddress = await getClientIpAddress();
      
      await globalProfileDb.put(CONFIG.KEY_NICKNAME, nicknameForRegistration);
      await globalProfileDb.put(CONFIG.KEY_DATE_CREATED, Date.now());
      await globalProfileDb.put(CONFIG.KEY_FINGERPRINT, fingerprint);
      await globalProfileDb.put(CONFIG.KEY_IP_ADDRESS, ipAddress);
    }

    console.log('✅ [Init] Инициализация успешно завершена!');

    dbReadyCallbacks.forEach(cb => cb());
    dbReadyCallbacks = []; // очищаем

    return { helia: globalHelia, orbitdb: globalOrbitDB, profileDb: globalProfileDb };

  } catch (error) {
    console.error('❌ [Init] Ошибка инициализации:', error);
    throw error;
  } finally {
    isInitializing = false; // Открываем замок в любом случае (успех или ошибка)
  }
}