import { OrbitDBAccessController } from '@orbitdb/core';

// Тип этого AccessController — используется для регистрации через
// useAccessController() и хранится в манифесте базы. Должен быть
// зарегистрирован одинаково у ВСЕХ пиров (клиенты + релеи), которые
// открывают комнаты этого типа — иначе orbitdb.open() по адресу упадёт
// с "AccessController type '...' is not supported".
const type = 'ychat-rate-limited';

// Лимиты захардкожены в коде клиента, а не передаются через опции.
// canAppend() выполняется ЛОКАЛЬНО у каждого пира, который реплицирует
// базу (включая релеи), поэтому все должны применять одинаковые правила —
// иначе кто-то будет отбрасывать записи, которые другие приняли.
const MAX_MESSAGES = 15;         // сообщений
const WINDOW_MS = 10_000;        // за 10 секунд
const MAX_TEXT_LENGTH = 10_000;  // символов — защита от гигантских "сообщений"

interface RateLimitedOptions {
  write?: string[];
}

/**
 * Обёртка над штатным OrbitDBAccessController: сохраняет её ACL/подпись-логику
 * (кто вообще имеет право писать), но дополнительно отбрасывает записи,
 * которые превышают скользящее окно частоты или длину текста.
 *
 * Важно: состояние истории (history) — локальное и НЕ реплицируется.
 * У каждого пира своя копия, и это ожидаемо: цель не в консенсусе по
 * спаму, а в том, чтобы каждый узел сам отбрасывал лишнее у себя.
 */
export const RateLimitedAccessController = (options: RateLimitedOptions = {}) => {
  const baseFactory = OrbitDBAccessController({ write: options.write ?? ['*'] });

  return async (params: any) => {
    const base = await baseFactory(params);
    const { identities } = params;

    const history = new Map<string, number[]>();

    const canAppend = async (entry: any): Promise<boolean> => {
      // 1. Базовая проверка прав на запись + подписи identity —
      // как и раньше, полностью делегируем штатному контроллеру.
      const baseAllowed = await base.canAppend(entry);
      if (!baseAllowed) return false;

      const writerIdentity = await identities.getIdentity(entry.identity);
      if (!writerIdentity) return false;
      const id: string = writerIdentity.id;

      const key: string | undefined = entry.payload?.key;

      // 2.1. Проверяет, что запись принадлежит этому пользователю (ключ начинается с msg_<peerId>_).
      if (key && !key.startsWith(`msg_${id}_`)) {
        console.warn(`🚫 [Ownership] ${id.slice(-12)} пытается изменить чужой ключ ${key}`);
        return false;
      }

      // 2.2. Защита от гигантских сообщений — тоже форма спама/DoS на реплику
      const value = entry.payload?.value;
      if (value && typeof value.text === 'string' && value.text.length > MAX_TEXT_LENGTH) {
        console.warn(`🚫 [AntiSpam] Отклонено — слишком длинный текст от ${id.slice(-12)}`);
        return false;
      }

      // 3. Скользящее окно по ВРЕМЕНИ ПОЛУЧЕНИЯ записи (Date.now() здесь,
      // на этой машине), а НЕ по полю value.ts — это поле выставляет сам
      // отправитель и легко подделывает, чтобы обойти проверку.
      const now = Date.now();
      const recent = (history.get(id) || []).filter((t) => now - t < WINDOW_MS);

      if (recent.length >= MAX_MESSAGES) {
        console.warn(`🚫 [AntiSpam] Rate limit: ${id.slice(-12)} — больше ${MAX_MESSAGES} записей за ${WINDOW_MS}мс`);
        return false;
      }

      recent.push(now);
      history.set(id, recent);

      return true;
    };

    return {
      ...base,
      type,
      canAppend,
    };
  };
};

(RateLimitedAccessController as any).type = type;
