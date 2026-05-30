import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { CONFIG } from './config';

const STORAGE_KEY = 'browser-private-key';
const SEED_LENGTH = 32;

// 1. НОВАЯ ФУНКЦИЯ: Вызывается из Auth.tsx при успешном Входе/Регистрации
export async function saveSeedFromAuth(seed: Uint8Array) {
  if (seed.length !== SEED_LENGTH) throw new Error('Invalid seed length');
  
  // Очищаем старые базы OrbitDB/Helia, так как заходит (или регистрируется) новый профиль
  await clearHeliaDatastore();
  
  // Сохраняем seed в localStorage
  localStorage.setItem(STORAGE_KEY, uint8ArrayToString(seed, 'base64'));
  console.log('💾 Seed из мнемоники успешно сохранен в хранилище');
}

// 2. ОБНОВЛЕННАЯ ФУНКЦИЯ: Теперь она только читает ключ.
// Вызывается из createBrowserHelia()
export async function getPrivateKey() {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    // Если ключа нет, значит пользователь не авторизован. 
    // Helia не должна запускаться, нужно редиректить на /auth
    throw new Error('NO_KEY_FOUND'); 
  }

  try {
    const seed = uint8ArrayFromString(stored, 'base64');
    if (seed.length !== SEED_LENGTH) throw new Error('Invalid seed length');
    
    console.log('✅ Seed успешно прочитан из хранилища');
    // Эта функция из твоего кода идеально создает Ed25519 ключи
    return await generateKeyPairFromSeed('Ed25519', seed);
  } catch (err) {
    console.warn('⚠️ Seed поврежден, удаляем...');
    localStorage.removeItem(STORAGE_KEY);
    throw new Error('KEY_CORRUPTED');
  }
}

// 3. Твоя функция очистки баз остается без изменений!
export function clearHeliaDatastore(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.warn('🧹 Очистка старой базы Helia из-за смены ключа...');
    
    const req1 = indexedDB.deleteDatabase(CONFIG.DATA_DIR);
    const req2 = indexedDB.deleteDatabase(CONFIG.ORBITDB_BLOCKS_DIR);

    let completed = 0;
    const checkDone = () => {
      completed++;
      if (completed === 2) resolve(); 
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