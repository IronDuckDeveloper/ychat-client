const LOCK_NAME = 'ychat-primary-tab';
const CHANNEL_NAME = 'ychat-join-link';

type JoinMsg = { type: 'JOIN'; hash: string } | { type: 'JOIN_ACK' };

const lostHandlers = new Set<() => void>();
let primaryPromise: Promise<boolean> | null = null;

/** Подписка на потерю статуса основной вкладки (другая вкладка нажала «Использовать здесь»). */
export function onPrimaryLost(cb: () => void): () => void {
  lostHandlers.add(cb);
  return () => { lostHandlers.delete(cb); };
}

function holdLock(steal: boolean): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (typeof navigator === 'undefined' || !('locks' in navigator)) return resolve(true);
    navigator.locks
      .request(LOCK_NAME, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(false); return; }
        resolve(true);
        return new Promise<void>(() => {}); // замок держится, пока вкладка жива
      })
      .catch((err) => {
        if (err?.name === 'AbortError') lostHandlers.forEach((h) => h()); // замок отобрала другая вкладка
        else resolve(true);
      });
  });
}

/** true — эта вкладка основная (держит замок до закрытия). Определяется один раз за жизнь вкладки. */
export function claimPrimaryTab(): Promise<boolean> {
  if (!primaryPromise) primaryPromise = holdLock(false);
  return primaryPromise;
}

/** «Использовать здесь»: забирает замок у основной вкладки, та получит onPrimaryLost. */
export function takeOverPrimaryTab(): Promise<boolean> {
  primaryPromise = holdLock(true);
  return primaryPromise;
}

/** Вторая вкладка: передаёт хэш основной. true — основная подтвердила приём. */
export function handOffJoinLink(hash: string, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof BroadcastChannel === 'undefined') return resolve(false);
    const ch = new BroadcastChannel(CHANNEL_NAME);
    const timer = setTimeout(() => { ch.close(); resolve(false); }, timeoutMs);
    ch.onmessage = (e: MessageEvent<JoinMsg>) => {
      if (e.data?.type === 'JOIN_ACK') { clearTimeout(timer); ch.close(); resolve(true); }
    };
    ch.postMessage({ type: 'JOIN', hash } satisfies JoinMsg);
  });
}

/** Основная вкладка: принимает хэши от вторых вкладок. Возвращает отписку. */
export function listenJoinLinks(onJoin: (hash: string) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(CHANNEL_NAME);
  ch.onmessage = (e: MessageEvent<JoinMsg>) => {
    if (e.data?.type === 'JOIN' && typeof e.data.hash === 'string' && e.data.hash.length < 200) {
      ch.postMessage({ type: 'JOIN_ACK' } satisfies JoinMsg);
      onJoin(e.data.hash);
    }
  };
  return () => ch.close();
}