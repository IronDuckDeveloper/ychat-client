import { useRef, useState, useEffect } from 'react';
import type { UIEvent, ChangeEvent, KeyboardEvent } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useIPFS } from './useIPFS.ts';
import {
  clearEntireChat,
  getDeterministicRoomName,
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
}

export const useChatLogic = () => {
  const navigate = useNavigate();
  const { peerId } = useParams();
  const location = useLocation();
  const routerState = location.state as RouterState | null;

  const [displayName, setDisplayName] = useState(
    routerState?.contactName || 'Загрузка...',
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

  // 🔥 Логика чистой архитектуры для вложений файлов
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [acceptedFileTypes, setAcceptedFileTypes] = useState('*/*');
  // Файл, выбранный пользователем, но ещё не отправленный (превью над инпутом)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // Сообщение, на которое отвечаем (превью над инпутом); аттач и ответ взаимоисключающие
  const [replyingTo, setReplyingTo] = useState<ReplyInfo | null>(null);
  // 🔥 Логика скрытых сообщений
  const [isHiddenMode, setIsHiddenMode] = useState(false);
  const toggleHiddenMode = () => setIsHiddenMode((prev) => !prev);

  // --- ДИАЛОГ ---
  const [dialogConfig, setDialogConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Да',
    isDanger: true,
    onConfirm: () => {},
  });

  const closeDialog = () =>
    setDialogConfig((prev) => ({ ...prev, isOpen: false }));

  const toggleAttachmentMenu = (e?: React.MouseEvent) => {
    e?.stopPropagation(); // Блокируем всплытие, чтобы слушатель document не закрыл меню сразу же
    setIsAttachmentMenuOpen(!isAttachmentMenuOpen);
  };

  const triggerFileInput = (type: 'image' | 'file' | 'audio') => {
    if (type === 'image') setAcceptedFileTypes('image/*,video/*');
    else if (type === 'audio') setAcceptedFileTypes('audio/*');
    else setAcceptedFileTypes('*/*');

    setIsAttachmentMenuOpen(false);

    // Небольшой таймаут, чтобы дать реакту обновить атрибут accept на инпуте
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 10);
  };

  // 🔥 Файл больше не грузится сразу: выбор кладёт File в selectedFile,
  // реальная загрузка в Helia происходит в handleSendMessage при отправке.
  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Сбрасываем инпут для возможности повторного выбора того же файла
    }
  };

  // Ответ на сообщение: кладём денормализованный снимок в replyingTo.
  // Аттач при ответе запрещён — сбрасываем уже выбранный файл, если был.
  const handleReplyToMessage = (message: ChatMessage) => {
    setReplyingTo({
      id: message.id,
      text: message.text || undefined,
      attachmentName: message.attachment?.name,
      attachmentMime: message.attachment?.type,
    });
    removeSelectedFile();
  };

  const cancelReply = () => setReplyingTo(null);

  // Закрытие меню вложений при клике вне его области
  useEffect(() => {
    if (!isAttachmentMenuOpen) return;

    const handleClickOutside = () => {
      setIsAttachmentMenuOpen(false);
    };

    // Важно: подписываемся после текущего клика, иначе меню сразу закроется
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isAttachmentMenuOpen]);

  // Очистка уведомлений
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

  // Функция получения и обновления данных контакта из локальной базы
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
      } else if (displayName === 'Загрузка...') {
        setDisplayName(`${peerId.slice(0, 6)}...${peerId.slice(-4)}`);
      }
    } catch (err) {
      console.error('❌ Ошибка при получении контакта в чате:', err);
      if (displayName === 'Загрузка...') setDisplayName('Неизвестный');
    }
  };

  // Подписываемся на событие обновления контактов
  useEffect(() => {
    window.addEventListener('onContactsUpdated', refreshContactData);

    if (isReady && globalContactsDb && peerId) {
      refreshContactData();
    }

    return () => {
      window.removeEventListener('onContactsUpdated', refreshContactData);
    };
  }, [peerId, isReady]);

  // Логика получения аватара из Helia FS
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

  // Подключение к комнате PubSub / OrbitDB
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
              // Ищем, есть ли уже это сообщение в стейте
              const existingIndex = prev.findIndex((m) => m.id === message.id);

              if (existingIndex !== -1) {
                // Если есть — ПЕРЕЗАПИСЫВАЕМ его (это нужно для синхронизации "Сообщение удалено")
                const updated = [...prev];
                updated[existingIndex] = message;
                return updated.sort(
                  (a, b) => (b.ts || Date.now()) - (a.ts || Date.now()),
                );
              }

              // Если нет — добавляем новое
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

              // Если текста нет (отправлен только файл), пишем заглушку в список чатов
              const displayNotificationText =
                message.text || (message.attachment ? '📎 Вложение' : '');
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
    if ((!text && !selectedFile && !replyingTo) || !roomHandle) return;

    isUserScrolledUp.current = false;
    const sendAsHidden = isHiddenMode;
    const fileToSend = selectedFile;
    const replyToSend = replyingTo;

    try {
      const now = Date.now();
      let attachmentInfo: FileAttachment | undefined;

      // Если к сообщению прикреплён файл — грузим его в Helia прямо сейчас,
      // в момент отправки (а не сразу при выборе из проводника).
      if (fileToSend) {
        if (!globalHelia) return;
        setIsUploadingFile(true);
        attachmentInfo = await uploadFileToHelia(globalHelia, fileToSend);
      }

      await roomHandle.sendMessage(
        text,
        attachmentInfo,
        sendAsHidden,
        replyToSend ?? undefined,
      );
      setDraft('');
      setIsHiddenMode(false); // 👈 сбрасываем режим после отправки — по умолчанию не "залипает" на следующее сообщение
      setSelectedFile(null);
      setReplyingTo(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      if (globalHelia && peerId) {
        try {
          const myPeerId = (globalHelia as any).libp2p.peerId.toString();
          const targetTopic = `${CONFIG.TOPICS.ANNOUNCE_NEW_MESSAGE}${peerId}`;
          const notificationText = attachmentInfo
            ? text || `📎 Файл: ${attachmentInfo.name}`
            : text;
          const notificationData = { from: myPeerId, text: notificationText, ts: now };
          const encoded = new TextEncoder().encode(
            JSON.stringify(notificationData),
          );
          await (globalHelia as any).libp2p.services.pubsub.publish(
            targetTopic,
            encoded,
          );
        } catch (err) {
          console.warn('⚠️ Не удалось отправить фоновый пуш:', err);
        }
      }
    } catch (err) {
      // Файл, текст и ответ умышленно НЕ сбрасываем при ошибке — чтобы можно было
      // повторить отправку, не выбирая файл/сообщение заново.
      console.error('Ошибка отправки сообщения:', err);
    } finally {
      setIsUploadingFile(false);
    }
  };

    // 🔥 Скачивание текста сообщения как .txt
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
    if (!isReady) return 'Ожидание запуска узла...';
    if (!roomHandle) return 'Открытие базы данных комнаты...';
    if (!isRoomConnected) return 'Поиск пиров и склейка сети...';
    return 'Напишите сообщение...';
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

  // ФУНКЦИЯ УДАЛЕНИЯ СООБЩЕНИЯ
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
        ? 'Удалить сообщение из сети?'
        : 'Удалить сообщение с устройства?',
      message: isOwnMessage
        ? 'Сообщение будет навсегда удалено из сети.'
        : 'Сообщение будет навсегда удалено с вашего устройства.',
      confirmText: 'Да',
      isDanger: true,
      onConfirm: async () => {
        // 1. Локально сносим файл всегда; на сервере — только если сообщение моё
        if (cid && globalHelia) {
          await deleteFileFromHelia(
            globalHelia,
            cid,
            serverCid,
            serverRelays,
            isOwnMessage,
          );
        }

        // 2. Меняем сообщение в локальном UI мгновенно
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === messageId) {
              return { ...m, text: CONFIG.MSG.MESSAGE_DELETED, attachment: undefined };
            }
            return m;
          }),
        );

        // 3. Отправляем изменения в OrbitDB, чтобы у собеседника тоже обновилось
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

    // 🔥 Экспорты для UI вложений
    fileInputRef,
    isUploadingFile,
    acceptedFileTypes,
    triggerFileInput,
    handleFileSelect,
    selectedFile,
    removeSelectedFile,

    // 🔥 Экспорты для UI ответа на сообщение
    replyingTo,
    handleReplyToMessage,
    cancelReply,

    isHiddenMode, toggleHiddenMode
  };
};
