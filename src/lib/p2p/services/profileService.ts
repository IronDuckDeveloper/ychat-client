
/* * Этот файл отвечает за инициализацию базы данных профиля пользователя в OrbitDB.
  * Здесь мы создаем или открываем базу данных типа keyvalue, которая будет хранить информацию о пользователе, 
  * такую как никнейм, статус и другие настройки.
  * База данных профиля будет привязана к Identity, которая создается на основе seed-фразы, 
  * что обеспечивает безопасность и приватность данных пользователя.
  * В дальнейшем мы будем использовать эту базу для хранения и управления данными профиля, 
  * а также для синхронизации с другими пользователями в сети.
  * 
  * const myName = await profileDb.get('nickname');
  * 
  * await profileDb.put('nickname', 'Новый Крутой Ник');
*/

export async function initProfileDB(orbitdb: any) {
  try {
    // В OrbitDB v3 мы передаем имя или адрес. 
    // Строка 'user-profile' создаст базу локально и привяжет к текущей Identity.
    const dbName = 'user-profile';

    console.log(`👤 [ProfileDB] Открываем базу профиля...`);

    // Открываем или создаем базу данных
    const profileDb = await orbitdb.open(dbName, {
      type: 'keyvalue',
    });

    console.log(`✅ [ProfileDB] База профиля успешно открыта!`);
    console.log(`📍 [ProfileDB] Адрес базы: ${profileDb.address}`);

    // Проверяем, есть ли уже никнейм в базе (например, при восстановлении по seed-фразе)
    const existingNickname = await profileDb.get('nickname');
    
    if (!existingNickname) {
      // Если профиль новый, задаем дефолтные значения
      console.log(`🆕 [ProfileDB] Новый профиль. Устанавливаем дефолтный никнейм.`);
      await profileDb.put('nickname', 'Анонимный пользователь');
      // Здесь же можно добавить дату создания, статус и т.д.
      await profileDb.put('createdAt', Date.now());
    } else {
      console.log(`♻️ [ProfileDB] Восстановлен профиль: ${existingNickname}`);
    }

    return profileDb;
  } catch (error) {
    console.error('❌ [ProfileDB] Ошибка при создании базы профиля:', error);
    throw error;
  }
}