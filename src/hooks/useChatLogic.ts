import { useRef, useState, useEffect } from 'react';
import type { UIEvent, ChangeEvent, KeyboardEvent } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useIPFS } from './useIPFS.ts';
import {
  // clearEntireChat,
  getDeterministicRoomName,
  buildReplyInfo,
  type ChatMessage,
  type RoomActions,
  type ReplyInfo,
} from '../lib/p2p/services/roomService.ts';
import { CONFIG } from '../lib/p2p/config.ts';
import * as contactsService from '../lib/p2p/services/contactsService.ts';
import { fetchAvatarFromHelia } from '../lib/p2p/services/avatarService.ts';
import {
  globalContactsDb,
  globalHelia,
} from '../lib/p2p/services/authService.ts';
import type { ContactItem } from '../lib/p2p/services/contactsService.ts';
import {
  uploadFileToHelia,
  deleteFileFromHelia,
  type FileAttachment,
} from '../lib/p2p/services/fileService.ts';

interface RouterState {
  contactName?: string;
  contact?: ContactItem;
  forwardMessage?: ReplyInfo;
}

export const useChatLogic = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { peerId } = useParams();
  const location = useLocation();
  const routerState = location.state as RouterState | null;

  const [displayName, setDisplayName] = useState(
    routerState?.contactName || t('chatLogic.loadingContact'),
  );
  const [contact, setContact] = useState<ContactItem | null>(
    routerState?.contact || null,
  );
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const { isReady, nodeId, joinRoom } = useIPFS();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const isUserScrolledUp = useRef(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingRef = useRef(false);

  const [roomHandle, setRoomHandle] = useState<RoomActions | null>(null);
  const [isRoomConnected, setIsRoomConnected] = useState<boolean>(false);
  const isRoomReady = isReady && !!roomHandle && isRoomConnected;

  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);

  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);

  const isMobileDevice = () => {
    if ('userAgentData' in navigator && (navigator as any).userAgentData) {
      return !!(navigator as any).userAgentData.mobile;
    }
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  };

  const audioInputRef = useRef<HTMLInputElement>(null);
  const [isAudioModalOpen, setIsAudioModalOpen] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [acceptedFileTypes, setAcceptedFileTypes] = useState('*/*');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [replyingTo, setReplyingTo] = useState<ReplyInfo | null>(null);
  const [forwardMessage, setForwardMessage] = useState<ReplyInfo | null>(
    routerState?.forwardMessage || null
  );
  const [isHiddenMode, setIsHiddenMode] = useState(false);
  const toggleHiddenMode = () => setIsHiddenMode((prev) => !prev);

  const [dialogConfig, setDialogConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: t('chatLogic.confirmYes'),
    isDanger: true,
    onConfirm: () => {},
  });

  const closeDialog = () =>
    setDialogConfig((prev) => ({ ...prev, isOpen: false }));

  const toggleAttachmentMenu = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsAttachmentMenuOpen(!isAttachmentMenuOpen);
  };

  const triggerFileInput = (type: 'image' | 'file' | 'audio') => {
    if (type === 'image') setAcceptedFileTypes('image/*,video/*');
    else if (type === 'audio') setAcceptedFileTypes('audio/*');
    else setAcceptedFileTypes('*/*');

    setIsAttachmentMenuOpen(false);

    setTimeout(() => {
      fileInputRef.current?.click();
    }, 10);
  };

  const triggerCameraCapture = () => {
    setIsAttachmentMenuOpen(false);

    if (isMobileDevice()) {
      setTimeout(() => {
        cameraInputRef.current?.click();
      }, 10);
    } else {
      setIsCameraModalOpen(true);
    }
  };

const closeCameraModal = () => setIsCameraModalOpen(false);

const triggerVideoCapture = () => {
  setIsAttachmentMenuOpen(false);

  if (isMobileDevice()) {
    setTimeout(() => {
      videoInputRef.current?.click();
    }, 10);
  } else {
    setIsVideoModalOpen(true);
  }
};

const closeVideoModal = () => setIsVideoModalOpen(false);

const triggerAudioCapture = () => {
  setIsAttachmentMenuOpen(false);

  if (isMobileDevice()) {
    setTimeout(() => {
      audioInputRef.current?.click();
    }, 10);
  } else {
    setIsAudioModalOpen(true);
  }
};

const closeAudioModal = () => setIsAudioModalOpen(false);

const handleAudioCapture = (file: File) => {
  setSelectedFile(file);
  setIsAudioModalOpen(false);
};

const handleVideoCapture = (file: File) => {
  setSelectedFile(file);
  setIsVideoModalOpen(false);
};

const handleCameraCapture = (file: File) => {
  setSelectedFile(file);
  setIsCameraModalOpen(false);
};

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
    }
    if (videoInputRef.current) {
      videoInputRef.current.value = '';
    }
    if (audioInputRef.current) {
      audioInputRef.current.value = '';
    }
  };

  const handleReplyToMessage = (message: ChatMessage) => {
    setReplyingTo(buildReplyInfo(message));
    removeSelectedFile();
  };

  const cancelReply = () => setReplyingTo(null);

  const clearForwardRouteState = () => {
    if (routerState && 'forwardMessage' in routerState) {
      const { forwardMessage: _drop, ...rest } = routerState;
      navigate(location.pathname, { replace: true, state: rest });
    }
  };

  const cancelForward = () => {
    setForwardMessage(null);
    clearForwardRouteState();
  };

  useEffect(() => {
    if (!isAttachmentMenuOpen) return;

    const handleClickOutside = () => {
      setIsAttachmentMenuOpen(false);
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isAttachmentMenuOpen]);

  useEffect(() => {
    if (globalContactsDb && peerId) {
      contactsService.clearUnread(globalContactsDb, peerId);
    }
    return () => {
      if (globalContactsDb && peerId) {
        contactsService.clearUnread(globalContactsDb, peerId);
      }
    };
  }, [peerId]);

  const refreshContactData = async () => {
    if (!peerId || !globalContactsDb) return;
    try {
      const fetchedContact = await contactsService.getContactById(
        globalContactsDb,
        peerId,
      );
      if (fetchedContact) {
        setContact(fetchedContact);
        setDisplayName(fetchedContact.nickname || fetchedContact.id);
      } else if (displayName === t('chatLogic.loadingContact')) {
        setDisplayName(`${peerId.slice(0, 6)}...${peerId.slice(-4)}`);
      }
    } catch (err) {
      console.error('❌ Ошибка при получении контакта в чате:', err);
      if (displayName === t('chatLogic.loadingContact')) setDisplayName(t('chatLogic.unknownContact'));
    }
  };

  useEffect(() => {
    window.addEventListener('onContactsUpdated', refreshContactData);

    if (isReady && globalContactsDb && peerId) {
      refreshContactData();
    }

    return () => {
      window.removeEventListener('onContactsUpdated', refreshContactData);
    };
  }, [peerId, isReady]);

  useEffect(() => {
    if (!isReady || !globalHelia || !contact?.avatarCid) {
      return;
    }

    let isMounted = true;

    const fetchAvatar = async () => {
      try {
        console.log(
          `🖼️ [Chat UI] Грузим аватар в чате. Ключ: ${contact.avatarEncryptionKey ? 'ЕСТЬ ✅' : 'НЕТ ❌'}`,
        );
        const url = await fetchAvatarFromHelia(
          globalHelia,
          contact.avatarCid,
          15000,
          contact.avatarServerCid,
          contact.avatarEncryptionKey,
          false,
          contact.serverRelays,
        );
        if (isMounted) {
          setAvatarUrl(url);
        }
      } catch (err) {
        console.error('❌ Ошибка при загрузке аватара в чате:', err);
        if (isMounted) setAvatarUrl(null);
      }
    };

    fetchAvatar();

    return () => {
      isMounted = false;
    };
  }, [
    isReady,
    contact?.avatarCid,
    contact?.avatarServerCid,
    contact?.avatarEncryptionKey,
  ]);

  useEffect(() => {
    if (!isReady || !joinRoom) return;

    let isMounted = true;
    let activeHandle: any = null;

    const subscribe = async () => {
      setIsRoomConnected(false);
      setMessages([]);

      try {
        const resolvedRoomDbId =
          nodeId && peerId && peerId !== 'global-chat'
            ? await getDeterministicRoomName(nodeId, peerId)
            : (peerId ?? 'global-chat');

        const roomActions = await joinRoom(
          resolvedRoomDbId,
          (message: ChatMessage, isBackgroundSync: boolean = false) => {
            if (!isMounted) return;
            if (message?.text?.startsWith('System:')) return;

            setMessages((prev) => {
              const existingIndex = prev.findIndex((m) => m.id === message.id);

              if (existingIndex !== -1) {
                const updated = [...prev];
                updated[existingIndex] = message;
                return updated.sort(
                  (a, b) => (b.ts || Date.now()) - (a.ts || Date.now()),
                );
              }

              const updated = [message, ...prev];
              return updated.sort(
                (a, b) => (b.ts || Date.now()) - (a.ts || Date.now()),
              );
            });

            if (peerId && globalContactsDb && peerId !== 'global-chat') {
              const isCurrentlyInThisChat =
                window.location.pathname.includes(peerId);
              const shouldIncrement =
                !isCurrentlyInThisChat &&
                !isBackgroundSync &&
                message.type !== 'sent';

              const displayNotificationText =
                (message.text === CONFIG.MSG.MESSAGE_DELETED ? t('chat.messageDeletedLabel') : message.text) ||
                (message.attachment ? t('chatLogic.attachmentFallback') : '') ||
                (message.replyTo ? t('chatLogic.forwardedFallback', { text: message.replyTo.text || t('chatLogic.forwardedMessageDefault') }) : '');

              contactsService.updateLastMessage(
                globalContactsDb,
                peerId,
                displayNotificationText,
                message.ts || Date.now(),
                shouldIncrement,
                message.hidden || false
              );

              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('onContactsUpdated'));
              }

              if (isCurrentlyInThisChat) {
                contactsService.clearUnread(globalContactsDb, peerId);
              }
            }
          },
        );

        if (!isMounted) {
          if (roomActions?.leaveRoom) roomActions.leaveRoom();
          return;
        }

        activeHandle = roomActions;
        setRoomHandle(roomActions);

        if (peerId && globalContactsDb && roomActions.dbAddress) {
          contactsService.updateChatDbAddress(
            globalContactsDb,
            peerId,
            roomActions.dbAddress,
          );
        }

        setIsRoomConnected(true);
      } catch (err) {
        console.error('Failed to join room:', err);
      }
    };

    subscribe();

    return () => {
      isMounted = false;
      if (activeHandle?.leaveRoom) activeHandle.leaveRoom();
      setRoomHandle(null);
      setIsRoomConnected(false);
    };
  }, [isReady, joinRoom, nodeId, peerId]);

  const handleScroll = async (e: UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    if (isLoadingRef.current || !roomHandle) return;

    const scrollOffset = Math.abs(target.scrollTop);
    isUserScrolledUp.current = scrollOffset > 50;

    const isAtTop =
      scrollOffset + target.clientHeight >= target.scrollHeight - 10;

    if (isAtTop && roomHandle.hasMoreHistory && roomHandle.hasMoreHistory()) {
      isLoadingRef.current = true;
      setIsLoadingMore(true);
      try {
        await roomHandle.loadMoreHistory();
      } catch (err) {
        console.error('Ошибка при подгрузке истории:', err);
      } finally {
        isLoadingRef.current = false;
        setIsLoadingMore(false);
      }
    }
  };

const handleSendMessage = async () => {
    const text = draft.trim();
    if ((!text && !selectedFile && !forwardMessage) || !roomHandle) return;

    isUserScrolledUp.current = false;
    const sendAsHidden = isHiddenMode;
    const fileToSend = selectedFile;

    const replyToSend = replyingTo ? buildReplyInfo(replyingTo) : undefined;
    
    let forwardedFromData = undefined;
    if (forwardMessage) {
      const fMsg = forwardMessage as any;
      const origForwarded = fMsg.forwardedFrom;

      let senderId =
        origForwarded?.senderId ||
        fMsg.senderId ||
        fMsg.whoSent ||
        '';

      const isMyMessage =
        (nodeId && senderId === nodeId) ||
        fMsg.type === 'sent' ||
        fMsg.isMine === true;

      if (isMyMessage && nodeId) {
        senderId = nodeId;
      } else if (!senderId && fMsg.type === 'received' && peerId) {
        senderId = peerId;
      }

      let senderName =
        origForwarded?.senderName ||
        fMsg.senderName ||
        fMsg.whoSentName;

      if (!senderName || senderName === t('chatLogic.unknownContact')) {
        if (isMyMessage) {
          senderName = t('chatLogic.you');
        } else if (contact && (senderId === contact.id || senderId === peerId)) {
          senderName = contact.nickname || displayName;
        } else if (globalContactsDb && senderId) {
          try {
            const foundContact = await contactsService.getContactById(
              globalContactsDb,
              senderId
            );
            if (foundContact) {
              senderName =
                foundContact.nickname ||
                (foundContact as any).displayName ||
                (foundContact as any).name;
            }
          } catch (err) {
            console.error('Ошибка определения имени контакта для пересылки:', err);
          }
        }
      }

      if (!senderName || senderName === t('chatLogic.unknownContact')) {
        senderName = senderId
          ? `${senderId.slice(0, 6)}...${senderId.slice(-4)}`
          : t('chatLogic.unknownContact');
      }

      forwardedFromData = {
        senderId,
        senderName,
      };
    }

    try {
      const now = Date.now();
      let attachmentInfo: FileAttachment | undefined;

      if (fileToSend) {
        if (!globalHelia) return;
        setIsUploadingFile(true);
        attachmentInfo = await uploadFileToHelia(globalHelia, fileToSend);
      }

      if (forwardMessage) {
        await roomHandle.sendMessage(
          forwardMessage.text || '',
          forwardMessage.attachment,
          sendAsHidden,
          undefined, 
          forwardedFromData,
        );

        if (text || attachmentInfo) {
          await roomHandle.sendMessage(
            text,
            attachmentInfo,
            sendAsHidden,
            undefined,
            undefined,
          );
        }
      } else {
        await roomHandle.sendMessage(
          text,
          attachmentInfo,
          sendAsHidden,
          replyToSend,
          undefined,
        );
      }

      setDraft('');
      setIsHiddenMode(false);
      setSelectedFile(null);
      setReplyingTo(null);
      setForwardMessage(null);
      clearForwardRouteState();

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (cameraInputRef.current) {
        cameraInputRef.current.value = '';
      }
      if (videoInputRef.current) {
        videoInputRef.current.value = '';
      }
      if (audioInputRef.current) {
        audioInputRef.current.value = '';
      }

      if (globalHelia && peerId) {
        try {
          const myPeerId = (globalHelia as any).libp2p.peerId.toString();
          const targetTopic = `${CONFIG.TOPICS.ANNOUNCE_NEW_MESSAGE}${peerId}`;

          let notificationText = t('chatLogic.newMessage');
          if (text) notificationText = text;
          else if (attachmentInfo) notificationText = t('chatLogic.fileNotification', { name: attachmentInfo.name });
          else if (forwardMessage) notificationText = t('chatLogic.forwardedNotification', { text: forwardMessage.text || t('chatLogic.attachmentFallback') });
          else if (replyToSend) notificationText = t('chatLogic.replyNotification', { text: replyToSend.text || t('chatLogic.attachmentFallback') });

          const notificationData = { from: myPeerId, text: notificationText, ts: now };
          const encoded = new TextEncoder().encode(JSON.stringify(notificationData));
          await (globalHelia as any).libp2p.services.pubsub.publish(targetTopic, encoded);
        } catch (err) {
          console.warn('⚠️ Не удалось отправить фоновый пуш:', err);
        }
      }
    } catch (err) {
      console.error('Ошибка отправки сообщения:', err);
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleDownloadMessageText = (text: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `message_${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getInputPlaceholder = () => {
    if (!isReady) return t('chatLogic.waitingNode');
    if (!roomHandle) return t('chatLogic.openingRoomDb');
    if (!isRoomConnected) return t('chatLogic.findingPeers');
    return t('chatLogic.typeMessage');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const handleInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.target;
    textarea.style.height = '20px';
    const newHeight = Math.min(textarea.scrollHeight, 60);
    textarea.style.height = `${newHeight}px`;
    setDraft(textarea.value);
  };

  const handleDeleteMessage = async (
    messageId: string,
    cid?: string,
    serverCid?: string,
    serverRelays?: string[],
    isOwnMessage: boolean = false,
  ) => {
    setDialogConfig({
      isOpen: true,
      title: isOwnMessage
        ? t('chatLogic.deleteFromNetworkTitle')
        : t('chatLogic.deleteFromDeviceTitle'),
      message: isOwnMessage
        ? t('chatLogic.deleteFromNetworkMessage')
        : t('chatLogic.deleteFromDeviceMessage'),
      confirmText: t('chatLogic.confirmYes'),
      isDanger: true,
      onConfirm: async () => {
        if (cid && globalHelia) {
          await deleteFileFromHelia(
            globalHelia,
            cid,
            serverCid,
            serverRelays,
            isOwnMessage,
          );
        }

        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === messageId) {
              return { ...m, text: CONFIG.MSG.MESSAGE_DELETED, attachment: undefined, replyTo: undefined, };
            }
            return m;
          }),
        );

        if (isOwnMessage) {
          if (roomHandle && typeof (roomHandle as any).tombstoneMessage === 'function') {
            await (roomHandle as any).tombstoneMessage(messageId);
          }
        } else if (roomHandle && typeof (roomHandle as any).deleteMessageLocally === 'function') {
          (roomHandle as any).deleteMessageLocally(messageId);
        }

        closeDialog();
      },
    });
  };

  return {
    navigate,
    displayName,
    contact,
    avatarUrl,
    messages,
    draft,
    messagesContainerRef,
    isLoadingMore,
    isLoadingRef,
    isRoomReady,
    handleScroll,
    handleSendMessage,
    getInputPlaceholder,
    handleKeyDown,
    handleInput,
    isAttachmentMenuOpen,
    setIsAttachmentMenuOpen,
    toggleAttachmentMenu,
    handleDeleteMessage,
    dialogConfig,
    closeDialog,
    handleDownloadMessageText,

    fileInputRef,
    isUploadingFile,
    acceptedFileTypes,
    triggerFileInput,
    handleFileSelect,
    selectedFile,
    removeSelectedFile,
    forwardMessage,
    cancelForward,

    cameraInputRef,
    triggerCameraCapture,
    isCameraModalOpen,
    closeCameraModal,
    handleCameraCapture,
    videoInputRef,
    triggerVideoCapture,
    isVideoModalOpen,
    closeVideoModal,
    handleVideoCapture,
    audioInputRef,
    triggerAudioCapture,
    isAudioModalOpen,
    closeAudioModal,
    handleAudioCapture,

    replyingTo,
    handleReplyToMessage,
    cancelReply,

    isHiddenMode, toggleHiddenMode
  };
};