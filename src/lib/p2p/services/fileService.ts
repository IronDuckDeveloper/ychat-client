import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';

// Интерфейс для описания прикрепленного файла, 
// именно этот объект мы будем отправлять в OrbitDB сообщении
export interface FileAttachment {
  cid: string;
  name: string;
  type: string; // MIME-тип (например, 'image/jpeg', 'video/mp4', 'application/pdf')
  size: number;
  preview?: string;
}

// Глобальный кэш для файлов сессии
const fileCache = new Map<string, string>();
const pendingFetches = new Map<string, Promise<string | null>>();

/**
 * Загрузка любого файла (File/Blob) в Helia.
 * Возвращает объект с CID и метаданными для отправки в чат.
 */
export async function uploadFileToHelia(helia: any, file: File): Promise<FileAttachment> {
  const fs = unixfs(helia);
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  
  const cid = await fs.addBytes(bytes);
  const cidString = cid.toString();
  console.log(`📎 [Helia FS] Файл "${file.name}" загружен. CID: ${cidString}`);
  
  // Кэшируем оригинальный файл сразу (чтобы отправитель не качал его сам у себя)
  const localUrl = URL.createObjectURL(file);
  fileCache.set(cidString, localUrl);
  
  // Генерируем микро-превью (если это картинка)
  const tinyPreview = await generateTinyPreview(file);
  
  return {
    cid: cidString,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    ...(tinyPreview && { preview: tinyPreview }) // Добавляем только если сгенерировалось
  };
}

/**
 * Скачивание файла из Helia по CID.
 * Обязательно передаем mimeType, чтобы правильно собрать Blob!
 */
export async function fetchFileFromHelia(
  helia: any, 
  cidString: string, 
  mimeType: string, 
  timeoutMs = 15000 // 👈 Увеличили таймаут для больших файлов до 15 сек
): Promise<string | null> {
  if (!cidString) return null;
  
  if (fileCache.has(cidString)) {
    return fileCache.get(cidString) || null;
  }
  
  if (pendingFetches.has(cidString)) {
    return pendingFetches.get(cidString)!; 
  }

  const fetchTask = (async () => {
    try {
      const fs = unixfs(helia);
      const cid = CID.parse(cidString);
      const chunks = [];
      console.log(`⬇️ [Helia FS] Скачиваем файл... CID: ${cidString}`);
      
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
      
      // Тянем кусочки файла из P2P сети
      for await (const chunk of fs.cat(cid as any, { signal: abortController.signal })) {
        chunks.push(chunk);
      }
      clearTimeout(timeoutId); 
      
      // Склеиваем байты
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const fullBytes = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        fullBytes.set(chunk, offset);
        offset += chunk.length;
      }
      
      // 💥 ВАЖНО: Здесь мы используем mimeType, переданный из сообщения!
      const blob = new Blob([fullBytes], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      
      fileCache.set(cidString, objectUrl);
      return objectUrl;

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn(`⏳ [Helia FS] Таймаут скачивания файла ${cidString}.`);
      } else {
        console.error(`❌ [Helia FS] Ошибка загрузки файла ${cidString}:`, error);
      }

      // Фоллбэк на HTTP-шлюзы (полезно, если пир отключился, но файл успел разлететься по сети)
      const gateways = [`https://ipfs.io/ipfs/${cidString}`, `https://dweb.link/ipfs/${cidString}`];
      for (const gatewayUrl of gateways) {
        try {
          const response = await fetch(gatewayUrl, { signal: AbortSignal.timeout(timeoutMs) });
          if (response.ok) {
            // Браузер сам вытащит Blob с правильным типом из HTTP-заголовков шлюза
            const blob = await response.blob(); 
            const objectUrl = URL.createObjectURL(blob);
            fileCache.set(cidString, objectUrl);
            return objectUrl;
          }
        } catch (e) { continue; }
      }
      return null;
    }
  })();

  pendingFetches.set(cidString, fetchTask);

  try {
    return await fetchTask;
  } finally {
    pendingFetches.delete(cidString);
  }
}

/**
 * Генерирует экстремально сжатое Base64 превью (около 1 КБ)
 * Идеально для хранения прямо в строке БД OrbitDB
 */
const generateTinyPreview = (file: File): Promise<string | undefined> => {
  return new Promise((resolve) => {
    // Делаем превью только для картинок
    if (!file.type.startsWith('image/')) {
      return resolve(undefined);
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      
      // Экстремальное сжатие (максимальный размер стороны - 20px)
      const MAX_SIZE = 20;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_SIZE) {
          height = Math.round(height *= MAX_SIZE / width);
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width = Math.round(width *= MAX_SIZE / height);
          height = MAX_SIZE;
        }
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(undefined);

      ctx.drawImage(img, 0, 0, width, height);
      
      // Экспортируем в JPEG с низким качеством (0.4 = 40%)
      const base64String = canvas.toDataURL('image/jpeg', 0.4);
      resolve(base64String);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(undefined);
    };

    img.src = objectUrl;
  });
};