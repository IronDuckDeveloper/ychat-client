import { memo, useEffect, useRef, type MouseEvent } from 'react';
import { MoreVertical, RefreshCcw, Ban, Copy, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ContactAvatar from './ContactAvatar.tsx';
import ContextMenu from './ContextMenu';
import { CONFIG } from '../lib/p2p/config.ts';
import type { ContactItem } from '../lib/p2p/services/contactsService.ts';

export interface ContactRowActions {
  open: (contact: ContactItem) => void;
  accept: (e: MouseEvent, id: string) => void;
  block: (e: MouseEvent, id: string) => void;
  remove: (e: MouseEvent, id: string) => void;
  refresh: (e: MouseEvent, id: string) => void;
  unblock: (e: MouseEvent, id: string) => void;
  copyId: (e: MouseEvent, id: string) => void;
  openMenu: (id: string, anchor: HTMLElement) => void;
  closeMenu: () => void;
  /** Подписывает строку на IntersectionObserver (Smart Render), возвращает отписку. */
  observe: (node: Element, id: string) => () => void;
}

interface ContactRowProps {
  contact: ContactItem;
  isMenuOpen: boolean;
  menuAnchor: HTMLElement | null; // не null только у строки с открытым меню
  actions: ContactRowActions;
}

const ContactRow = memo(function ContactRow({
  contact,
  isMenuOpen,
  menuAnchor,
  actions,
}: ContactRowProps) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = rowRef.current;
    if (!node) return;
    return actions.observe(node, contact.id);
  }, [actions, contact.id]);

  return (
    <div
      ref={rowRef}
      className={`contact-item ${contact.isBlocked ? 'blocked' : ''} ${isMenuOpen ? 'menu-open' : ''}`}
      onClick={(e) => {
        if (contact.isBlocked || contact.isPending) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        actions.open(contact);
      }}
    >
      {/* 1. Аватар */}
      <div className="contact-avatar">
        <ContactAvatar
          cid={contact.avatarCid}
          serverCid={contact.avatarServerCid}
          encryptionKey={contact.avatarEncryptionKey}
          serverRelays={contact.serverRelays}
        />
        {contact.unreadCount && contact.unreadCount > 0 ? (
          <span className="unread-badge">
            {contact.unreadCount > 9 ? '9+' : contact.unreadCount}
          </span>
        ) : null}
      </div>

      {/* 2. Блок с именем и текстом сообщения */}
      <div className="contact-info">
        <div className="contact-name">{contact.nickname}</div>
        <div className="contact-last-message">
          {contact.lastMessage === CONFIG.MSG.MESSAGE_DELETED
            ? t('chat.messageDeletedLabel')
            : contact.lastMessage || t('contactsPage.noMessages')}
        </div>
      </div>

      {/* 3. Время отправки */}
      {contact.lastMessageTime &&
        contact.lastMessage &&
        contact.lastMessage !== CONFIG.MSG.MESSAGE_DELETED &&
        !contact.isPending && (
          <div className="contact-time">
            {new Date(contact.lastMessageTime).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        )}

      {/* 4. Блок "Вас добавили" и кнопки */}
      {contact.isPending && (
        <div
          className="contact-pending-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="contact-pending-hint">
            {t('contactsPage.addedYouHint')}
          </span>
          <div className="pending-buttons-group">
            <button
              className="pending-btn accept"
              onClick={(e) => actions.accept(e, contact.id)}
            >
              {t('contactsPage.add')}
            </button>
            <button
              className="pending-btn"
              onClick={(e) => actions.block(e, contact.id)}
            >
              {t('contactsPage.block')}
            </button>
            <button
              className="pending-btn danger"
              onClick={(e) => actions.remove(e, contact.id)}
            >
              {t('contactsPage.delete')}
            </button>
          </div>
        </div>
      )}

      {/* 5. Опции (только если не pending) */}
      {!contact.isPending && (
        <div className="contact-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="menu-button"
            onClick={(e) => {
              e.stopPropagation();
              if (isMenuOpen) actions.closeMenu();
              else actions.openMenu(contact.id, e.currentTarget);
            }}
            title={t('contactsPage.options')}
          >
            <MoreVertical size={20} />
          </button>

          {isMenuOpen && (
            <ContextMenu
              className="item-contact-context-menu"
              anchorEl={menuAnchor}
              items={[
                ...(!contact.isBlocked
                  ? [
                      {
                        label: t('contactsPage.refreshProfile'),
                        icon: <RefreshCcw size={16} />,
                        onClick: (e: MouseEvent) => {
                          actions.refresh(e, contact.id);
                          actions.closeMenu();
                        },
                      },
                      {
                        label: t('contactsPage.block'),
                        icon: <Ban size={16} />,
                        onClick: (e: MouseEvent) => {
                          actions.block(e, contact.id);
                          actions.closeMenu();
                        },
                      },
                    ]
                  : [
                      {
                        label: t('contactsPage.unblockAndRefresh'),
                        icon: <RefreshCcw size={16} />,
                        onClick: (e: MouseEvent) => {
                          actions.unblock(e, contact.id);
                          actions.closeMenu();
                        },
                      },
                    ]),
                {
                  label: t('contactsPage.copyId'),
                  icon: <Copy size={16} />,
                  onClick: (e: MouseEvent) => {
                    actions.copyId(e, contact.id);
                    actions.closeMenu();
                  },
                },
                {
                  label: t('contactsPage.delete'),
                  icon: <Trash2 size={16} />,
                  danger: true,
                  onClick: (e: MouseEvent) => {
                    actions.remove(e, contact.id);
                    actions.closeMenu();
                  },
                },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
});

export default ContactRow;