import {
  uploadFileToHelia,
  fetchFileFromHelia,
  deleteFileFromHelia,
  type FileAttachment
} from './fileService';

/**
 * Загрузка аватара в Helia и Kubo через fileService.
 * 
 * - Приводит файл к единому имени 'avatar.webp' и MIME-типу 'image/webp'.
 * - Если переданы oldCid / oldServerCid, предварительно удаляет старый аватар,
 *   очищая кэши браузера и открепляя файл на сервере Kubo.
 */
export async function uploadAvatarToHelia(
  helia: any,
  fileOrBlob: Blob | File,
  oldCid?: string,
  oldServerCid?: string,
  serverRelays?: string[],
): Promise<FileAttachment> {
  // 1. Удаляем старый аватар (если был), чтобы не мусорить в Kubo и кэше
  if (oldCid) {
    try {
      await deleteFileFromHelia(helia, oldCid, oldServerCid, serverRelays);
    } catch (err) {
      console.warn(`⚠️ [AvatarService] Не удалось удалить старый аватар:`, err);
    }
  }

  // 2. Оборачиваем Blob в File
  const avatarFile = fileOrBlob instanceof File
    ? fileOrBlob
    : new File([fileOrBlob], 'avatar.webp', { type: 'image/webp' });

  // 3. 🔥 Передаем фиксированное имя 'avatar.webp' в fileService
  return uploadFileToHelia(helia, avatarFile, 'avatar.webp');
}

/**
 * Получение аватара из кэша (RAM -> Cache API) или сети (Kubo Gateway -> P2P).
 * Возвращает Object URL для тега <img>.
 */
export async function fetchAvatarFromHelia(
  helia: any,
  cidString: string,
  timeoutMs = 15000,
  serverCid?: string, 
  encryptionKey?: string,
  forceRefresh = false,
  serverRelays?: string[]
): Promise<string | null> {
  if (!cidString) return null;

  // Если требуется принудительное обновление, удаляем старый кэш перед запросом
  if (forceRefresh) {
    console.log(`🗑️ [AvatarService] Принудительная очистка кэша для аватара: ${cidString}`);
    try {
      await deleteFileFromHelia(helia, cidString, serverCid, serverRelays);
    } catch (err) {
      console.warn(`⚠️ [AvatarService] Ошибка при сбросе кэша аватара:`, err);
    }
  }

  // Делегируем скачивание fileService с типом 'image/webp'
  return fetchFileFromHelia(helia, cidString, 'image/webp', serverCid, encryptionKey, timeoutMs, serverRelays);
}

/**
 * Удаление аватара (например, при сбросе на стандартную иконку).
 */
export async function deleteAvatarFromHelia(
  helia: any,
  cidString: string,
  serverCid?: string,
  serverRelays?: string[]
): Promise<boolean> {
  if (!cidString) return false;
  return deleteFileFromHelia(helia, cidString, serverCid, serverRelays);
}