/**
 * Генерирует уникальный отпечаток браузера/устройства
 * на основе доступной системной информации.
 */
export async function generateDeviceFingerprint(): Promise<string> {
  try {
    // Собираем доступную энтропию из браузера
    const components = [
      navigator.userAgent,
      navigator.language,
      window.screen.colorDepth,
      `${window.screen.width}x${window.screen.height}`,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || 'unknown',
      // @ts-ignore - нестандартное свойство, но полезно для энтропии, если есть
      navigator.deviceMemory || 'unknown'
    ];

    // Формируем единую строку
    const rawString = components.join('|');
    
    // Используем встроенный Web Crypto API для получения SHA-256
    const encoder = new TextEncoder();
    const data = encoder.encode(rawString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    
    // Конвертируем ArrayBuffer в hex-строку
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
  } catch (error) {
    console.error('Ошибка при генерации fingerprint:', error);
    // Фолбэк на случай проблем с Crypto API (например, старый браузер или http без localhost)
    return `fallback-${Date.now().toString(16)}`;
  }
}

/**
 * Получает внешний IP-адрес пользователя через публичный сервис
 */
export async function getClientIpAddress(): Promise<string> {
  try {
    // Используем самый стабильный и быстрый сервис ipify (возвращает чистый текст)
    const response = await fetch('https://api.ipify.org?format=json');
    if (!response.ok) throw new Error('Сеть не ответила');
    
    const data = await response.json();
    return data.ip; // Вернет строку вида "192.168.1.1" или IPv6
  } catch (error) {
    console.error('❌ [IP-Fetch] Не удалось получить IP:', error);
    return 'unknown_ip';
  }
}