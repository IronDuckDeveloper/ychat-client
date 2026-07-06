import type { Libp2p, PeerId } from '@libp2p/interface';
import { CONFIG } from '../config.ts';
import { pipe } from 'it-pipe';
import type { Helia } from 'helia';

// Функция отправки адреса нашей базы данных на сервер-Архивариус
export async function notifyArchivist(
  libp2p: Libp2p,
  peerId: PeerId,
  dbAddress: string,
): Promise<void> {

  if (!libp2p || !peerId) return;

  const myIdStr = libp2p.peerId.toString();
  const targetIdStr = peerId.toString();

  // 🔥 Защита от ошибки "Tried to dial self"
  if (targetIdStr === myIdStr) {
    console.warn(`⚠️ [ConnectionManager] Отмена: попытка отправить анонс самому себе.`);
    return; // Пропускаем, не вызывая ошибку сети
  }
  
  try {
    const stream = await libp2p.dialProtocol(peerId, CONFIG.TOPICS.ANNOUNCE);

    // Передаем JSON с адресом базы данных, который так ждет твой сервер!
    const data = new TextEncoder().encode(
      JSON.stringify({ address: dbAddress }),
    );
    await pipe([data], stream);

    console.log(
      `📡 [Protocol] Адрес базы данных ${dbAddress} отправлен Архивариусу ${peerId.toString().slice(-6)}`,
    );
  } catch (err: any) {
    console.error('❌ Ошибка отправки анонса Архивариусу:', err.message);
  }
}

// === Функция синхронизации кэша релеев ===
export async function checkAndSyncRelays(helia: Helia): Promise<void> {
  const lastSync = localStorage.getItem('last_peer_sync');
  const now = Date.now();

  if (!lastSync || now - parseInt(lastSync, 10) > CONFIG.SYNC_INTERVAL_MS) {
    const libp2p = (helia as any).libp2p as unknown as Libp2p;
    const pubsub = (libp2p.services as any).pubsub;
    if (!pubsub) return;

    const myPeerId = libp2p.peerId.toString();
    const responseTopic = `${CONFIG.TOPICS.PEER_SYNC_RESPONSE_BASE}${myPeerId}`;

    const onResponse = async (evt: any) => {
      const msg = evt.detail || evt;
      if (msg.topic !== responseTopic) return;
      try {
        const payload = JSON.parse(new TextDecoder().decode(msg.data));
        if (payload?.relays) {
          localStorage.setItem('known_relays', JSON.stringify(payload.relays));
          localStorage.setItem('last_peer_sync', Date.now().toString());
          console.log(
            `📥 [PEER-SYNC] Кэш синхронизирован. Релеев: ${payload.relays.length}`,
          );
          pubsub.removeEventListener('message', onResponse);
          await pubsub.unsubscribe(responseTopic);
        }
      } catch (e) {
        console.error('Ошибка парсинга релеев:', e);
      }
    };

    await pubsub.subscribe(responseTopic);
    pubsub.addEventListener('message', onResponse);

    const reqPayload = JSON.stringify({ from: myPeerId });
    await pubsub.publish(
      CONFIG.TOPICS.PEER_SYNC_REQUEST,
      new TextEncoder().encode(reqPayload),
    );

    setTimeout(() => {
      pubsub.removeEventListener('message', onResponse);
      try {
        pubsub.unsubscribe(responseTopic);
      } catch {}
    }, 5000);
  }
}
