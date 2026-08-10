import type { Libp2p, PeerId } from '@libp2p/interface';
import { CONFIG } from '../config.ts';
import { pipe } from 'it-pipe';
import type { Helia } from 'helia';
import { getGlobalRegistryDb } from '../services/profileService.ts';

// Кэш отправленных анонсов: `${peerId}:${dbAddress}` -> timestamp
const recentAnnouncements = new Map<string, number>();
const ANNOUNCE_COOLDOWN_MS = 30_000; // Cooldown 30 секунд

// Функция отправки адреса нашей базы данных на сервер-Архивариус
export async function notifyArchivist(
  libp2p: Libp2p,
  peerId: PeerId,
  dbAddress: string,
): Promise<void> {
  if (!libp2p || !peerId) return;

  const myIdStr = libp2p.peerId.toString();
  const targetIdStr = peerId.toString();

  if (targetIdStr === myIdStr) {
    console.warn(`⚠️ [ConnectionManager] Отмена: попытка отправить анонс самому себе.`);
    return;
  }

  // 1. Проверяем кэш анонсов
  const cacheKey = `${targetIdStr}:${dbAddress}`;
  const now = Date.now();
  const lastSent = recentAnnouncements.get(cacheKey);

  if (lastSent && now - lastSent < ANNOUNCE_COOLDOWN_MS) {
    // Пропускаем дублирующий анонс
    return;
  }

  // Запоминаем попытку
  recentAnnouncements.set(cacheKey, now);

  // Периодическая очистка старого кэша
  if (recentAnnouncements.size > 200) {
    for (const [key, time] of recentAnnouncements.entries()) {
      if (now - time > ANNOUNCE_COOLDOWN_MS) recentAnnouncements.delete(key);
    }
  }

  try {
    const stream = await libp2p.dialProtocol(peerId, CONFIG.TOPICS.ANNOUNCE, {
      runOnTransientConnection: true,
    });

    const data = new TextEncoder().encode(
      JSON.stringify({ address: dbAddress }),
    );
    await pipe([data], stream);

    console.log(
      `📡 [Protocol] Адрес базы данных ${dbAddress} отправлен Архивариусу ${peerId.toString().slice(-6)}`,
    );
  } catch (err: any) {
    // При ошибке сбрасываем кэш, чтобы следующий вызов мог попытаться снова
    recentAnnouncements.delete(cacheKey);
    console.error('❌ Ошибка отправки анонса Архивариусу:', err.message);
  }
}

// === Функция синхронизации кэша релеев ===
export async function checkAndSyncRelays(helia: Helia, force = false): Promise<void> {
  const lastSync = localStorage.getItem(CONFIG.KEY_LAST_PEER_SYNC);
  const now = Date.now();

  const needsSync = force || !CONFIG.GLOBAL_REGISTRY_ADDRESS || !lastSync || (now - parseInt(lastSync, 10) > CONFIG.SYNC_INTERVAL_MS);

  if (!needsSync) return;

  const libp2p = (helia as any).libp2p as unknown as Libp2p;
  const pubsub = (libp2p.services as any).pubsub;
  if (!pubsub) return;

  const myPeerId = libp2p.peerId.toString();
  const responseTopic = `${CONFIG.TOPICS.PEER_SYNC_RESPONSE_BASE}`;

  return new Promise<void>((resolve) => {
    let isResolved = false;
    let attempt = 0;
    const maxAttempts = 5;
    let retryTimer: any = null;

    const cleanup = () => {
      isResolved = true;
      if (retryTimer) clearInterval(retryTimer);
      pubsub.removeEventListener('message', onResponse);
      try {
        pubsub.unsubscribe(responseTopic);
      } catch {}
    };

  const onResponse = async (evt: any) => {
    const msg = evt.detail || evt;
    if (msg.topic !== responseTopic) return;
    try {
      const payload = JSON.parse(new TextDecoder().decode(msg.data));
      
      // 🔥 Если ответ пришел не нам — игнорируем
      if (payload?.to && payload.to !== myPeerId) return;

      if (payload?.relays) {
        localStorage.setItem(CONFIG.KEY_KNOWN_RELAYS, JSON.stringify(payload.relays));
        localStorage.setItem(CONFIG.KEY_LAST_PEER_SYNC, Date.now().toString());
        console.log(`📥 [PEER-SYNC] Кэш синхронизирован. Релеев: ${payload.relays.length}`);
      }

      if (payload?.globalRegistryAddress) {
        localStorage.setItem(CONFIG.KEY_GLOBAL_REGISTRY_ADDRESS, payload.globalRegistryAddress);
        CONFIG.GLOBAL_REGISTRY_ADDRESS = payload.globalRegistryAddress;
        console.log(`📇 [PEER-SYNC] Получен адрес глобального реестра: ${payload.globalRegistryAddress}`);
        getGlobalRegistryDb().catch(() => {});
      }

      cleanup();
      resolve();
    } catch (e) {
      console.error('Ошибка парсинга ответа PEER-SYNC:', e);
    }
  };

    // 1. Подписываемся синхронно (без .then!)
    pubsub.subscribe(responseTopic);
    pubsub.addEventListener('message', onResponse);

    // 2. Функция отправки запроса с повторами
    const sendRequest = async () => {
      if (isResolved || attempt >= maxAttempts) {
        if (!isResolved) {
          console.warn(`⚠️ [PEER-SYNC] Не удалось получить ответ от Архивариуса за ${maxAttempts} попыток.`);
          cleanup();
          resolve();
        }
        return;
      }

      attempt++;
      console.log(`📡 [PEER-SYNC] Запрос данных у Архивариуса (попытка ${attempt}/${maxAttempts})...`);
      const reqPayload = JSON.stringify({ from: myPeerId });
      try {
        await pubsub.publish(
          CONFIG.TOPICS.PEER_SYNC_REQUEST,
          new TextEncoder().encode(reqPayload),
        );
      } catch (e) {
        console.warn(`⚠️ [PEER-SYNC] Ошибка публикации PEER_SYNC_REQUEST:`, e);
      }
    };

    // 🔥 Даем Gossipsub 600 мс на построение меша перед первой отправкой
    setTimeout(sendRequest, 600);

    // 🔥 Если ответ не пришел, повторяем каждые 3 секунды
    retryTimer = setInterval(sendRequest, 3000);
  });
}
