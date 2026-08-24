import { relayManager } from '../networking/heliaClient';
import type { RelayConfig } from '../networking/RelayManager';
import { CONFIG } from '../config';

interface QueueItem {
  id: string;
  file: File;
  payloadToUpload: Uint8Array;
  sessionToken: string;
  succeededRelays: string[];
  excludedRelays: string[];
  firstServerCid?: string;
  retries: number;
  maxRetries: number;
  nextAttemptAt: number;
  onSuccess: (serverCid: string, serverRelays: string[]) => void | Promise<void>;
  onFailure: (error: Error) => void;
}

const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];
const REPLICATION_FACTOR = CONFIG.FILE_REPLICATION_FACTOR || 2;

function selectUploadTargets(
  pool: RelayConfig[],
  activeRelay: RelayConfig | null,
  excluded: string[],
  succeeded: string[]
): RelayConfig[] {
  const needed = Math.max(0, REPLICATION_FACTOR - succeeded.length);
  if (needed === 0) return [];

  const candidates = pool.filter(r => !excluded.includes(r.peerId) && !succeeded.includes(r.peerId));
  if (candidates.length === 0) return [];

  const prioritized: RelayConfig[] = [];
  if (activeRelay) {
    const active = candidates.find(r => r.peerId === activeRelay.peerId);
    if (active) prioritized.push(active);
  }

  const rest = candidates.filter(r => r.peerId !== activeRelay?.peerId);
  const shuffled = [...rest].sort(() => Math.random() - 0.5);

  return [...prioritized, ...shuffled].slice(0, needed);
}

class UploadQueue {
  private queue: QueueItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;

  add(item: Pick<QueueItem, 'file' | 'payloadToUpload' | 'sessionToken' | 'onSuccess' | 'onFailure'>) {
    const queueItem: QueueItem = {
      ...item,
      id: crypto.randomUUID(),
      succeededRelays: [],
      excludedRelays: [],
      retries: 0,
      maxRetries: RETRY_DELAYS_MS.length,
      nextAttemptAt: Date.now(),
    };
    this.queue.push(queueItem);
    this.rescheduleTimer();
    return queueItem.id;
  }

  get pendingCount() {
    return this.queue.length;
  }

  private rescheduleTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    const soonest = Math.min(...this.queue.map(i => i.nextAttemptAt));
    this.timer = setTimeout(() => this.processQueue(), Math.max(0, soonest - Date.now()));
  }

  private async processQueue() {
    this.timer = null;
    if (this.processing) return;
    this.processing = true;

    const now = Date.now();
    const readyItems = this.queue.filter(i => i.nextAttemptAt <= now);
    for (const item of readyItems) {
      await this.attemptUploadRound(item);
    }

    this.processing = false;
    this.rescheduleTimer();
  }

  private finishAsSuccess(item: QueueItem) {
    this.remove(item.id);
    if (item.succeededRelays.length < REPLICATION_FACTOR) {
      console.warn(`⚠️ [UploadQueue] "${item.file.name}" — недорепликация: ${item.succeededRelays.length}/${REPLICATION_FACTOR}`);
    }
    void item.onSuccess(item.firstServerCid!, item.succeededRelays);
  }

  private async attemptUploadRound(item: QueueItem) {
    const pool: RelayConfig[] = relayManager.getPool();
    const activeRelay = relayManager.getActiveRelay();

    const targets = selectUploadTargets(pool, activeRelay, item.excludedRelays, item.succeededRelays);

    if (targets.length === 0) {
      if (item.succeededRelays.length > 0) {
        this.finishAsSuccess(item);
      } else {
        this.remove(item.id);
        item.onFailure(new Error('ALL_RELAYS_REJECTED'));
      }
      return;
    }

    const results = await Promise.allSettled(targets.map(relay => this.pushToRelay(item, relay)));

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        item.succeededRelays.push(targets[i].peerId);
        if (!item.firstServerCid) item.firstServerCid = result.value;
      } else if (result.reason instanceof Error && /^UPLOAD_REJECTED_(401|403|413)$/.test(result.reason.message)) {
        item.excludedRelays.push(targets[i].peerId);
      }
    });

    if (item.succeededRelays.length >= REPLICATION_FACTOR) {
      this.finishAsSuccess(item);
      return;
    }

    const remaining = pool.filter(r => !item.excludedRelays.includes(r.peerId) && !item.succeededRelays.includes(r.peerId));
    if (remaining.length === 0) {
      if (item.succeededRelays.length > 0) {
        this.finishAsSuccess(item);
      } else {
        this.remove(item.id);
        item.onFailure(new Error('ALL_RELAYS_REJECTED'));
      }
      return;
    }

    this.scheduleRetry(item, `Реплик набрано: ${item.succeededRelays.length}/${REPLICATION_FACTOR}`);
  }

  private async pushToRelay(item: QueueItem, relay: RelayConfig): Promise<string> {
    const relayIp = relayManager.getRelayIp(relay);
    if (!relayIp) throw new Error('BAD_RELAY_ADDRESS');

    const formData = new FormData();
    const safeBuffer = new Uint8Array(item.payloadToUpload);
    formData.append('file', new Blob([safeBuffer], { type: 'application/octet-stream' }), item.file.name);

    const kuboApiUrl = `http://${relayIp}:5001/api/v0/add?pin=true&cid-version=1&raw-leaves=false`;
    const response = await fetch(kuboApiUrl, {
      method: 'POST',
      headers: { 'x-session-token': item.sessionToken },
      body: formData,
    });

    if (!response.ok) {
      if ([401, 403, 413].includes(response.status)) {
        throw new Error(`UPLOAD_REJECTED_${response.status}`);
      }
      throw new Error(`HTTP_${response.status}`);
    }

    const text = await response.text();
    const result = JSON.parse(text.trim().split('\n')[0]);
    return result.Hash as string;
  }

  private scheduleRetry(item: QueueItem, reason: string) {
    if (item.retries >= item.maxRetries) {
      if (item.succeededRelays.length > 0) {
        this.finishAsSuccess(item);
        return;
      }
      this.remove(item.id);
      console.warn(`❌ [UploadQueue] "${item.file.name}" — попытки исчерпаны (${reason})`);
      item.onFailure(new Error('MAX_RETRIES_EXCEEDED'));
      return;
    }
    const delay = RETRY_DELAYS_MS[item.retries];
    item.retries += 1;
    item.nextAttemptAt = Date.now() + delay;
    console.log(`🔁 [UploadQueue] "${item.file.name}" — повтор через ${delay / 1000}с (${item.retries}/${item.maxRetries}): ${reason}`);
    window.dispatchEvent(new CustomEvent('uploadRetrying', {
      detail: { fileName: item.file.name, attempt: item.retries, maxRetries: item.maxRetries }
    }));
    this.rescheduleTimer();
  }

  private remove(id: string) {
    this.queue = this.queue.filter(i => i.id !== id);
  }
}

export const uploadQueue = new UploadQueue();