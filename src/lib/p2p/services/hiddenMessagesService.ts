import { IPFSAccessController } from '@orbitdb/core';
import { CONFIG } from '../config.ts';

let hiddenMessagesDb: any = null;
let hiddenIdsCache = new Set<string>();

export async function initHiddenMessagesDB(orbitdb: any) {
  console.log('🙈 [HiddenMessagesDB] Инициализация базы локально скрытых сообщений...');

  hiddenMessagesDb = await orbitdb.open(CONFIG.PROFILE.DB_HIDDEN_MESSAGES, {
    type: 'keyvalue',
    AccessController: IPFSAccessController({ write: [orbitdb.identity.id] }),
  });

  const all = await hiddenMessagesDb.all(); // [{key, value, hash}]
  hiddenIdsCache = new Set(all.map((e: any) => e.key));

  hiddenMessagesDb.events.on('update', async () => {
    try {
      const fresh = await hiddenMessagesDb.all();
      hiddenIdsCache = new Set(fresh.map((e: any) => e.key));
      console.log(`🔄 [HiddenMessagesDB] Кэш обновлён (${hiddenIdsCache.size} записей) — вероятно, синк с другого устройства.`);
    } catch (err) {
      console.error('❌ [HiddenMessagesDB] Ошибка обновления кэша:', err);
    }
  });

  console.log(`✅ [HiddenMessagesDB] Готово. Адрес: ${hiddenMessagesDb.address.toString()}`);
  return hiddenMessagesDb;
}

export const isHiddenLocally = (msgId: string): boolean => hiddenIdsCache.has(msgId);

export async function hideMessageLocally(msgId: string): Promise<void> {
  if (!hiddenMessagesDb) {
    console.warn('⚠️ [HiddenMessagesDB] База ещё не инициализирована, скрытие пропущено.');
    return;
  }

  hiddenIdsCache.add(msgId); // мгновенно — не ждём подтверждения записи для UI

  try {
    await hiddenMessagesDb.put(msgId, true);
  } catch (err: any) {
    console.error(`❌ [HiddenMessagesDB] Ошибка записи скрытия для ${msgId}:`, err?.message || err);
  }
}