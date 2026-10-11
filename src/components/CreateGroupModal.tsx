import { useState } from 'react';
import { X, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ContactItem } from '../lib/p2p/services/contactsService.ts';
import { MAX_WRITERS } from '../lib/p2p/services/groupState.ts';

const MAX_MEMBERS = MAX_WRITERS - 1;

interface Props {
  isOpen: boolean;
  contacts: ContactItem[];
  onClose: () => void;
  onCreate: (name: string, memberIds: string[]) => Promise<boolean>;
}

const CreateGroupModal = ({ isOpen, contacts, onClose, onCreate }: Props) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const pickable = contacts.filter((c) => c.type !== 'group' && !c.isPending && !c.isBlocked && !c.isDeleted);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_MEMBERS) next.add(id);
      return next;
    });

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (await onCreate(name.trim(), [...selected])) {
        setName('');
        setSelected(new Set());
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="close-button" onClick={onClose} aria-label={t('contactsPage.close')}>
          <X size={20} />
        </button>
        <h3 className="modal-title">{t('contactsPage.createGroupTitle', { defaultValue: 'Новая группа' })}</h3>

        <div className="modal-inputs-group">
          <div className="modal-input-wrapper">
            <Users size={18} className="modal-input-icon" />
            <input
              type="text"
              className="modal-peer-input"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('contactsPage.groupNamePlaceholder', { defaultValue: 'Название группы' })}
            />
          </div>
        </div>

        <div className="group-pick-list">
          {pickable.map((c) => (
            <label key={c.id}>
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
              <span>{c.nickname}</span>
            </label>
          ))}
        </div>

        <button className="modal-submit-btn" onClick={submit} disabled={!name.trim() || busy}>
          {t('contactsPage.createGroupButton', { defaultValue: 'Создать' })}
        </button>
      </div>
    </div>
  );
};

export default CreateGroupModal;