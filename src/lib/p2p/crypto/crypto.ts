import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { CONFIG } from '../config.ts';
import * as bip39 from 'bip39';

// 1. Вызывается из Auth.tsx при успешном Входе/Регистрации
export async function saveSeedFromAuth(seed: Uint8Array) {
  if (seed.length !== CONFIG.SEED_LENGTH) throw new Error('Invalid seed length');

  const newSeedB64 = uint8ArrayToString(seed, 'base64');
  const oldSeedB64 = localStorage.getItem(CONFIG.STORAGE_KEY);

  // Очищаем старые базы ОНЛИ если сид реально изменился (зашел другой профиль)
  if (oldSeedB64 && oldSeedB64 !== newSeedB64) {
    console.warn('🧹 Обнаружен новый аккаунт. Очищаем старую базу Helia...');
    await clearHeliaDatastore();
  } else {
    console.log('🔄 Сид совпадает со старым или это первый вход. Локальный кэш сохранен.');
  }

  // Сохраняем seed в localStorage
  localStorage.setItem(CONFIG.STORAGE_KEY, newSeedB64);
  console.log('💾 Seed из мнемоники успешно сохранен в хранилище');
}

// 2. ОБНОВЛЕННАЯ ФУНКЦИЯ: Теперь она только читает ключ.
// Вызывается из createBrowserHelia()
export async function getPrivateKey() {
  const stored = localStorage.getItem(CONFIG.STORAGE_KEY);

  if (!stored) {
    // Если ключа нет, значит пользователь не авторизован.
    // Helia не должна запускаться, нужно редиректить на /auth
    throw new Error('NO_KEY_FOUND');
  }

  try {
    const seed = uint8ArrayFromString(stored, 'base64');
    if (seed.length !== CONFIG.SEED_LENGTH) throw new Error('Invalid seed length');

    console.log('✅ Seed успешно прочитан из хранилища');
    // Эта функция из твоего кода идеально создает Ed25519 ключи
    return await generateKeyPairFromSeed('Ed25519', seed);
  } catch (err) {
    console.warn('⚠️ Seed поврежден, удаляем...');
    localStorage.removeItem(CONFIG.STORAGE_KEY);
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

// Генерирует массив из 12 слов
export function generateNewMnemonic(): string[] {
  const mnemonic = bip39.generateMnemonic(128);
  return mnemonic.split(' ');
}

// Проверяет, валидна ли фраза
export function isValidMnemonic(wordsArray: string[]): boolean {
  const mnemonicString = wordsArray.join(' ').trim();
  return bip39.validateMnemonic(mnemonicString);
}

// Превращает массив слов в 32-байтный сид для Ed25519
export async function getSeedFromMnemonic(wordsArray: string[]): Promise<Uint8Array> {
  const mnemonicString = wordsArray.join(' ').trim();
  const seedBuffer = await bip39.mnemonicToSeed(mnemonicString);
  const seed64 = new Uint8Array(seedBuffer);
  return seed64.slice(0, 32); // Возвращаем 32 байта
}

// Проверяет, авторизован ли уже пользователь в этом браузере
export function isAuthenticated(): boolean {
  return !!localStorage.getItem(CONFIG.STORAGE_KEY);
}

// Вызывается, если сервер отказал в регистрации, чтобы не плодить "мертвые" профили
export async function clearAuthData() {
  // 1. Удаляем сохраненный сид из памяти браузера
  localStorage.removeItem(CONFIG.STORAGE_KEY);
  
  // 2. Сносим базы IndexedDB, которые успели создаться до ошибки
  try {
    await clearHeliaDatastore();
    console.log('🗑️ [Rollback] Seed и локальные базы успешно удалены.');
  } catch (err) {
    console.error('⚠️ [Rollback] Ошибка при удалении баз:', err);
  }
}

// Вспомогательный хелпер для импорта AES-ключа из байтов сида
async function getSymmetricKey(seedBytes: Uint8Array): Promise<CryptoKey> {
  return await window.crypto.subtle.importKey(
    'raw',
    seedBytes as any, // 👈 Глушим конфликт типов либп2п и браузера
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// Шифрование черного списка
export const encryptBlacklist = async (blacklist: string[]): Promise<string> => {
  const storedSeed = localStorage.getItem(CONFIG.STORAGE_KEY);
  if (!storedSeed) throw new Error('Пользователь не авторизован (нет сида для шифрования)');

  const seedBytes = uint8ArrayFromString(storedSeed, 'base64');
  const cryptoKey = await getSymmetricKey(seedBytes);

  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const jsonStr = JSON.stringify(blacklist);
  const encodedData = new TextEncoder().encode(jsonStr);

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as any },
    cryptoKey,
    encodedData as any
  );

  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const combinedBuffer = new Uint8Array(iv.length + ciphertextBytes.length);
  combinedBuffer.set(iv, 0);
  combinedBuffer.set(ciphertextBytes, iv.length);

  return uint8ArrayToString(combinedBuffer, 'base64'); 
};

// Расшифровка черного списка
export const decryptBlacklist = async (encryptedData: string): Promise<string[]> => {
  const storedSeed = localStorage.getItem(CONFIG.STORAGE_KEY);
  if (!storedSeed) throw new Error('Пользователь не авторизован (нет сида для расшифровки)');

  const seedBytes = uint8ArrayFromString(storedSeed, 'base64');
  const cryptoKey = await getSymmetricKey(seedBytes);

  const combinedBuffer = uint8ArrayFromString(encryptedData, 'base64');

  const iv = combinedBuffer.slice(0, 12);
  const ciphertextBytes = combinedBuffer.slice(12);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    cryptoKey,
    ciphertextBytes as any
  );

  const jsonStr = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(jsonStr);
};
