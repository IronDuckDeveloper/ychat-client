import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';

// Глобальный кэш для текущей сессии (вкладки)
// Ключ: CID (строка), Значение: Object URL (строка)
const avatarCache = new Map<string, string>();

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
  
  // 🔥 Если это ручной рефреш — вычищаем старый кэш
  if (forceRefresh) {
    avatarCache.delete(cidString);
    console.log(`🗑️ [Cache] Кэш очищен для CID: ${cidString}`);
  }

  // 🔥 1. Проверяем кэш. Если уже качали — отдаем мгновенно, не дергая сеть.
  if (avatarCache.has(cidString)) {
    return avatarCache.get(cidString) || null;
  }
  
  try {
    const fs = unixfs(helia);
    const cid = CID.parse(cidString);
    const chunks = [];
    console.log(`🖼️ [Helia FS] Загружаем аватар. CID: ${cidString}`);
    
    // 🔥 ДОБАВЛЕНО: 2. Настраиваем таймаут.
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
    console.log(`🖼️ [Helia FS] Загружаем аватар. abortController: ${abortController}`);
    
    // Асинхронно читаем блоки файла
    for await (const chunk of fs.cat(cid as any, { signal: abortController.signal })) {
      chunks.push(chunk);
    }
    
    clearTimeout(timeoutId); 
    
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
    const objectUrl = URL.createObjectURL(blob);
    
    // 🔥 ДОБАВЛЕНО: 3. Сохраняем результат в кэш для будущих обращений
    avatarCache.set(cidString, objectUrl);
    
    return objectUrl;

  } catch (error: any) {
    // Оставляем твои оригинальные логи ошибок
    if (error.name === 'AbortError') {
      console.warn(`⏳ [Helia FS] Таймаут загрузки аватара ${cidString}. Сеть недоступна или блок потерян.`);
    } else {
      console.error(`❌ [Helia FS] Ошибка загрузки аватара ${cidString}:`, error);
    }

    // ==========================================
    // 🔥 4. ФОЛЛБЭК НА ПУБЛИЧНЫЕ HTTP-ШЛЮЗЫ
    // ==========================================
    console.log(`🌐 [Helia FS] Запускаем резервную загрузку через HTTP-шлюзы...`);
    
    const gateways = [
      `https://ipfs.io/ipfs/${cidString}`,
      `https://dweb.link/ipfs/${cidString}`,
      `https://cloudflare-ipfs.com/ipfs/${cidString}`
    ];

    for (const gatewayUrl of gateways) {
      try {
        // Добавляем таймаут и на обычный fetch, чтобы шлюз тоже не висел бесконечно
        const response = await fetch(gatewayUrl, { signal: AbortSignal.timeout(timeoutMs) });
        
        if (response.ok) {
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          
          console.log(`✅ [Helia FS] Аватар спасён через шлюз: ${gatewayUrl}`);
          
          // Обязательно сохраняем в кэш! 
          avatarCache.set(cidString, objectUrl);
          
          return objectUrl;
        }
      } catch (gatewayError) {
        // Если этот адрес недоступен, просто идем к следующему (согласно твоим правилам обработки списков адресов)
        continue; 
      }
    }
    
    console.error(`❌ [Helia FS] Все резервные шлюзы недоступны для CID: ${cidString}`);
    return null;
  }
}