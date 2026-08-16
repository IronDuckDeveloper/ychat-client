import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';
import { relayManager } from '../networking/heliaClient';
import imageCompression from 'browser-image-compression';
import heic2any from 'heic2any';
import { CONFIG } from '../config';
import {LruObjectUrlCache} from '../utils/LruObjectUrlCache.ts';
import { exportKeyToBase64, generateFileKey, importKeyFromBase64 } from '../crypto/crypto.ts';

// Интерфейс для описания прикрепленного файла, 
// именно этот объект мы будем отправлять в OrbitDB сообщении
export interface FileAttachment {
  cid: string;  // Локальный сид от Helia
  serverCid?: string;   // Сид от Kubo (для удаления с сервера)
  name: string;
  type: string; // MIME-тип (например, 'image/jpeg', 'video/mp4', 'application/pdf')
  size: number;
  preview?: string;
  encryptionKey?: string;
}

// Глобальный кэш для файлов сессии
const fileCache = new LruObjectUrlCache(50); // Лимит 50–100 файлов оптимален для комфортного скролла без нагрузки на RAM
const pendingFetches = new Map<string, Promise<string | null>>();

/**
 * Загрузка любого файла (File/Blob) в Helia.
 * Возвращает объект с CID и метаданными для отправки в чат.
 */
export async function uploadFileToHelia(helia: any, originalFile: File, customName?: string): Promise<FileAttachment> {
  let file: File;
  try {
    file = await processImageForHelia(originalFile, customName);
  } catch (err) {
    console.warn('[Helia FS] Ошибка конвертации, используем оригинал:', err);
    file = originalFile; // fallback
  }

  // 🔐 1. ШИФРОВАНИЕ ФАЙЛА перед загрузкой
  const aesKey = await generateFileKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const arrayBuffer = await file.arrayBuffer();
  const fileBytes = new Uint8Array(arrayBuffer);

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    fileBytes
  );

  const encryptedBytes = new Uint8Array(encryptedBuffer);
  
  // Склеиваем IV (12 байт) и зашифрованный файл
  const payloadToUpload = new Uint8Array(iv.length + encryptedBytes.length);
  payloadToUpload.set(iv, 0);
  payloadToUpload.set(encryptedBytes, iv.length);

  // 2. Загружаем ЗАШИФРОВАННЫЕ байты в локальную Helia
  const fs = unixfs(helia);
  // Отключаем rawLeaves, чтобы сгенерировался правильный CIDv1 (bafy...) формата DAG-PB
  const cid = await fs.addBytes(payloadToUpload, {
    rawLeaves: false
  });
  const cidString = cid.toString();
  console.log(`📎 [Helia FS] Файл "${file.name}" зашифрован и загружен локально. CID: ${cidString}`);

  // Переменная для серверного сида
  let serverCid: string | undefined = undefined; 

  // 3. Прямой Push в Kubo через HTTP API (пушим зашифрованный blob)
  try {
    // Получаем IP текущего активного релея, чтобы пушить файл именно на него
    const relayIp = relayManager.getActiveRelayIp();
    if (relayIp) {
      const formData = new FormData();
      // Оборачиваем зашифрованные байты в Blob
      const encryptedBlobForKubo = new Blob([payloadToUpload], { type: 'application/octet-stream' });
      formData.append('file', encryptedBlobForKubo, file.name); // Кидаем зашифрованный файл

      console.log(`🚀 [Helia FS] Пушим файл напрямую в Kubo на ${relayIp}...`);
      const kuboApiUrl = `http://${relayIp}:5001/api/v0/add?pin=true&cid-version=1&raw-leaves=false`;
      const response = await fetch(kuboApiUrl, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        // Kubo возвращает NDJSON (строки с JSON). Читаем первую строку безопасно:
        const text = await response.text();
        const jsonLine = text.trim().split('\n')[0];
        const result = JSON.parse(jsonLine);
        serverCid = result.Hash; // Забираем сид, который сгенерировал Kubo!
        console.log(`✅ [Helia FS] Файл осел в Kubo! Server CID: ${serverCid}`);
      } else {
        console.warn(`⚠️ [Helia FS] Kubo вернул ошибку при пуше: ${response.status}`);
      }
    } else {
      console.warn(`⚠️ [Helia FS] Нет активного IP релея, пуш в Kubo пропущен.`);
    }
  } catch (error) {
    console.error(`❌ [Helia FS] Ошибка прямого пуша в Kubo:`, error);
    // Не прерываем выполнение! Файл есть локально, чат продолжит работать.
  }

  // 4. Кэшируем ОРИГИНАЛЬНЫЙ (расшифрованный) файл сразу 
  // (чтобы отправитель не качал и не расшифровывал его сам у себя)
  const localUrl = URL.createObjectURL(file);
  fileCache.set(cidString, localUrl);
  
  // Генерируем микро-превью (если это картинка) из оригинала
  const tinyPreview = await generateTinyPreview(file);
  
  // 5. Экспортируем ключ для передачи через OrbitDB
  const base64Key = await exportKeyToBase64(aesKey);

  return {
    cid: cidString,
    serverCid: serverCid, // Отправляем оба сида в OrbitDB
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    encryptionKey: base64Key, // 👈 Ключ отправляется в БД сообщения чата
    ...(tinyPreview && { preview: tinyPreview })
  };
}

// 🚦 ПРОСТОЙ СЕМАФОР ДЛЯ ЗАЩИТЫ СЕРВЕРА ОТ DDOS 
class FetchSemaphore {
  private tasks: (() => void)[] = [];
  private activeCount = 0;
  private maxConcurrent: number;
  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.tasks.push(resolve);
    });
  }

  release(): void {
    this.activeCount--;
    if (this.tasks.length > 0) {
      const next = this.tasks.shift();
      this.activeCount++;
      if (next) next();
    }
  }
}

// Увеличиваем очередь до 5 картинок (хватит для быстрых загрузок чата)
const serverFetchSemaphore = new FetchSemaphore(5); 

/**
 * Универсальная функция сборки и надежного кэширования в браузере.
 */
// Обновленная функция сборки и РАСШИФРОВКИ
async function decryptAndSave(
  chunks: Uint8Array[], 
  mimeType: string, 
  cidString: string, 
  encryptionKey?: string
): Promise<string> {
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const fullBytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    fullBytes.set(chunk, offset);
    offset += chunk.length;
  }

  let finalBytes = fullBytes;

  // 🔓 РАСШИФРОВКА (если передан ключ)
  if (encryptionKey) {
    try {
      const cryptoKey = await importKeyFromBase64(encryptionKey);
      
      // Отделяем IV (первые 12 байт) от ciphertext
      const iv = fullBytes.slice(0, 12);
      const ciphertext = fullBytes.slice(12);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        ciphertext
      );
      finalBytes = new Uint8Array(decryptedBuffer);
      console.log(`🔓 [Crypto] Файл ${cidString} успешно расшифрован`);
    } catch (e) {
      console.error(`❌ [Crypto] Ошибка расшифровки файла ${cidString}:`, e);
      // Если расшифровка не удалась, лучше прервать процесс, иначе получим битый файл
      throw new Error("Decryption failed"); 
    }
  }

  const blob = new Blob([finalBytes], { type: mimeType });
  
  // В Cache API сохраняем УЖЕ РАСШИФРОВАННЫЙ файл
  caches.open(CONFIG.CACHE_NAME_FILES).then(cache => {
    cache.put(cidString, new Response(blob));
  }).catch(e => console.warn("Не удалось сохранить в Cache API", e));

  const objectUrl = URL.createObjectURL(blob);
  fileCache.set(cidString, objectUrl);
  return objectUrl;
}

/**
 * Скачивание файла из Helia по CID.
 */
export async function fetchFileFromHelia(
  helia: any, 
  cidString: string, 
  mimeType: string, 
  serverCid?: string,
  encryptionKey?: string,
  timeoutMs = 20000
): Promise<string | null> {
  if (!cidString) return null;
  
  // 1. Оперативный кэш (RAM)
  if (fileCache.has(cidString)) return fileCache.get(cidString) || null;
  if (pendingFetches.has(cidString)) return pendingFetches.get(cidString)!; 

  const fetchTask = (async () => {
    const cid = CID.parse(cidString);

    // 🔥 ПРИОРИТЕТ 0: Постоянный кэш браузера (МГНОВЕННО)
    try {
      const cache = await caches.open(CONFIG.CACHE_NAME_FILES);
      const cachedResponse = await cache.match(cidString);
      if (cachedResponse) {
        // console.log(`⚡ [Cache API] Картинка загружена моментально. CID: ${cidString}`);
        const blob = await cachedResponse.blob();
        const objectUrl = URL.createObjectURL(blob);
        fileCache.set(cidString, objectUrl);
        return objectUrl;
      }
    } catch (e) {
      console.warn(`⚠️ [Cache API] Ошибка чтения:`, e);
    }

    const fs = unixfs(helia);

    // ПРИОРИТЕТ 0.1: Локальная БД Helia (если мы сами загружали этот файл)
    try {
      if (await helia.blockstore.has(cid)) {
        const chunks = [];
        for await (const chunk of fs.cat(cid as any)) chunks.push(chunk);
        return await decryptAndSave(chunks, mimeType, cidString, encryptionKey);
      }
    } catch (e) { /* Игнорируем */ }

    // 🚀 ПРИОРИТЕТ 1: Gateway серверного Kubo (порт 8081)
    const relayIp = relayManager.getActiveRelayIp();
    if (relayIp) {
      await serverFetchSemaphore.acquire(); 
      
      try {
        const targetCidForGateway = serverCid || cidString;
        // Обращаемся к Gateway по обычному HTTP GET
        const url = `http://${relayIp}:8081/ipfs/${targetCidForGateway}`;
        
        // Метод GET используется по умолчанию, POST тут не нужен!
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }); 
        
        if (response.ok) {
          const arrayBuffer = await (await response.blob()).arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          console.log(`✅ [Kubo Gateway] Успешно скачано: ${cidString}`);
          return await decryptAndSave([bytes], mimeType, cidString, encryptionKey);
        } else {
          console.warn(`⚠️ [Kubo Gateway] Сервер вернул ошибку: ${response.status}`);
        }
      } catch (e: any) {
        // Если ошибка - это AbortError, значит файл просто не найден и Gateway долго думал
        console.warn(`⚠️ [Kubo Gateway] Ошибка скачивания ${cidString}: ${e.message}`);
      } finally {
        serverFetchSemaphore.release(); 
      }
    }

    // ⏳ ПРИОРИТЕТ 2: P2P сеть Helia (Bitswap)
    try {
      const chunks = [];
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 12000); 
      
      for await (const chunk of fs.cat(cid as any, { signal: abortController.signal })) {
        chunks.push(chunk);
      }
      clearTimeout(timeoutId); 
      
      console.log(`✅ [Helia P2P] Успешно скачано: ${cidString}`);
      return await decryptAndSave(chunks, mimeType, cidString, encryptionKey);
    } catch (error: any) {
      console.warn(`⏳ [Helia P2P] Файл недоступен в сети: ${cidString}`);
    }
    
    return null;
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

/**
 * Удаляет файл из локального хранилища Helia, Cache API и удаленного сервера Kubo.
 */
export async function deleteFileFromHelia(helia: any, cidString: string, serverCid?: string): Promise<boolean> {
  try {
    console.log(`🗑️ [Helia FS] Начинаем удаление файла: ${cidString}`);
    
    // 1. Удаляем из оперативного кэша (RAM)
    fileCache.delete(cidString);
    pendingFetches.delete(cidString);

    // 🔥 2. Удаляем из постоянного кэша браузера (Cache API)
    try {
      const cache = await caches.open(CONFIG.CACHE_NAME_FILES);
      const isDeletedFromCache = await cache.delete(cidString);
      if (isDeletedFromCache) {
        console.log(`✅ [Cache API] Файл удален из хранилища браузера`);
      }
    } catch (cacheError) {
      console.warn(`⚠️ [Cache API] Ошибка при удалении из кэша:`, cacheError);
    }

    // 🔥 3. Удаляем (открепляем) файл с удаленного сервера Kubo и запускаем очистку
    try {
      const relayIp = relayManager.getActiveRelayIp();

      // Выбираем, какой сид откреплять (приоритет у серверного)
      const targetCid = serverCid || cidString;

      if (relayIp && targetCid) {
        console.log(`🗑️ [Kubo] Отправляем запрос на unpin файла ${targetCid} на сервере ${relayIp}...`);
        
        // 3.1 Открепляем файл
        const kuboUnpinUrl = `http://${relayIp}:5001/api/v0/pin/rm?arg=${targetCid}`;
        const unpinResponse = await fetch(kuboUnpinUrl, { method: 'POST' });

      if (!unpinResponse.ok) {
          const errorText = await unpinResponse.text();
          // 🔥 Если файл уже откреплен, просто радуемся и идем дальше
          if (errorText.includes("not pinned")) {
            console.log(`✅ [Kubo] Файл ${targetCid} уже был откреплен (или не существовал). Идем дальше.`);
          } else {
            console.warn(`⚠️ [Kubo] Ошибка при unpin. Подробности:`, errorText);
          }
        } else {
          console.log(`✅ [Kubo] Файл ${targetCid} успешно откреплен!`);
        }

        // 3.2 ЗАПУСКАЕМ GC (Сборку мусора) на Kubo. 
        // Без этого Kubo не удалит блоки с жесткого диска до следующей автоматической очистки.
        console.log(`🧹 [Kubo] Запускаем сборку мусора (GC) для окончательного удаления...`);
        const kuboGcUrl = `http://${relayIp}:5001/api/v0/repo/gc`;
        await fetch(kuboGcUrl, { method: 'POST' });
        console.log(`✅ [Kubo] Мусор очищен.`);
      }
    } catch (kuboError) {
      console.error(`❌ [Kubo] Ошибка сети при удалении файла с сервера:`, kuboError);
    }

    // 4. Удаляем блок из локального хранилища Helia
    if (helia && helia.blockstore) {
      const cid = CID.parse(cidString);
      await helia.blockstore.delete(cid);
      console.log(`✅ [Helia FS] Блоки файла удалены из локального blockstore.`);
    }

    console.log(`✅ [Helia FS] Полный цикл удаления ${cidString} успешно завершен.`);
    return true;
  } catch (error) {
    console.error(`❌ [Helia FS] Критическая ошибка при удалении файла ${cidString}:`, error);
    return false;
  }
}

export async function processImageForHelia(
  originalFile: File, 
  customName?: string
): Promise<File> {
  if (!originalFile.type.startsWith('image/') && !originalFile.name.toLowerCase().endsWith('.heic')) {
    return originalFile;
  }

  let fileToCompress = originalFile;

  try {
    // 🔥 Если это HEIC, сначала конвертируем его в JPEG
    if (originalFile.name.toLowerCase().endsWith('.heic') || originalFile.type === 'image/heic') {
      console.log('🔄 Конвертация HEIC в JPEG...');
      const convertedBlob = await heic2any({
        blob: originalFile,
        toType: 'image/jpeg',
        quality: 0.8
      }) as Blob;
      
      // Создаем новый File из Blob
      fileToCompress = new File(
        [convertedBlob], 
        originalFile.name.replace(/\.heic$/i, '.jpeg'), 
        { type: 'image/jpeg' }
      );
    }

    // Дальше стандартное сжатие
    const options = {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: 'image/webp',
      initialQuality: 0.82
    };

    const compressedBlob = await imageCompression(fileToCompress, options);
    const timestamp = Date.now();
    const newName = customName || ("ychat_" + timestamp + ".webp");
    
    return new File([compressedBlob], newName, {
      type: 'image/webp',
      lastModified: timestamp,
    });

  } catch (error) {
    console.error('[Image] Ошибка конвертации/сжатия:', error);
    return originalFile; 
  }
}