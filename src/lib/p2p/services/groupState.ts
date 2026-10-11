export type GroupRole = 'owner' | 'admin' | 'member';
export type GroupActType =
  | 'add' | 'kick' | 'ban' | 'unban' | 'role' | 'write'
  | 'leave' | 'profile' | 'group' | 'del_msg' | 'transfer' | 'close' | 'join';

export interface GroupMember {
  id: string;
  role: GroupRole;
  status: 'active' | 'banned';
  canWrite?: boolean;  // явное разрешение (нужно в режиме 'allowed')
  mutedAt?: number;    // ts, с которого запрещено писать
}

export interface GroupState {
  owner: string;
  name: string;
  description: string;
  writeMode: 'all' | 'allowed';
  joinMode: 'invite' | 'link';
  writeModeSince: number | null;
  members: Map<string, GroupMember>;                 // активные и забаненные
  former: Map<string, number>;                       // вышедшие/кикнутые/разбаненные: id -> ts удаления
  profiles: Map<string, GroupProfile>;
  deletedMsgIds: Set<string>;                        // скрытые админом
  closed: boolean;
  closedAt: number | null;
}

export interface GroupProfile {
  nickname: string;
  avatarCid?: string;
  avatarServerCid?: string;
  avatarEncryptionKey?: string;
  serverRelays?: string[];
}
export type GroupActField = string | number | boolean | string[] | undefined;

export const MAX_WRITERS = 50;

/** Занимает ли участник место писателя. 'all': все активные (и заглушённые тоже); 'allowed': owner, админы и те, кому разрешено писать. */
export const isWriterSlot = (s: GroupState, m: GroupMember): boolean =>
  m.status === 'active' && (m.role !== 'member' || s.writeMode === 'all' || m.canWrite === true);

export const writerSlots = (s: GroupState): number => {
  let n = 0;
  for (const m of s.members.values()) if (isWriterSlot(s, m)) n++;
  return n;
};

export const roleOf = (s: GroupState, id: string): GroupRole | null => {
  if (id === s.owner) return 'owner';
  const m = s.members.get(id);
  return m?.status === 'active' ? m.role : null;
};

// owner трогает всех кроме себя; admin — только не-админов и не owner
export const canModerate = (s: GroupState, actor: string, target: string): boolean => {
  const a = roleOf(s, actor);
  if (target === s.owner || actor === target) return false;
  if (a === 'owner') return true;
  if (a === 'admin') return roleOf(s, target) !== 'admin';
  return false;
};

export const canWrite = (s: GroupState, id: string): boolean => {
  if (s.closed) return false;
  const r = roleOf(s, id);
  if (r === 'owner' || r === 'admin') return true;
  const m = s.members.get(id);
  if (!m || m.status !== 'active' || m.mutedAt !== undefined) return false;
  return s.writeMode === 'all' || m.canWrite === true;
};

// Показывать ли сообщение автора authorId, отправленное в момент ts
export const isVisible = (s: GroupState, authorId: string, ts: number): boolean => {
  if (s.closedAt !== null && ts >= s.closedAt) return false; // после закрытия группы новые сообщения скрыты
  if (authorId === s.owner) return true;
  const m = s.members.get(authorId);
  if (m?.status === 'banned') return false;
  if (!m) {
    const at = s.former.get(authorId);
    return at !== undefined && ts <= at; // старые сообщения вышедшего остаются
  }
  if (m.role === 'admin') return true;
  if (m.mutedAt !== undefined && ts >= m.mutedAt) return false;
  if (s.writeModeSince !== null && ts >= s.writeModeSince && m.canWrite !== true) return false;
  return true;
};

export const isMessageVisible = (s: GroupState, msg: { id: string; whoSent: string; ts: number }) =>
  !s.deletedMsgIds.has(msg.id) && isVisible(s, msg.whoSent, msg.ts);

export function computeGroupState(docs: any[], owner: string): GroupState {
  const s: GroupState = {
    owner, name: '', description: '', writeMode: 'all', joinMode: 'invite', writeModeSince: null,
    members: new Map([[owner, { id: owner, role: 'owner', status: 'active' }]]),
    former: new Map(), profiles: new Map(), deletedMsgIds: new Set(),
    closed: false, closedAt: null,
  };

  const remove = (id: string, ts: number) => { s.members.delete(id); s.former.set(id, ts); };

  const acts = docs
    .filter((d) => typeof d?._id === 'string' && d._id.startsWith('act_')
      && typeof d.ts === 'number' && typeof d.whoSent === 'string')
    .sort((a, b) => a.ts - b.ts || (a._id < b._id ? -1 : 1));

  for (const e of acts) {
    // после закрытия группы работают только выход и профиль
    if (s.closedAt !== null && e.type !== 'leave' && e.type !== 'profile') continue;
    const actor: string = e.whoSent;
    const target: string | undefined = typeof e.target === 'string' ? e.target : undefined;
    const ar = roleOf(s, actor);
    const isStaff = ar === 'owner' || ar === 'admin';

    switch (e.type as GroupActType) {
      case 'profile': {
        const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);
        const p: GroupProfile = { nickname: typeof e.nickname === 'string' ? e.nickname.slice(0, 64) : '' };
        const cid = str(e.avatarCid, 128);
        const sCid = str(e.avatarServerCid, 128);
        const key = str(e.avatarEncryptionKey, 128);
        if (cid && sCid && key) {
          p.avatarCid = cid;
          p.avatarServerCid = sCid;
          p.avatarEncryptionKey = key;
          if (Array.isArray(e.serverRelays)) {
            p.serverRelays = e.serverRelays.filter((x: unknown) => typeof x === 'string' && x.length <= 128).slice(0, 5);
          }
        }
        // пустой профиль = участник убрал публикацию (приватность сменилась)
        if (!p.nickname && !p.avatarCid) s.profiles.delete(actor);
        else s.profiles.set(actor, p);
        break;
      }

      case 'group':
        if (!isStaff) break;
        if (typeof e.name === 'string') s.name = e.name.slice(0, 100);
        if (typeof e.description === 'string') s.description = e.description.slice(0, 500);
        if (e.joinMode === 'invite' || e.joinMode === 'link') s.joinMode = e.joinMode;
        if ((e.writeMode === 'all' || e.writeMode === 'allowed') && e.writeMode !== s.writeMode) {
          // в режим «все пишут» нельзя перейти, если активных участников больше лимита
          const activeCount = [...s.members.values()].filter((m) => m.status === 'active').length;
          if (e.writeMode === 'allowed' || activeCount <= MAX_WRITERS) {
            s.writeMode = e.writeMode;
            s.writeModeSince = e.writeMode === 'allowed' ? e.ts : null;
          }
        }
        break;

      case 'add': {
        if (!isStaff || !target) break;
        if (s.members.has(target)) break; // уже участник, либо забанен (сначала unban)
        if (s.writeMode === 'all' && writerSlots(s) >= MAX_WRITERS) break;
        s.members.set(target, { id: target, role: 'member', status: 'active' });
        break;
      }

      case 'join': {
        // вступить сам может только тот, кого нет в списке (забаненные в нём числятся), и только в режиме «по ссылке»
        if (s.joinMode !== 'link' || s.members.has(actor)) break;
        if (s.writeMode === 'all' && writerSlots(s) >= MAX_WRITERS) break;
        s.members.set(actor, { id: actor, role: 'member', status: 'active' });
        break;
      }

      case 'leave':
        if (actor !== s.owner && s.members.get(actor)?.status === 'active') remove(actor, e.ts);
        break;

      case 'kick':
        if (target && canModerate(s, actor, target) && s.members.get(target)?.status === 'active') {
          remove(target, e.ts);
        }
        break;

      case 'ban':
        if (target && canModerate(s, actor, target) && s.members.get(target)?.status !== 'banned') {
          s.members.set(target, { id: target, role: 'member', status: 'banned' });
          s.former.set(target, e.ts);
        }
        break;

      case 'unban':
        if (target && canModerate(s, actor, target) && s.members.get(target)?.status === 'banned') {
          if (s.writeMode === 'all' && writerSlots(s) >= MAX_WRITERS) break;
          s.members.set(target, { id: target, role: 'member', status: 'active' });
          s.former.delete(target);
        }
        break;

      case 'role': {
        if (actor !== s.owner || !target || target === s.owner) break;
        const m = s.members.get(target);
        if (m?.status === 'active' && (e.role === 'admin' || e.role === 'member')) {
          if (e.role === 'admin' && !isWriterSlot(s, m) && writerSlots(s) >= MAX_WRITERS) break;
          m.role = e.role;
        }
        break;
      }

      case 'write': {
        if (!target || !canModerate(s, actor, target) || typeof e.canWrite !== 'boolean') break;
        const m = s.members.get(target);
        if (m?.status === 'active' && m.role === 'member') {
          if (e.canWrite && !isWriterSlot(s, m) && writerSlots(s) >= MAX_WRITERS) break;
          m.canWrite = e.canWrite;
          m.mutedAt = e.canWrite ? undefined : e.ts;
        }
        break;
      }

      case 'transfer': {
        if (actor !== s.owner || !target || target === actor) break;
        const m = s.members.get(target);
        if (m?.status !== 'active') break;
        const prev = s.members.get(actor);
        if (prev) prev.role = 'admin';
        m.role = 'owner';
        m.canWrite = undefined;
        m.mutedAt = undefined;
        s.owner = target;
        break;
      }

      case 'close':
        if (actor === s.owner) { s.closed = true; s.closedAt = e.ts; }
        break;

      case 'del_msg':
        if (isStaff && target) s.deletedMsgIds.add(target);
        break;
    }
  }
  return s;
}

// Собирает событие для db.put. undefined нельзя: IPLD (dag-cbor) на нём падает.
export function buildAct(
  actorId: string,
  type: GroupActType,
  fields: Record<string, GroupActField> = {},
) {
  const ts = Date.now();
  const doc: Record<string, any> = {
    _id: `act_${actorId}_${ts}_${Math.random().toString(36).slice(2, 9)}`,
    whoSent: actorId, type, ts,
  };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) doc[k] = v;
  return doc;
}

export const groupContactId = (address: string) => `grp_${address.replace('/orbitdb/', '')}`;
export const groupAddressOf = (id: string) => `/orbitdb/${id.slice(4)}`;