import { useEffect, useState } from 'react';
import {
  ArrowRightFromLine, MoreVertical, Shield, ShieldOff, MessageSquare,
  MessageSquareOff, UserMinus, Ban, RotateCcw, UserPlus, LogOut, Crown, Trash2, Link2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import HeaderActionButton from './HeaderActionButton.tsx';
import ContactAvatar from './ContactAvatar.tsx';
import ContextMenu from './ContextMenu';
import { ConfirmModal } from './ConfirmModal.tsx';
import { globalHelia, globalContactsDb } from '../lib/p2p/services/authService.ts';
import { getAllContacts, deleteContact, type ContactItem } from '../lib/p2p/services/contactsService.ts';
import { sendGroupInvites, buildGroupLink, type GroupActions, type GroupSnapshot } from '../lib/p2p/services/groupService.ts';
import {
  canModerate, canWrite, groupContactId, isWriterSlot, writerSlots, MAX_WRITERS, type GroupMember,
} from '../lib/p2p/services/groupState.ts';
import '../styles/groupMembers.scss';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Props {
  isOpen: boolean;
  onClose: () => void;
  snap: GroupSnapshot;
  actions: GroupActions;
  memberNames: Record<string, string>;
  onLeft: () => void;
}

const GroupMembersDrawer = ({ isOpen, onClose, snap, actions, memberNames, onLeft }: Props) => {
  const { t } = useTranslation();
  const { state, myRole } = snap;
  const myId = actions.myId;
  const isStaff = (myRole === 'owner' || myRole === 'admin') && !state.closed;

  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmText: string; run: () => void } | null>(null);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [editName, setEditName] = useState(state.name);
  const [editDesc, setEditDesc] = useState(state.description);

  const PAGE = 50;

  const [query, setQuery] = useState('');
  const [shownRegular, setShownRegular] = useState(PAGE);
  const [shownBanned, setShownBanned] = useState(PAGE);
  const [copied, setCopied] = useState(false);

  const [notice, setNotice] = useState('');
  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(''), 4000); };

  useEffect(() => { setShownRegular(PAGE); setShownBanned(PAGE); }, [query, isOpen]);

  useEffect(() => {
    if (isOpen) { setEditName(state.name); setEditDesc(state.description); }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !globalContactsDb) return;
    getAllContacts(globalContactsDb).then(setContacts).catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const nameOf = (id: string) => memberNames[id] || `${id.slice(0, 6)}...${id.slice(-4)}`;

  const rank = (m: GroupMember) => (m.role === 'owner' ? 0 : m.role === 'admin' ? 1 : 2);
  const byName = (a: GroupMember, b: GroupMember) => rank(a) - rank(b) || nameOf(a.id).localeCompare(nameOf(b.id));
  const all = [...state.members.values()];
  const q = query.trim().toLowerCase();
  const matches = (m: GroupMember) => !q || nameOf(m.id).toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
  const activeAll = all.filter((m) => m.status === 'active');
  const staff = activeAll.filter((m) => m.role !== 'member' && matches(m)).sort(byName);
  const regular = activeAll.filter((m) => m.role === 'member' && matches(m)).sort(byName);
  const banned = all.filter((m) => m.status === 'banned' && matches(m)).sort(byName);

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { console.error('❌ [Group] Действие не выполнено:', e); }
  };
  const ask = (title: string, message: string, confirmText: string, fn: () => Promise<unknown>) =>
    setConfirm({ title, message, confirmText, run: () => { void run(fn); } });

  const roleLabel = (m: GroupMember) => {
    if (m.status === 'banned') return t('groupDrawer.bannedLabel');
    if (m.role === 'owner') return t('groupDrawer.owner');
    if (m.role === 'admin') return t('groupDrawer.admin');
    if (state.writeMode === 'all') return canWrite(state, m.id) ? '' : t('groupDrawer.readOnly');
    return canWrite(state, m.id) ? t('groupDrawer.canWrite') : '';
  };

  const menuItemsFor = (m: GroupMember) => {
    const items: any[] = [];
    if (state.closed || !canModerate(state, myId, m.id)) return items;
    const name = nameOf(m.id);
    const done = () => setMenu(null);

    if (m.status === 'banned') {
      items.push({
        label: t('groupDrawer.unban'), icon: <RotateCcw size={16} />,
        onClick: () => {
          done();
          if (state.writeMode === 'all' && slotsFull) {
            flash(t('groupDrawer.noFreeSlots', { count: slots, max: MAX_WRITERS }));
            return;
          }
          void run(() => actions.act('unban', { target: m.id }));
        },
      });
      return items;
    }

    if (myRole === 'owner') {
      const toAdmin = m.role !== 'admin';
      if (!toAdmin || isWriterSlot(state, m) || !slotsFull) items.push({
        label: t(toAdmin ? 'groupDrawer.makeAdmin' : 'groupDrawer.removeAdmin'),
        icon: toAdmin ? <Shield size={16} /> : <ShieldOff size={16} />,
        onClick: () => { done(); void run(() => actions.act('role', { target: m.id, role: toAdmin ? 'admin' : 'member' })); },
      });

      items.push({
        label: t('groupDrawer.transfer'), icon: <Crown size={16} />,
        onClick: () => {
          done();
          ask(t('groupDrawer.transferTitle'), t('groupDrawer.transferMessage', { name }), t('groupDrawer.transfer'),
            () => actions.act('transfer', { target: m.id }));
        },
      });
    }
    if (m.role === 'member') {
      const allowed = canWrite(state, m.id);
      if (allowed || isWriterSlot(state, m) || !slotsFull) items.push({
        label: t(allowed ? 'groupDrawer.denyWrite' : 'groupDrawer.allowWrite'),
        icon: allowed ? <MessageSquareOff size={16} /> : <MessageSquare size={16} />,
        onClick: () => { done(); void run(() => actions.act('write', { target: m.id, canWrite: !allowed })); },
      });
    }
    items.push({
      label: t('groupDrawer.kick'), icon: <UserMinus size={16} />,
      onClick: () => {
        done();
        ask(t('groupDrawer.kickTitle'), t('groupDrawer.kickMessage', { name }), t('groupDrawer.kick'),
          () => actions.act('kick', { target: m.id }));
      },
    });
    items.push({
      label: t('groupDrawer.ban'), icon: <Ban size={16} />, danger: true,
      onClick: () => {
        done();
        ask(t('groupDrawer.banTitle'), t('groupDrawer.banMessage', { name }), t('groupDrawer.ban'),
          () => actions.act('ban', { target: m.id }));
      },
    });
    return items;
  };

  const candidates = contacts.filter(
    (c) => c.type !== 'group' && !c.isPending && !c.isBlocked && !c.isDeleted && !state.members.has(c.id),
  );

  const slots = writerSlots(state);
  const slotsFull = slots >= MAX_WRITERS;
  const freeSlots = state.writeMode === 'all' ? MAX_WRITERS - slots : Infinity;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < freeSlots) next.add(id);
      return next;
    });

  const addSelected = async () => {
    if (!globalHelia || selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const ids = [...selected];
      for (let i = 0; i < ids.length; i++) {
        if (i > 0 && i % 10 === 0) await sleep(10_500); // лимит AC: 15 записей за 10 с
        await actions.act('add', { target: ids[i] });
      }
      await sendGroupInvites(globalHelia, { dbAddress: actions.dbAddress, name: state.name }, ids);
      setSelected(new Set());
      setPicking(false);
    } catch (e) {
      console.error('❌ [Group] Не удалось добавить участников:', e);
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    try {
      if (!state.closed && myRole !== 'owner') await actions.act('leave');
      if (globalContactsDb) await deleteContact(globalContactsDb, groupContactId(actions.dbAddress));
      window.dispatchEvent(new Event('onContactsUpdated'));
      onLeft();
    } catch (e) {
      console.error('❌ [Group] Не удалось выйти:', e);
    }
  };

    const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(buildGroupLink(actions.dbAddress));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('❌ [Group] Не удалось скопировать ссылку:', e);
    }
  };

  const renderRow = (m: GroupMember) => {
    const c = contactById.get(m.id);
    const p = state.profiles.get(m.id);
    const av = c?.avatarCid
      ? { cid: c.avatarCid, serverCid: c.avatarServerCid, key: c.avatarEncryptionKey, relays: c.serverRelays }
      : { cid: p?.avatarCid, serverCid: p?.avatarServerCid, key: p?.avatarEncryptionKey, relays: p?.serverRelays };
    const items = menuItemsFor(m);
    const open = menu?.id === m.id;
    return (
      <div key={m.id} className={`member-row ${m.status === 'banned' ? 'banned' : ''} ${open ? 'menu-open' : ''}`}>
        <div className="member-avatar">
          <ContactAvatar
            cid={av.cid}
            serverCid={av.serverCid}
            encryptionKey={av.key}
            serverRelays={av.relays}
          />
        </div>
        <div className="member-info">
          <div className="member-name">{nameOf(m.id)}</div>
          <div className="member-role">{roleLabel(m)}</div>
        </div>
        {items.length > 0 && (
          <div className="member-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="menu-button"
              title={t('chat.options')}
              onClick={(e) => {
                e.stopPropagation();
                setMenu(open ? null : { id: m.id, anchor: e.currentTarget });
              }}
            >
              <MoreVertical size={20} />
            </button>
            {open && <ContextMenu className="attachment-item-menu" anchorEl={menu!.anchor} items={items} />}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className={`drawer-overlay ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <div className={`profile-drawer right-side ${isOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="header-left" />
          <div className="header-actions left-side">
            <HeaderActionButton
              onClick={onClose}
              icon={<ArrowRightFromLine size={20} />}
              title={t('contactProfileDrawer.close')}
            />
          </div>
        </div>

        <div className="drawer-content members-content">
          <div className="members-head">
            <div className="members-title">{state.name}</div>
            {state.description && <div className="members-desc">{state.description}</div>}
            <div className="members-count">{t('groupDrawer.membersCount', { count: activeAll.length })}</div>
            {notice && <div className="members-limit full">{notice}</div>}
          </div>

          {isStaff && (
            <div className="members-tools">
              <input
                className="members-input"
                value={editName}
                maxLength={100}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t('contactsPage.groupNamePlaceholder')}
              />
              <textarea
                className="members-input members-textarea"
                value={editDesc}
                maxLength={500}
                rows={3}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder={t('groupDrawer.descriptionPlaceholder')}
              />
              <button
                className="members-btn"
                disabled={!editName.trim() || (editName.trim() === state.name && editDesc.trim() === state.description)}
                onClick={() => void run(() => actions.act('group', { name: editName.trim(), description: editDesc.trim() }))}
              >
                {t('groupDrawer.saveInfo')}
              </button>
              <label className="members-label">{t('groupDrawer.writeModeLabel')}</label>
              <select
                className="members-select"
                value={state.writeMode}
                onChange={(e) => void run(() => actions.act('group', { writeMode: e.target.value }))}
              >
                <option value="all">{t('groupDrawer.writeModeAll')}</option>
                <option value="allowed">{t('groupDrawer.writeModeAllowed')}</option>
              </select>

            <label className="members-label">{t('groupDrawer.joinModeLabel')}</label>
              <select
                className="members-select"
                value={state.joinMode}
                onChange={(e) => void run(() => actions.act('group', { joinMode: e.target.value }))}
              >
                <option value="invite">{t('groupDrawer.joinInvite')}</option>
                <option value="link">{t('groupDrawer.joinLink')}</option>
              </select>
              {state.joinMode === 'link' && (
                <button className="members-btn" onClick={copyLink}>
                  <Link2 size={16} /> {copied ? t('groupDrawer.linkCopied') : t('groupDrawer.copyLink')}
                </button>
              )}

              <div className={`members-limit ${slotsFull ? 'full' : ''}`}>
                {t(state.writeMode === 'all' ? 'groupDrawer.slotsAll' : 'groupDrawer.slotsAllowed', {
                  count: slots, max: MAX_WRITERS,
                })}
              </div>

              <button className="members-btn" onClick={() => setPicking((v) => !v)} disabled={freeSlots <= 0}>
                <UserPlus size={16} /> {t('groupDrawer.addMembers')}
              </button>

              {picking && (
                <>
                  <div className="members-pick-list">
                    {candidates.length === 0 && <span className="members-empty">{t('groupDrawer.noCandidates')}</span>}
                    {candidates.map((c) => (
                      <label key={c.id}>
                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                        <span>{c.nickname}</span>
                      </label>
                    ))}
                  </div>
                  <button className="members-btn" onClick={addSelected} disabled={busy || selected.size === 0}>
                    {t('groupDrawer.addConfirm')}
                  </button>
                </>
              )}
            </div>
          )}

          {all.length > 10 && (
            <div className="members-tools">
              <input
                className="members-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('groupDrawer.searchPlaceholder')}
              />
            </div>
          )}

          {staff.length > 0 && (
            <>
              <div className="members-section-title">{t('groupDrawer.staff')}</div>
              {staff.map(renderRow)}
            </>
          )}

          {regular.length > 0 && (
            <>
              <div className="members-section-title">{t('groupDrawer.members')}</div>
              {regular.slice(0, shownRegular).map(renderRow)}
              {regular.length > shownRegular && (
                <div className="members-tools">
                  <button className="members-btn" onClick={() => setShownRegular((n) => n + PAGE)}>
                    {t('groupDrawer.showMore', { count: regular.length - shownRegular })}
                  </button>
                </div>
              )}
            </>
          )}

          {banned.length > 0 && (
            <>
              <div className="members-section-title">{t('groupDrawer.banned')}</div>
              {banned.slice(0, shownBanned).map(renderRow)}
              {banned.length > shownBanned && (
                <div className="members-tools">
                  <button className="members-btn" onClick={() => setShownBanned((n) => n + PAGE)}>
                    {t('groupDrawer.showMore', { count: banned.length - shownBanned })}
                  </button>
                </div>
              )}
            </>
          )}

          <div className="members-tools">
            {state.closed ? (
              <button
                className="members-btn danger"
                onClick={() => ask(t('groupDrawer.removeTitle'), t('groupDrawer.removeMessage'), t('groupDrawer.removeFromList'), leave)}
              >
                <LogOut size={16} /> {t('groupDrawer.removeFromList')}
              </button>
            ) : myRole === 'owner' ? (
              <button
                className="members-btn danger"
                onClick={() => ask(t('groupDrawer.deleteTitle'), t('groupDrawer.deleteMessage'), t('groupDrawer.deleteGroup'), () => actions.act('close'))}
              >
                <Trash2 size={16} /> {t('groupDrawer.deleteGroup')}
              </button>
            ) : (
              <button
                className="members-btn danger"
                onClick={() => ask(t('groupDrawer.leaveTitle'), t('groupDrawer.leaveMessage'), t('groupDrawer.leave'), leave)}
              >
                <LogOut size={16} /> {t('groupDrawer.leave')}
              </button>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmText={confirm?.confirmText ?? ''}
        isDanger
        onConfirm={() => { confirm?.run(); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
};

export default GroupMembersDrawer;