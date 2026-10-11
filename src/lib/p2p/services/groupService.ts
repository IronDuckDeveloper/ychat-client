import type { Helia } from 'helia';
import type { Libp2p, PeerId } from '@libp2p/interface';
import { getOrbitDB } from '../orbit/client.ts';
import { GroupAccessController } from '../orbit/groupAccessController.ts';
import { notifyArchivist, checkAndSyncRelays } from '../networking/connectionManager.ts';
import { relayManager } from '../networking/heliaClient.ts';
import { CONFIG } from '../config.ts';
import { isHiddenLocally } from './hiddenMessagesService.ts';
import type { ChatMessage, ReplyInfo, ForwardedFrom } from './roomService.ts';
import type { FileAttachment } from './fileService.ts';
import {
  computeGroupState, isVisible, canWrite, roleOf, buildAct, writerSlots, MAX_WRITERS,
type GroupState, type GroupRole, type GroupActType, type GroupActField,
} from './groupState.ts';

export type GroupTarget =
  | { address: string }
  | { create: { name: string; description?: string; writeMode?: 'all' | 'allowed'; members?: string[] } };

export interface GroupSnapshot {
  messages: ChatMessage[];   // видимые, новые первыми
  state: GroupState;
  hasMore: boolean;
  myRole: GroupRole | null;  // null = не участник (кикнут/забанен/не добавлен)
  canWrite: boolean;
}

export interface GroupActions {
  dbAddress: string;
  owner: string;
  myId: string;
  sendMessage: (
    text: string, attachment?: FileAttachment, hidden?: boolean,
    replyTo?: ReplyInfo, forwardedFrom?: ForwardedFrom,
  ) => Promise<boolean>;
  act: (type: GroupActType, fields?: Record<string, GroupActField>) => Promise<void>;
  deleteMessage: (msgId: string) => Promise<void>; // своё — tombstone, чужое (admin/owner) — событие del_msg
  loadMoreHistory: () => Promise<void>;
  hasMoreHistory: () => boolean;
  leaveRoom: () => void;
}

const PAGE = CONFIG.CHUNK_SIZE || 15;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const groupSessions = new Map<string, { promise: Promise<any>; refCount: number }>();

async function acquire(orbitdb: any, target: GroupTarget): Promise<any> {
  if ('address' in target) {
    let s = groupSessions.get(target.address);
    if (!s) {
      s = { promise: orbitdb.open(target.address), refCount: 0 };
      groupSessions.set(target.address, s);
    }
    s.refCount++;
    try {
      return await s.promise;
    } catch (err) {
      s.refCount--;
      if (s.refCount <= 0) groupSessions.delete(target.address);
      throw err;
    }
  }
  const db = await orbitdb.open(`group_${Math.random().toString(36).slice(2, 12)}_${Date.now()}`, {
    type: 'documents',
    docIndex: '_id',
    AccessController: GroupAccessController(),
  });
  groupSessions.set(db.address.toString(), { promise: Promise.resolve(db), refCount: 1 });
  return db;
}

export async function joinGroup(
  helia: Helia,
  target: GroupTarget,
  onSnapshot: (snap: GroupSnapshot) => void,
): Promise<GroupActions> {
  const libp2p = (helia as any).libp2p as Libp2p;
  const orbitdb = await getOrbitDB(helia);
  const myId: string = orbitdb.identity.id;

  const db = await acquire(orbitdb, target);
  const dbAddress: string = db.address.toString();

  const release = () => {
    const s = groupSessions.get(dbAddress);
    if (s && --s.refCount <= 0) {
      groupSessions.delete(dbAddress);
      db.close().catch(() => {});
    }
  };

  if (db.access?.type !== 'ychat-group' || !db.access.write?.[0]) {
    release();
    throw new Error('Not a ychat group database');
  }
  const owner: string = db.access.write[0];

  let state = computeGroupState([], owner);
  let limit = PAGE;
  let hasMore = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastActTs = 0;

    // Кэш документов: db.all() декодирует весь лог (~0,7 с на 4000 записей), поэтому читаем его целиком
  // только при открытии и когда в событии виден пропуск; обычные обновления берём из самого события.
  const cache = new Map<string, any>();
  const known = new Set<string>();
  let ready = false;
  let dirty = false;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let lastReloadMs = 0;

  const fullReload = async () => {
    const t0 = performance.now();
    const rows: any[] = await db.all();
    cache.clear();
    known.clear();
    for (const r of rows) {
      const d = r?.value ?? r;
      if (d && typeof d._id === 'string') cache.set(d._id, d);
      if (typeof r?.hash === 'string') known.add(r.hash);
    }
    lastReloadMs = performance.now() - t0;
  };

  const scheduleReload = () => {
    if (reloadTimer || disposed) return;
    // не чаще раза в 1,5 с и не чаще, чем раз в тройное время самого чтения: нагрузка ограничена ~25%
    reloadTimer = setTimeout(async () => {
      reloadTimer = null;
      if (disposed) return;
      try { await fullReload(); } catch (err) { console.error('❌ [Group] Ошибка чтения БД:', err); }
      schedule();
    }, Math.max(1500, lastReloadMs * 3));
  };

  const onUpdate = (entry: any) => {
    if (!ready) { dirty = true; return; }
    const p = entry?.payload;
    const doc = p?.op === 'PUT' ? p.value : null;
    if (doc && typeof doc._id === 'string') {
      cache.set(doc._id, doc);
      if (typeof entry.hash === 'string') known.add(entry.hash);
    }
    // записи, которых мы не видели, подбираем полным чтением
    const gap = !doc || !Array.isArray(entry.next) || entry.next.some((h: string) => !known.has(h));
    if (gap) scheduleReload(); else schedule();
  };

  const toMessage = (d: any): ChatMessage => {
    const hiddenLocally = isHiddenLocally(d._id);
    return {
      id: d._id,
      whoSent: d.whoSent,
      text: hiddenLocally ? CONFIG.MSG.MESSAGE_DELETED : (d.text || ''),
      attachment: hiddenLocally ? undefined : (d.attachment ?? undefined),
      ts: d.ts || 0,
      type: d.whoSent === myId ? 'sent' : 'received',
      hidden: d.hidden === true,
      replyTo: hiddenLocally ? undefined : (d.replyTo ?? undefined),
      forwardedFrom: hiddenLocally ? undefined : (d.forwardedFrom ?? undefined),
    };
  };

  const emit = async () => {
    if (disposed) return;
    try {
      const docs: any[] = [...cache.values()];
      state = computeGroupState(docs, owner);

      const visible = docs
        .filter((d) => typeof d?._id === 'string' && d._id.startsWith('msg_') && (d.text || d.attachment || d.replyTo))
        .map(toMessage)
        .filter((m) => isVisible(state, m.whoSent, m.ts))
        .map((m) =>
          state.deletedMsgIds.has(m.id)
            ? { ...m, text: CONFIG.MSG.MESSAGE_DELETED, attachment: undefined, replyTo: undefined, forwardedFrom: undefined, hidden: false }
            : m,
        )
        .sort((a, b) => b.ts - a.ts);

      hasMore = visible.length > limit;
      if (disposed) return;
      onSnapshot({
        messages: visible.slice(0, limit),
        state,
        hasMore,
        myRole: roleOf(state, myId),
        canWrite: canWrite(state, myId),
      });
    } catch (err) {
      if (!disposed) console.error('❌ [Group] Ошибка сборки снимка:', err);
    }
  };

  const schedule = () => {
    if (timer || disposed) return;
    timer = setTimeout(() => { timer = null; void emit(); }, 80);
  };

  db.events.on('update', onUpdate);

  const onConnect = (evt: any) => {
    const peerId = evt.detail as PeerId;
    setTimeout(() => checkAndSyncRelays(helia), 2000);
    if (relayManager.isRelay(peerId.toString())) {
      setTimeout(() => notifyArchivist(libp2p, peerId, dbAddress), 1500);
    }
  };
  libp2p.addEventListener('peer:connect', onConnect);
  libp2p.getPeers().forEach((p: PeerId) => notifyArchivist(libp2p, p, dbAddress));

  const actions: GroupActions = {
    dbAddress,
    owner,
    myId,

    sendMessage: async (text, attachment, hidden, replyTo, forwardedFrom) => {
      if (!canWrite(state, myId)) return false;
      const msg: any = {
        _id: `msg_${myId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        whoSent: myId,
        text,
        ts: Date.now(),
      };
      if (attachment) msg.attachment = attachment;
      if (hidden) msg.hidden = true;
      if (replyTo) msg.replyTo = replyTo;
      if (forwardedFrom) msg.forwardedFrom = forwardedFrom;
      await db.put(msg);
      return true;
    },

    // ts строго растёт: иначе add и role в одну миллисекунду могут поменяться местами при реплее
    act: async (type, fields = {}) => {
      const ts = Math.max(Date.now(), lastActTs + 1);
      lastActTs = ts;
      await db.put({ ...buildAct(myId, type, fields), ts });
    },

    deleteMessage: async (msgId) => {
      const result = await db.get(msgId);
      const doc = Array.isArray(result) ? result[0] : result;
      const target = doc?.value || doc;
      if (!target) return;
      if (target.whoSent === myId) {
        await db.put({
          ...target, _id: msgId, text: CONFIG.MSG.MESSAGE_DELETED,
          attachment: null, replyTo: null, forwardedFrom: null, hidden: false,
        });
      } else {
        await actions.act('del_msg', { target: msgId });
      }
    },

    loadMoreHistory: async () => {
      if (!hasMore) return;
      limit += PAGE;
      await emit();
    },
    hasMoreHistory: () => hasMore,

    leaveRoom: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      libp2p.removeEventListener('peer:connect', onConnect);
      db.events.off('update', onUpdate);
      if (reloadTimer) clearTimeout(reloadTimer);
      release();
    },
  };

  if ('create' in target) {
    const c = target.create;
    const list: [GroupActType, Record<string, string | undefined>][] = [
      ['group', { name: c.name, description: c.description, writeMode: c.writeMode ?? 'all' }],
      ...(c.members ?? []).filter((id) => id !== myId).map((id): [GroupActType, Record<string, string>] => ['add', { target: id }]),
    ];
    for (let i = 0; i < list.length; i++) {
      if (i > 0 && i % 10 === 0) await sleep(10_500); // лимит AC: 15 записей за 10 с
      await actions.act(list[i][0], list[i][1]);
    }
  }

  await fullReload();
  ready = true;
  if (dirty) scheduleReload(); // события, пришедшие во время первого чтения
  await emit();
  return actions;
}

export async function sendGroupInvites(
  helia: any, g: { dbAddress: string; name: string }, memberIds: string[],
) {
  const pubsub = helia.libp2p.services.pubsub;
  const data = new TextEncoder().encode(JSON.stringify({
    type: CONFIG.MSG.GROUP_INVITE,
    senderId: helia.libp2p.peerId.toString(),
    groupAddress: g.dbAddress,
    name: g.name,
  }));
  for (const id of memberIds) {
    await pubsub.publish(`${CONFIG.TOPICS.PROFILE_MAILBOX_PREFIX}${id}`, data).catch(() => {});
  }
}

export const GROUP_LINK_PARAM = 'join';

export const buildGroupLink = (address: string): string =>
  `${window.location.origin}${import.meta.env.BASE_URL}?${GROUP_LINK_PARAM}=${address.replace('/orbitdb/', '')}`;

/** Хэш из ссылки → адрес БД; null, если формат неверный. */
export const parseGroupHash = (raw: string | null): string | null =>
  raw && /^zdpu[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(raw) ? `/orbitdb/${raw}` : null;

export type LinkJoinResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'unavailable' | 'disabled' | 'banned' | 'full' | 'closed' | 'rejected' };

export async function joinGroupByLink(helia: Helia, address: string): Promise<LinkJoinResult> {
  const holder: { snap: GroupSnapshot | null } = { snap: null };
  let handle: GroupActions | null = null;
  let keepOpen = false;
  try {
    const joined = joinGroup(helia, { address }, (s) => { holder.snap = s; });
    handle = await Promise.race([joined, sleep(45_000).then(() => null)]);
    if (!handle) {
      joined.then((h) => h.leaveRoom()).catch(() => {}); // открылась позже таймаута: сразу отпускаем
      return { ok: false, reason: 'unavailable' };
    }

    // ждём, пока название приедет с репликацией (до 30 с)
    for (let i = 0; i < 60 && !holder.snap?.state.name; i++) await sleep(500);
    const s = holder.snap;
    if (!s?.state.name) return { ok: false, reason: 'unavailable' };

    const me = s.state.members.get(handle.myId);
    if (s.state.closed) return { ok: false, reason: 'closed' };
    if (me?.status === 'banned') return { ok: false, reason: 'banned' };
    if (!me) {
      if (s.state.joinMode !== 'link') return { ok: false, reason: 'disabled' };
      if (s.state.writeMode === 'all' && writerSlots(s.state) >= MAX_WRITERS) return { ok: false, reason: 'full' };
      await handle.act('join');
      // проверяем, что группа приняла вступление при пересчёте состояния
      for (let i = 0; i < 20 && holder.snap?.state.members.get(handle.myId)?.status !== 'active'; i++) await sleep(250);
      if (holder.snap?.state.members.get(handle.myId)?.status !== 'active') return { ok: false, reason: 'rejected' };
    }
    keepOpen = true;
    return { ok: true, name: s.state.name };
  } catch (err) {
    console.error('❌ [Group] Вступление по ссылке не удалось:', err);
    return { ok: false, reason: 'unavailable' };
  } finally {
    if (handle) {
      const h = handle;
      // при успехе держим БД ещё 15 с: запись join должна уйти на релей, а чат группы возьмёт свою сессию
      if (keepOpen) setTimeout(() => h.leaveRoom(), 15_000);
      else h.leaveRoom();
    }
  }
}

export const groupPingTopic = (groupId: string) =>
  `${CONFIG.TOPICS.GROUP_PING_PREFIX}${groupId}${CONFIG.TOPICS.GROUP_PING_SUFFIX}`;