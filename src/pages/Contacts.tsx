import {
  User,
  Search,
  Share2,
  Plus,
  X,
  Bell,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReplyPreview from '../components/ReplyPreview.tsx';
import type { ReplyInfo } from '../lib/p2p/services/roomService.ts';
import { QRCodeSVG } from 'qrcode.react';
import ProfileDrawer from '../components/ProfileDrawer';
import ContactRow, { type ContactRowActions } from '../components/ContactRow.tsx';
import { ConfirmModal } from '../components/ConfirmModal';
import { useContactsLogic } from '../hooks/useContactsLogic.ts';
import HeaderActionButton from '../components/HeaderActionButton.tsx';
import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import Avatar from '../components/Avatar.tsx';
import ContextMenu from '../components/ContextMenu';

const ContactList = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const forwardMessage = location.state?.forwardMessage as
    | ReplyInfo
    | undefined;

  const dismissForwardMessage = () => {
    const { forwardMessage: _drop, ...rest } = (location.state as any) || {};
    navigate(location.pathname, { replace: true, state: rest });
  };

  const {
    navigate: navigateLogic,
    isLoading,
    isProfileOpen,
    setIsProfileOpen,
    myNickname,
    myBio,
    myAvatarUrl,
    myPrivacy,
    peerId,
    contacts,
    filteredContacts,
    dialogConfig,
    toastMessage,
    showToast,
    isNetworkReady,
    handleCopyContactId,

    searchQuery,
    setSearchQuery,
    activeMenuId,
    setActiveMenuId,
    isHeaderMenuOpen,
    setIsHeaderMenuOpen,
    isShareModalOpen,
    setIsShareModalOpen,
    isAddModalOpen,
    setIsAddModalOpen,
    addPeerId,
    setAddPeerId,

    addVideoRef,
    closeDialog,
    handleCopyPeerId,
    onSubmitAddContact,
    handleRefreshContact,
    handleDeleteContact,
    handleSaveProfile,
    handleLogout,
    handleBlockContact,
    handleUnblockAndRefresh,
    handleAcceptContact,
    syncContactInQueue,
    isPushEnabled,
    togglePush,
  } = useContactsLogic();

  // Актуальные значения для стабильных колбэков: строки не зависят от идентичности хендлеров хука
  const latest = useRef({
    contacts,
    forwardMessage,
    isNetworkReady,
    navigateLogic,
    syncContactInQueue,
    handleAcceptContact,
    handleBlockContact,
    handleDeleteContact,
    handleRefreshContact,
    handleUnblockAndRefresh,
    handleCopyContactId,
  });
  latest.current = {
    contacts,
    forwardMessage,
    isNetworkReady,
    navigateLogic,
    syncContactInQueue,
    handleAcceptContact,
    handleBlockContact,
    handleDeleteContact,
    handleRefreshContact,
    handleUnblockAndRefresh,
    handleCopyContactId,
  };

  const observer = useRef<IntersectionObserver | null>(null);
  const elementsMap = useRef(new Map<Element, string>()); // node -> contact.id
  const scrollTimers = useRef(new Map<Element, ReturnType<typeof setTimeout>>());

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    observer.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const target = entry.target;
          const id = elementsMap.current.get(target);

          if (entry.isIntersecting) {
            if (id && !scrollTimers.current.has(target)) {
              const timer = setTimeout(() => {
                scrollTimers.current.delete(target);
                const contact = latest.current.contacts.find((c) => c.id === id);
                if (!contact) return;
                latest.current.syncContactInQueue(contact);
              }, 2000);

              scrollTimers.current.set(target, timer);
            }
          } else {
            const timer = scrollTimers.current.get(target);
            if (timer) {
              clearTimeout(timer);
              scrollTimers.current.delete(target);
            }
          }
        });
      },
      { threshold: 0.1 },
    );

    // Эффекты строк выполняются раньше этого: подписываем тех, кто успел зарегистрироваться
    elementsMap.current.forEach((_id, node) => observer.current?.observe(node));

    return () => {
      observer.current?.disconnect();
      observer.current = null;
      scrollTimers.current.forEach((timer) => clearTimeout(timer));
      scrollTimers.current.clear();
      elementsMap.current.clear();
    };
  }, []);

  const observe = useCallback((node: Element, id: string) => {
    elementsMap.current.set(node, id);
    observer.current?.observe(node);
    return () => {
      observer.current?.unobserve(node);
      elementsMap.current.delete(node);
      const timer = scrollTimers.current.get(node);
      if (timer) {
        clearTimeout(timer);
        scrollTimers.current.delete(node);
      }
    };
  }, []);

  const actions = useMemo<ContactRowActions>(
    () => ({
      open: (contact) => {
        const l = latest.current;
        if (!l.isNetworkReady) return;
        l.navigateLogic(`/chat/${contact.id}`, {
          state: {
            contactName: contact.nickname || contact.id,
            contact: { ...contact }, // в сторе объекты заморожены
            forwardMessage: l.forwardMessage,
          },
        });
      },
      accept: (e, id) => latest.current.handleAcceptContact(e, id),
      block: (e, id) => latest.current.handleBlockContact(e, id),
      remove: (e, id) => latest.current.handleDeleteContact(e, id),
      refresh: (e, id) => latest.current.handleRefreshContact(e, id),
      unblock: (e, id) => latest.current.handleUnblockAndRefresh(e, id),
      copyId: (e, id) => latest.current.handleCopyContactId(e, id),
      openMenu: (id, anchor) => {
        setActiveMenuId(id);
        setMenuAnchor(anchor);
      },
      closeMenu: () => {
        setActiveMenuId(null);
        setMenuAnchor(null);
      },
      observe,
    }),
    [observe, setActiveMenuId],
  );

  return (
    <div className="contacts-container">
      <ProfileDrawer
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        nickname={myNickname}
        bio={myBio}
        avatarUrl={myAvatarUrl}
        privacy={myPrivacy || 'public'}
        onSave={handleSaveProfile}
        onLogout={handleLogout}
        showToast={showToast}
      />

      <div className="contacts-header">
        <div className="header-left">
          <Avatar
            url={myAvatarUrl}
            size={24}
            onClick={() => !isLoading && setIsProfileOpen(true)}
          />
          <span className="username">{myNickname}</span>
        </div>

        <div className="header-actions" onClick={(e) => e.stopPropagation()}>
          <HeaderActionButton
            onClick={(e) => {
              e.stopPropagation();
              togglePush();
            }}
            icon={<Bell size={22} color={isPushEnabled ? '#ffffff' : '#94a3b8'} />}
            title={t(isPushEnabled ? 'contactsPage.pushOn' : 'contactsPage.pushOff')}
            disabled={isLoading}
          />

          <HeaderActionButton
            onClick={(e) => {
              e.stopPropagation();
              if (isHeaderMenuOpen) {
                setIsHeaderMenuOpen(false);
                setMenuAnchor(null);
              } else {
                setIsHeaderMenuOpen(true);
                setMenuAnchor(e.currentTarget);
              }
            }}
            icon={<Share2 size={22} />}
            title={t('contactsPage.shareContact')}
            disabled={isLoading}
          />

          {isHeaderMenuOpen && (
            <ContextMenu
              className="header-context-menu"
              anchorEl={menuAnchor}
              items={[
                {
                  label: t('contactsPage.add'),
                  icon: <Plus size={16} />,
                  onClick: () => {
                    setIsAddModalOpen(true);
                    setIsHeaderMenuOpen(false);
                    setMenuAnchor(null);
                  },
                },
                {
                  label: t('contactsPage.share'),
                  icon: <Share2 size={16} />,
                  onClick: () => {
                    setIsShareModalOpen(true);
                    setIsHeaderMenuOpen(false);
                    setMenuAnchor(null);
                  },
                },
              ]}
            />
          )}
        </div>
      </div>

      <div className="contacts-search">
        <div className="search-input-container">
          <Search size={18} className="search-icon" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('contactsPage.searchPlaceholder')}
            className="bg-transparent outline-none w-full text-sm"
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="contacts-list">
        {isLoading ? (
          <div className="empty-state local-db-loader">
            <div className="animate-spin" style={{ marginBottom: '8px' }}>
              ⏳
            </div>
            {t('contactsPage.syncing')}
          </div>
        ) : contacts.length === 0 ? (
          <div className="empty-state">{t('contactsPage.emptyContacts')}</div>
        ) : filteredContacts.length === 0 ? (
          <div className="empty-state">{t('contactsPage.emptySearch')}</div>
        ) : (
          filteredContacts.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              isMenuOpen={activeMenuId === contact.id}
              menuAnchor={activeMenuId === contact.id ? menuAnchor : null}
              actions={actions}
            />
          ))
        )}
      </div>

      {forwardMessage && (
        <div className="forward-preview-container">
          <ReplyPreview
            replyTo={forwardMessage}
            title={t('contactsPage.forwardedTitle')}
            variant="composer"
            onRemove={dismissForwardMessage}
          />
        </div>
      )}

      {isShareModalOpen && (
        <div
          className="modal-overlay"
          onClick={() => setIsShareModalOpen(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              aria-label={t('contactsPage.close')}
              title={t('contactsPage.close')}
              className="close-button"
              onClick={() => setIsShareModalOpen(false)}
            >
              <X size={20} />
            </button>
            <h3 className="modal-title">
              {t('contactsPage.shareProfileTitle')}
            </h3>
            <div
              className="qr-wrapper"
              onClick={handleCopyPeerId}
              title={t('contactsPage.copyHint')}
            >
              <QRCodeSVG
                value={peerId || t('contactsPage.unknownPeer')}
                size={180}
              />
            </div>
            <div className="peer-info">
              <span className="peer-label">{t('contactsPage.yourPeerId')}</span>
              <code className="peer-value">
                {peerId || t('contactsPage.loading')}
              </code>
            </div>
            <p className="modal-hint">{t('contactsPage.qrHint')}</p>
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              aria-label={t('contactsPage.close')}
              title={t('contactsPage.close')}
              className="close-button"
              onClick={() => setIsAddModalOpen(false)}
            >
              <X size={20} />
            </button>

            <h3 className="modal-title">
              {t('contactsPage.addByPeerIdTitle')}
            </h3>

            <div className="modal-camera-wrapper">
              <video
                ref={addVideoRef}
                autoPlay
                playsInline
                muted
                className="modal-camera-video"
              />
            </div>

            <div className="modal-inputs-group">
              <div className="modal-input-wrapper">
                <User size={18} className="modal-input-icon" />
                <input
                  type="text"
                  className="modal-peer-input"
                  value={addPeerId}
                  onChange={(e) => setAddPeerId(e.target.value)}
                  placeholder={t('contactsPage.peerIdPlaceholder')}
                />
              </div>
            </div>

            <button
              className="modal-submit-btn"
              onClick={onSubmitAddContact}
              disabled={!addPeerId.trim()}
            >
              {t('contactsPage.add')}
            </button>
          </div>
        </div>
      )}

      {toastMessage && <div className="toast-notification">{toastMessage}</div>}

      <ConfirmModal
        isOpen={dialogConfig.isOpen}
        title={dialogConfig.title}
        message={dialogConfig.message}
        confirmText={dialogConfig.confirmText}
        isDanger={dialogConfig.isDanger}
        onConfirm={dialogConfig.onConfirm}
        onCancel={closeDialog}
      />
    </div>
  );
};

export default function Contacts() {
  return <ContactList />;
}
