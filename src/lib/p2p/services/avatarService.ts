import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';

// Глобальный кэш для текущей сессии (вкладки)
// Ключ: CID (строка), Значение: Object URL (строка)
const avatarCache = new Map<string, string>();

// Хранилище активных промисов загрузки
const pendingFetches = new Map<string, Promise<string | null>>();

// Загрузка файла/Blob в Helia и получение строкового CID
export async function uploadAvatarToHelia(helia: any, file: Blob): Promise<string> {
  const fs = unixfs(helia);
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  
  // addBytes возвращает объект CID
  const cid = await fs.addBytes(bytes);
  console.log(`🖼️ [Helia FS] Аватар загружен. CID: ${cid.toString()}`);
  
  // 🔥 ДОБАВЛЕНО: Сразу кладем наш собственный загруженный аватар в кэш, 
  // чтобы не вытягивать его из базы при следующем рендере
  const localUrl = URL.createObjectURL(file);
  avatarCache.set(cid.toString(), localUrl);
  
  return cid.toString();
}

// Чтение файла из Helia по CID и создание Object URL для тега <img>
export async function fetchAvatarFromHelia(helia: any, cidString: string, timeoutMs = 5000, forceRefresh = false): Promise<string | null> {
  if (!cidString) return null;
  
  if (forceRefresh) {
    avatarCache.delete(cidString);
    console.log(`🗑️ [Cache] Кэш очищен для CID: ${cidString}`);
  }

  // 1. Проверяем готовый кэш
  if (avatarCache.has(cidString)) {
    return avatarCache.get(cidString) || null;
  }
  
  // 🔥 2. ЗАЩИТА ОТ ДВОЙНЫХ ВЫЗОВОВ (Strict Mode Fix)
  // Если аватар УЖЕ в процессе скачивания, просто возвращаем текущий промис
  if (pendingFetches.has(cidString)) {
    return pendingFetches.get(cidString)!; 
  }

  // Оборачиваем всю твою логику загрузки в асинхронную функцию
  const fetchTask = (async () => {
    try {
      const fs = unixfs(helia);
      const cid = CID.parse(cidString);
      const chunks = [];
      console.log(`🖼️ [Helia FS] Загружаем аватар. CID: ${cidString}`);
      
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
      
      for await (const chunk of fs.cat(cid as any, { signal: abortController.signal })) {
        chunks.push(chunk);
      }
      clearTimeout(timeoutId); 
      
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const fullBytes = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        fullBytes.set(chunk, offset);
        offset += chunk.length;
      }
      
      const blob = new Blob([fullBytes], { type: 'image/jpeg' });
      const objectUrl = URL.createObjectURL(blob);
      
      avatarCache.set(cidString, objectUrl);
      return objectUrl;

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn(`⏳ [Helia FS] Таймаут загрузки аватара ${cidString}.`);
      } else {
        console.error(`❌ [Helia FS] Ошибка загрузки аватара ${cidString}:`, error);
      }

      // Твой фоллбэк на HTTP-шлюзы
      const gateways = [`https://ipfs.io/ipfs/${cidString}`, `https://dweb.link/ipfs/${cidString}`];
      for (const gatewayUrl of gateways) {
        try {
          const response = await fetch(gatewayUrl, { signal: AbortSignal.timeout(timeoutMs) });
          if (response.ok) {
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            avatarCache.set(cidString, objectUrl);
            return objectUrl;
          }
        } catch (e) { continue; }
      }
      return null;
    }
  })();

  // Записываем промис в мапу "в работе"
  pendingFetches.set(cidString, fetchTask);

  try {
    // Ждем выполнения
    return await fetchTask;
  } finally {
    // Обязательно удаляем из мапы после успеха или ошибки
    pendingFetches.delete(cidString);
  }
}