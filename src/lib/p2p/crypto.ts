import { generateKeyPairFromSeed } from '@libp2p/crypto/keys'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { CONFIG } from './config';

const STORAGE_KEY = 'browser-private-key'
const SEED_LENGTH = 32

export async function getOrCreatePrivateKey() {
  let stored = localStorage.getItem(STORAGE_KEY);

  if (stored) {
    try {
      const seed = uint8ArrayFromString(stored, 'base64');
      if (seed.length !== SEED_LENGTH) throw new Error('Invalid seed length');
      console.log('✅ Seed восстановлен');
      return await generateKeyPairFromSeed('Ed25519', seed);
    } catch (err) {
      console.warn('⚠️ Seed поврежден, удаляем...');
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  // Если мы дошли сюда — ключа нет (или он был удален из-за ошибки).
  // Начинаем асинхронную очистку баз данных.
  await clearHeliaDatastore();

  // 🛡️ РЕШЕНИЕ ГОНКИ СОСТОЯНИЙ (Race Condition Protection):
  // Пока выполнялся await выше, параллельный useEffect от React Strict Mode 
  // мог уже сгенерировать ключ! Проверяем хранилище еще раз.
  stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    console.log('🔄 Параллельный поток уже создал seed, используем его');
    const seed = uint8ArrayFromString(stored, 'base64');
    return await generateKeyPairFromSeed('Ed25519', seed);
  }

  // Если ключа все еще нет, смело создаем новый
  const seed = crypto.getRandomValues(new Uint8Array(SEED_LENGTH));
  localStorage.setItem(STORAGE_KEY, uint8ArrayToString(seed, 'base64'));
  console.log('🆕 Новый seed создан');
  
  return await generateKeyPairFromSeed('Ed25519', seed);
}

// В браузере можно удалить базу IndexedDB по имени
function clearHeliaDatastore(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.warn('🧹 Очистка старой базы Helia из-за смены ключа...');
    
    // Используем реальные константы из твоего конфига!
    const req1 = indexedDB.deleteDatabase(CONFIG.DATA_DIR);
    const req2 = indexedDB.deleteDatabase(CONFIG.ORBITDB_BLOCKS_DIR);

    let completed = 0;
    const checkDone = () => {
      completed++;
      if (completed === 2) resolve(); // Успешно удалили обе базы
    };

    req1.onsuccess = checkDone;
    req2.onsuccess = checkDone;

    req1.onerror = () => {
      console.error('❌ Не удалось удалить datastore');
      reject(new Error('Failed to delete datastore'));
    };
    req2.onerror = () => {
      console.error('❌ Не удалось удалить blockstore');
      reject(new Error('Failed to delete blockstore'));
    };
  });
}

