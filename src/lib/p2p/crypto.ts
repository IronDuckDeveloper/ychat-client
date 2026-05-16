import { privateKeyFromRaw, generateKeyPair } from '@libp2p/crypto/keys';
import type { PrivateKey } from '@libp2p/interface';
import { CONFIG } from './config';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

export async function getOrCreatePrivateKey(): Promise<any> {
  const savedPrivateKeyHex = localStorage.getItem(CONFIG.BROWSER_KEY_HEX);

  if (savedPrivateKeyHex) {
    try {
      const rawPrivateBytes = fromHex(savedPrivateKeyHex);
      const privateKey = privateKeyFromRaw(rawPrivateBytes);
      console.log('✅ Приватный ключ восстановлен из localStorage');
      
      // Двойное приведение, чтобы подружить типы
      return privateKey as unknown as PrivateKey;
    } catch (e: any) {
      console.warn('⚠️ Ошибка восстановления ключа:', e.message);
      localStorage.removeItem(CONFIG.BROWSER_KEY_HEX);
    }
  }

  const key = await generateKeyPair('Ed25519');
  localStorage.setItem(CONFIG.BROWSER_KEY_HEX, toHex(key.raw));
  console.log('🚀 Сгенерирован новый приватный ключ');
  
  // Двойное приведение и для нового ключа
  return key as unknown as PrivateKey;
}