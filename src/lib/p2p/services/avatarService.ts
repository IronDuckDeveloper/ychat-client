import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';

// Загрузка файла/Blob в Helia и получение строкового CID
export async function uploadAvatarToHelia(helia: any, file: Blob): Promise<string> {
  const fs = unixfs(helia);
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  
  // addBytes возвращает объект CID
  const cid = await fs.addBytes(bytes);
  console.log(`🖼️ [Helia FS] Аватар загружен. CID: ${cid.toString()}`);
  return cid.toString();
}

// Чтение файла из Helia по CID и создание Object URL для тега <img>
export async function fetchAvatarFromHelia(helia: any, cidString: string): Promise<string | null> {
  if (!cidString) return null;
  
  try {
    const fs = unixfs(helia);
    const cid = CID.parse(cidString);
    const chunks = [];
    
    // Асинхронно читаем блоки файла
    for await (const chunk of fs.cat(cid)) {
      chunks.push(chunk);
    }
    
    // Склеиваем байты обратно
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const fullBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      fullBytes.set(chunk, offset);
      offset += chunk.length;
    }
    
    // Превращаем байты в URL, который понимает браузер
    const blob = new Blob([fullBytes], { type: 'image/jpeg' });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error(`❌ [Helia FS] Ошибка загрузки аватара ${cidString}:`, error);
    return null;
  }
}