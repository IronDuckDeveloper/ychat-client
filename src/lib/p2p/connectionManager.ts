import type { Libp2p, PeerId  } from '@libp2p/interface';
import { CONFIG } from './config';
import { pipe } from 'it-pipe';


// Функция отправки адреса нашей базы данных на сервер-Архивариус
export async function notifyArchivist(libp2p: Libp2p, peerId: PeerId, dbAddress: string): Promise<void> {
  try {
  
    const stream = await libp2p.dialProtocol(peerId, CONFIG.TOPICS.ANNOUNCE);
    
    // Передаем JSON с адресом базы данных, который так ждет твой сервер!
    const data = new TextEncoder().encode(JSON.stringify({ address: dbAddress }));
    await pipe([data], stream);
    
    console.log(`📡 [Protocol] Адрес базы данных ${dbAddress} отправлен Архивариусу ${peerId.toString().slice(-6)}`);
  } catch (err: any) {
    console.error('❌ Ошибка отправки анонса Архивариусу:', err.message);
  }
}