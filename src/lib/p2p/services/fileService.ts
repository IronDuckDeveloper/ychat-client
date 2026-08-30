import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';
import { relayManager } from '../networking/heliaClient';
import imageCompression from 'browser-image-compression';
import heic2any from 'heic2any';
import { CONFIG } from '../config';
import {LruObjectUrlCache} from '../utils/LruObjectUrlCache.ts';
import { exportKeyToBase64, generateFileKey, importKeyFromBase64 } from '../crypto/crypto.ts';
import { uploadQueue } from '../networking/uploadQueue.ts';
import type { RelayConfig } from '../networking/RelayManager.ts';


// Интерфейс для описания прикрепленного файла, 
// именно этот объект мы будем отправлять в OrbitDB сообщении
export interface FileAttachment {
  cid: string;  // Локальный сид от Helia
  serverCid?: string;   // Сид от Kubo (для удаления с сервера)
  serverRelays?: string[]; // Релеы, которые использовались для загрузки
  name: string;
  type: string; // MIME-тип (например, 'image/jpeg', 'video/mp4', 'application/pdf')
  size: number;
  preview?: string;
  encryptionKey?: string;
}

// Глобальный кэш для файлов сессии
const fileCache = new LruObjectUrlCache(50); // Лимит 50–100 файлов оптимален для комфортного скролла без нагрузки на RAM
const pendingFetches = new Map<string, Promise<string | null>>();

function getGatewayCandidates(serverRelays?: string[]): string[] {
  if (!serverRelays || serverRelays.length === 0) {
    const ip = relayManager.getActiveRelayIp();
    return ip ? [ip] : [];
  }

  // Ищем не только в узком пуле ЭТОГО клиента, но и в полном списке известных
  // релеев из localStorage (его пополняет checkAndSyncRelays) — иначе релей,
  // которого нет в нашем случайном пуле, не найдётся вообще
  const knownRaw = localStorage.getItem(CONFIG.KEY_KNOWN_RELAYS);
  const known: RelayConfig[] = knownRaw ? JSON.parse(knownRaw) : [];
  const allKnown = [...relayManager.getPool(), ...known];

  const ips: string[] = [];
  const seen = new Set<string>();
  for (const peerId of serverRelays) {
    const relay = allKnown.find(r => r.peerId === peerId);
    const ip = relay ? relayManager.getRelayIp(relay) : null;
    if (ip && !seen.has(ip)) {
      ips.push(ip);
      seen.add(ip);
    }
  }

  if (ips.length === 0) {
    const fallbackIp = relayManager.getActiveRelayIp();
    if (fallbackIp) ips.push(fallbackIp);
  }
  return ips;
}

/** ==============================================
 * Загрузка любого файла (File/Blob) в Helia.
 * Возвращает объект с CID и метаданными для отправки в чат.
 ============================================== */
function getUploadErrorMessage(error: Error): string {
  const match = error.message.match(/^UPLOAD_REJECTED_(\d+)$/);
  const status = match ? parseInt(match[1], 10) : 0;
  switch (status) {
    case 401: return 'Не удалось подтвердить личность.';
    case 403: return 'Загрузка запрещена.';
    case 413: return 'Файл слишком большой. Максимальный размер — 20 МБ.';
  }
  switch (error.message) {
    case 'MAX_RETRIES_EXCEEDED': return 'Не удалось загрузить файл после нескольких попыток.';
    case 'ALL_RELAYS_REJECTED': return 'Ни один сервер не принял файл.';
    case 'NO_RELAYS_AVAILABLE': return 'Нет доступных серверов для загрузки.';
    case 'NO_SESSION_TOKEN': return 'Нет активной сессии. Перезайдите в приложение.';
    default: return 'Не удалось загрузить файл. Попробуйте ещё раз.';
  }
}

export async function uploadFileToHelia(helia: any, originalFile: File, customName?: string): Promise<FileAttachment> {
  let file: File;
  try {
    file = await processImageForHelia(originalFile, customName);
  } catch (err) {
    console.warn('[Helia FS] Ошибка конвертации, используем оригинал:', err);
    file = originalFile;
  }

  // Шифрование — без изменений
  const aesKey = await generateFileKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const encryptedBuffer = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, fileBytes);
  const encryptedBytes = new Uint8Array(encryptedBuffer);

  const payloadToUpload = new Uint8Array(iv.length + encryptedBytes.length);
  payloadToUpload.set(iv, 0);
  payloadToUpload.set(encryptedBytes, iv.length);

  const sessionToken = relayManager.getSessionToken();
  if (!sessionToken) {
    const message = 'Нет активной сессии. Перезайдите в приложение.';
    window.dispatchEvent(new CustomEvent('uploadError', { detail: { message, fileName: file.name } }));
    throw new Error('NO_SESSION_TOKEN');
  }

  return new Promise((resolve, reject) => {
    uploadQueue.add({
      file,
      payloadToUpload,
      sessionToken: sessionToken,
      onSuccess: async (serverCid, serverRelays) => {
        try {
          // Регистрируем на сервере файл в бд пир к которому он был загружен
          registerServerFile(serverCid, sessionToken);
          // Сохраняем локально
          const fs = unixfs(helia);
          const cid = await fs.addBytes(payloadToUpload, { rawLeaves: false });
          const cidString = cid.toString();

          const localUrl = URL.createObjectURL(file);
          fileCache.set(cidString, localUrl);
          const tinyPreview = file.type.startsWith('video/')
            ? await generateTinyVideoPreview(file)
            : await generateTinyPreview(file);
          const base64Key = await exportKeyToBase64(aesKey);

          resolve({
            cid: cidString,
            serverCid,
            serverRelays,
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            encryptionKey: base64Key,
            ...(tinyPreview && { preview: tinyPreview }),
          });
        } catch (err) {
          reject(err);
        }
      },
      onFailure: (error) => {
        window.dispatchEvent(new CustomEvent('uploadError', {
          detail: { message: getUploadErrorMessage(error), fileName: file.name }
        }));
        reject(error);
      },
    });
  });
}

async function registerServerFile(cid: string, sessionToken: string): Promise<void> {
  const relayIp = relayManager.getActiveRelayIp();
  if (!relayIp) return;
  try {
    await fetch(`http://${relayIp}:5001/api/register-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
      body: JSON.stringify({ cid }),
    });
  } catch (err) {
    console.warn('⚠️ [Register-File] Не удалось зарегистрировать владельца:', err);
  }
}

//==============================================

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
  timeoutMs = 20000,
  serverRelays?: string[]
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
    const targetCidForGateway = serverCid || cidString;
    const candidateRelays = getGatewayCandidates(serverRelays);

    for (const relayIp of candidateRelays) {
      await serverFetchSemaphore.acquire();
      try {
        const url = `http://${relayIp}:8081/ipfs/${targetCidForGateway}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

        if (response.ok) {
          const arrayBuffer = await (await response.blob()).arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          console.log(`✅ [Kubo Gateway] Успешно скачано с ${relayIp}: ${cidString}`);
          return await decryptAndSave([bytes], mimeType, cidString, encryptionKey);
        }
        console.warn(`⚠️ [Kubo Gateway] ${relayIp} вернул ошибку: ${response.status}`);
      } catch (e: any) {
        console.warn(`⚠️ [Kubo Gateway] Ошибка скачивания с ${relayIp}: ${e.message}`);
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
 * Генерирует экстремально сжатое JPEG-превью первого кадра видео (~2–4 КБ),
 * по аналогии с generateTinyPreview для картинок — для хранения прямо
 * в строке сообщения OrbitDB.
 */
const generateTinyVideoPreview = (file: File): Promise<string | undefined> => {
  return new Promise((resolve) => {
    if (!file.type.startsWith('video/')) {
      return resolve(undefined);
    }

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    // 🔥 На части браузеров (особенно старый WebKit) видео-элемент должен
    // реально существовать в DOM, чтобы корректно грузить метаданные/кадры
    video.style.position = 'fixed';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.style.width = '1px';
    video.style.height = '1px';

    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    let settled = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
    };

    const finish = (result: string | undefined) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    // Защита от зависшего файла/кодека, который браузер не смог декодировать
    const timeoutId = setTimeout(() => finish(undefined), 5000);

    video.onloadedmetadata = () => {
      // Берём кадр не с самого начала (часто чёрный/пустой кадр), а чуть позже
      const seekTo = Math.min(0.5, (video.duration || 1) / 4);
      try {
        video.currentTime = seekTo;
      } catch {
        finish(undefined);
      }
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');

        const MAX_SIZE = 40; // чуть крупнее, чем у картинок (20px) — кадр обычно менее "гладкий"
        let width = video.videoWidth || MAX_SIZE;
        let height = video.videoHeight || MAX_SIZE;

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
        if (!ctx) return finish(undefined);

        ctx.drawImage(video, 0, 0, width, height);
        const base64String = canvas.toDataURL('image/jpeg', 0.4);
        finish(base64String);
      } catch (e) {
        console.warn('[Video Preview] Ошибка захвата кадра:', e);
        finish(undefined);
      }
    };

    video.onerror = () => finish(undefined);

    document.body.appendChild(video);
  });
};

/**
 * Удаляет файл локально (RAM-кэш, Cache API, blockstore Helia) — всегда.
 * Запрос на unpin/gc к серверу отправляется, только если isOwnFile === true —
 * это не защита (сервер всё равно проверит владельца сам), а просто чтобы
 * не тратить впустую сетевой запрос и лимит nginx на заведомо отклоняемый вызов.
 */
export async function deleteFileFromHelia(
  helia: any,
  cidString: string,
  serverCid?: string,
  serverRelays?: string[],
  isOwnFile: boolean = false,
): Promise<boolean> {
  try {
    console.log(`🗑️ [Helia FS] Начинаем удаление файла: ${cidString}`);

    // 1. RAM-кэш — всегда
    fileCache.delete(cidString);
    pendingFetches.delete(cidString);

    // 2. Cache API — всегда
    try {
      const cache = await caches.open(CONFIG.CACHE_NAME_FILES);
      const isDeletedFromCache = await cache.delete(cidString);
      if (isDeletedFromCache) {
        console.log(`✅ [Cache API] Файл удален из хранилища браузера`);
      }
    } catch (cacheError) {
      console.warn(`⚠️ [Cache API] Ошибка при удалении из кэша:`, cacheError);
    }

    // 3. Запрос на сервер — только если это наш файл
    if (isOwnFile) {
      const targetCid = serverCid || cidString;
      const relayIps = getGatewayCandidates(serverRelays);
      const sessionToken = relayManager.getSessionToken();

      if (!sessionToken) {
        console.warn('⚠️ [Delete-File] Нет токена сессии — удаление с сервера пропущено.');
      } else {
        await Promise.allSettled(relayIps.map(async (relayIp) => {
          try {
            const response = await fetch(`http://${relayIp}:5001/api/delete-file`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
              body: JSON.stringify({ cid: targetCid }),
            });
            if (!response.ok) {
              const text = await response.text();
              console.warn(`⚠️ [Delete-File] ${relayIp} отклонил удаление (${response.status}): ${text}`);
            }
          } catch (kuboError) {
            console.error(`❌ [Delete-File] Ошибка обращения к ${relayIp}:`, kuboError);
          }
        }));
      }
    } else {
      console.log(`ℹ️ [Helia FS] Файл ${cidString} не мой — только локальная очистка, без запроса на сервер.`);
    }

    // 4. Локальный blockstore Helia — всегда
    if (helia && helia.blockstore) {
      const cid = CID.parse(cidString);
      await helia.blockstore.delete(cid);
      console.log(`✅ [Helia FS] Блоки файла удалены из локального blockstore.`);
    }

    console.log(`✅ [Helia FS] Локальная очистка ${cidString} завершена.`);
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

/**
 * Проверяет, есть ли в изображении реально используемая прозрачность
 * (не "формат умеет альфу", а хотя бы один не полностью непрозрачный пиксель).
 * Проверяем на уменьшенной копии — так быстрее и для решения "PNG или JPEG" точность не нужна.
 */
async function hasTransparency(imgBlob: Blob): Promise<boolean> {
  const bitmap = await createImageBitmap(imgBlob);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 64 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true; // нашли альфа-канал в деле
  }
  return false;
}

/**
 * Конвертирует Blob (у нас на реле всегда WebP) в формат, пригодный для сохранения
 * на диск: PNG — если есть реальная прозрачность, иначе JPEG.
 * Если конвертация по любой причине не удалась — отдаёт исходный blob как есть.
 */
export async function convertBlobForDownload(
  blob: Blob,
  baseName: string
): Promise<{ blob: Blob; name: string }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob, name: baseName };

    const nameWithoutExt = baseName.replace(/\.\w+$/, '');
    const transparent = await hasTransparency(blob);

    if (transparent) {
      ctx.drawImage(bitmap, 0, 0);
      const pngBlob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (pngBlob) return { blob: pngBlob, name: `${nameWithoutExt}.png` };
    } else {
      // Без альфы — сразу заливаем белым фоном, чтобы не получить чёрный фон при JPEG-рендере
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      const jpegBlob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (jpegBlob) return { blob: jpegBlob, name: `${nameWithoutExt}.jpg` };
    }
  } catch (err) {
    console.warn('[Download Convert] Конвертация не удалась, отдаём WebP как есть:', err);
  }

  return { blob, name: baseName };
}