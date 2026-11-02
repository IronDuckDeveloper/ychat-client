// Общий пул БД с подсчётом ссылок: управляющая БД (ключ — адрес) и периоды (ключ — имя)
export const sharedDbs = new Map<string, { promise: Promise<any>; refCount: number }>();

// БД, которые прямо сейчас закрываются. Открытие того же ключа ждёт конца закрытия,
// иначе libp2p ругается "Handler already registered for protocol".
const closing = new Map<string, Promise<void>>();

export function trackClose(key: string, db: any): void {
  const p: Promise<void> = Promise.resolve()
    .then(() => db.close())
    .catch(() => {})
    .then(() => { if (closing.get(key) === p) closing.delete(key); });
  closing.set(key, p);
}

export const waitClosed = async (key: string): Promise<void> => { await closing.get(key); };

export async function acquireShared(key: string, open: () => Promise<any>): Promise<any> {
  await waitClosed(key);
  let s = sharedDbs.get(key);
  if (!s) {
    s = { promise: open(), refCount: 0 };
    sharedDbs.set(key, s);
  }
  s.refCount++;
  try {
    return await s.promise;
  } catch (err) {
    s.refCount--;
    if (s.refCount <= 0) sharedDbs.delete(key);
    throw err;
  }
}

export function releaseShared(key: string, db: any) {
  const s = sharedDbs.get(key);
  if (s && --s.refCount <= 0) {
    sharedDbs.delete(key);
    trackClose(key, db);
  }
}

/**
 * Кэш документов одной БД. db.all() декодирует весь лог, поэтому читаем его целиком только при открытии
 * и когда в событии виден пропуск; обычные обновления берём из самого события.
 */
export function createDocCache(db: any, onChange: () => void) {
  const cache = new Map<string, any>();
  const known = new Set<string>();
  let ready = false;
  let dirty = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastReloadMs = 0;
  let lastReloadAt = 0; // конец последнего чтения по событию (init не считается)

  const fullReload = async () => {
    const t0 = performance.now();
    const rows: any[] = await db.all();
    for (const r of rows) {
      const d = r?.value ?? r;
      if (d && typeof d._id === 'string') cache.set(d._id, d);
      if (typeof r?.hash === 'string') known.add(r.hash);
    }
    lastReloadMs = performance.now() - t0;
  };

  const scheduleReload = () => {
    if (timer || disposed) return;
    // не чаще раза в 1,5 с и не чаще, чем раз в тройное время самого чтения: нагрузка ограничена ~25%.
    // Первое чтение после паузы идёт почти сразу (100 мс склеивают пачку событий)
    const wait = Math.max(100, lastReloadAt + Math.max(1500, lastReloadMs * 3) - Date.now());
    timer = setTimeout(async () => {
      timer = null;
      if (disposed) return;
      try { await fullReload(); } catch (err) { console.error('❌ [Group] Ошибка чтения БД:', err); }
      lastReloadAt = Date.now();
      if (!disposed) onChange();
    }, wait);
  };

  const onUpdate = (entry: any) => {
    if (disposed) return;
    if (!ready) { dirty = true; return; }
    const p = entry?.payload;
    const doc = p?.op === 'PUT' ? p.value : null;
    if (doc && typeof doc._id === 'string') {
      cache.set(doc._id, doc);
      if (typeof entry.hash === 'string') known.add(entry.hash);
    }
    // записи, которых мы не видели (пачка при синке), подбираем полным чтением
    const gap = !doc || !Array.isArray(entry.next) || entry.next.some((h: string) => !known.has(h));
    if (gap) scheduleReload();
    onChange();
  };

  db.events.on('update', onUpdate);

  return {
    docs: () => cache.values(),
    get: (id: string) => cache.get(id),
    size: () => cache.size,
    async init() {
      await fullReload();
      ready = true;
      if (dirty) scheduleReload(); // события, пришедшие во время первого чтения
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      db.events.off('update', onUpdate);
    },
  };
}
export type DocCache = ReturnType<typeof createDocCache>;