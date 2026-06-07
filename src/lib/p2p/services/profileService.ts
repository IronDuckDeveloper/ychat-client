
/* * Этот файл отвечает за инициализацию базы данных профиля пользователя в OrbitDB.
  * Здесь мы создаем или открываем базу данных типа keyvalue, которая будет хранить информацию о пользователе, 
  * такую как никнейм, статус и другие настройки.
  * База данных профиля будет привязана к Identity, которая создается на основе seed-фразы, 
  * что обеспечивает безопасность и приватность данных пользователя.
  * В дальнейшем мы будем использовать эту базу для хранения и управления данными профиля, 
  * а также для синхронизации с другими пользователями в сети.
  * 
  * const myName = await profileDb.get(CONFIG.PROFILE.KEY_NICKNAME);
  * 
  * await profileDb.put(CONFIG.PROFILE.KEY_NICKNAME, 'Новый Крутой Ник');
*/

import { IPFSAccessController } from '@orbitdb/core';
import { CONFIG } from "../config.ts";

export async function initProfileDB(orbitdb: any, nicknameForRegistration?: string) {
  try {
    console.log(`👤 [ProfileDB] Инициализация базы профиля...`);

    // 1. Создаем/Открываем базу с жестким контролем доступа
    const profileDb = await orbitdb.open(CONFIG.PROFILE.DB_PROFILE, {
      type: 'keyvalue',
      // Явно указываем, что писать в базу может ТОЛЬКО владелец текущего Identity
      AccessController: IPFSAccessController({ write: [orbitdb.identity.id] }) 
    });

    console.log(`✅ [ProfileDB] База открыта. Адрес: ${profileDb.address}`);
    console.log(`🔒 [ProfileDB] Право на запись только у: ${orbitdb.identity.id}`);

    // 2. Заполнение базовых данных
    const existingNickname = await profileDb.get(CONFIG.PROFILE.KEY_NICKNAME);

    if (!existingNickname) {
      console.log(`🆕 [ProfileDB] Данные профиля пусты. Заполняем...`);
      
      // Эти операции пройдут успешно, так как наш Identity совпадает с AccessController
      await profileDb.put(CONFIG.PROFILE.KEY_NICKNAME, nicknameForRegistration || 'Анонимный пользователь');
      await profileDb.put(CONFIG.PROFILE.KEY_DATE_CREATED, Date.now());

      console.log(`✅ [ProfileDB] Базовые данные успешно записаны.`);
    } else {
      console.log(`♻️ [ProfileDB] Профиль восстановлен: ${existingNickname}`);
    }

    return profileDb;
  } catch (error) {
    console.error('❌ [ProfileDB] Ошибка инициализации профиля:', error);
    throw error;
  }
}