import { useRef, useState, useEffect } from 'react';
import type { UIEvent, ChangeEvent, KeyboardEvent } from 'react'; 
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useIPFS } from './useIPFS.ts';
import { getDeterministicRoomName } from '../lib/p2p/services/roomService.ts';
import { type ChatMessage, type RoomActions, CONFIG } from '../lib/p2p/config.ts';
import * as contactsService from '../lib/p2p/services/contactsService.ts';
import { globalContactsDb } from '../lib/p2p/services/authService.ts';

export const useChatLogic = () => {
  const navigate = useNavigate();
  const { peerId } = useParams(); 
  const location = useLocation();
  const routerState = location.state as any;
  
  const [displayName, setDisplayName] = useState(routerState?.contactName || 'Загрузка...');
  const { isReady, nodeId, joinRoom, helia } = useIPFS();
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  
  const isUserScrolledUp = useRef(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingRef = useRef(false);
  
  const [roomHandle, setRoomHandle] = useState<RoomActions | null>(null);
  const [isRoomConnected, setIsRoomConnected] = useState<boolean>(false);
  const isRoomReady = isReady && !!roomHandle && isRoomConnected;

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

  useEffect(() => {
    const fetchNameFallback = async () => {
      if (displayName !== 'Загрузка...' || !peerId || !globalContactsDb) return;
      try {
        const contact = await contactsService.getContactById(globalContactsDb, peerId);
        if (contact) {
          setDisplayName(contact.nickname || contact.id);
        } else {
          setDisplayName(`${peerId.slice(0, 6)}...${peerId.slice(-4)}`);
        }
      } catch {
        setDisplayName('Неизвестный');
      }
    };
    fetchNameFallback();
  }, [peerId, displayName]);

  useEffect(() => {
    if (!isReady || !joinRoom) return;

    let isMounted = true;
    let activeHandle: any = null;

    const subscribe = async () => {
      setIsRoomConnected(false);
      setMessages([]);

      try {
        const resolvedRoomDbId = (nodeId && peerId && peerId !== 'global-chat')
          ? await getDeterministicRoomName(nodeId, peerId)
          : (peerId ?? 'global-chat');

        const roomActions = await joinRoom(resolvedRoomDbId, (message: ChatMessage, isBackgroundSync: boolean = false) => { 
          if (!isMounted) return;
          if (message?.text?.startsWith('System:')) return;

          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            const updated = [message, ...prev];
            // Сортировка по убыванию времени: свежие в начале массива, старые в конце
            return updated.sort((a, b) => (b.ts || Date.now()) - (a.ts || Date.now()));
          });

          if (peerId && globalContactsDb && peerId !== 'global-chat') {
            const isCurrentlyInThisChat = window.location.pathname.includes(peerId);
            const shouldIncrement = !isCurrentlyInThisChat && !isBackgroundSync && message.type !== 'sent';

            contactsService.updateLastMessage(globalContactsDb, peerId, message.text, message.ts || Date.now(), shouldIncrement);

            if (isCurrentlyInThisChat) {
              contactsService.clearUnread(globalContactsDb, peerId);
            }
          }
        });

        if (!isMounted) {
          if (roomActions?.leaveRoom) roomActions.leaveRoom();
          return;
        }

        activeHandle = roomActions;
        setRoomHandle(roomActions);

        if (peerId && globalContactsDb && roomActions.dbAddress) {
          contactsService.updateChatDbAddress(globalContactsDb, peerId, roomActions.dbAddress);
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
  }, [isReady, joinRoom, helia, nodeId, peerId]);

  const handleScroll = async (e: UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    if (isLoadingRef.current || !roomHandle) return;

    const scrollOffset = Math.abs(target.scrollTop);
    isUserScrolledUp.current = scrollOffset > 50;

    const isAtTop = scrollOffset + target.clientHeight >= target.scrollHeight - 10;

    if (isAtTop && roomHandle.hasMoreHistory && roomHandle.hasMoreHistory()) {
      isLoadingRef.current = true;
      setIsLoadingMore(true);
      try {
        await roomHandle.loadMoreHistory();
      } catch (err) {
        console.error("Ошибка при подгрузке истории:", err);
      } finally {
        isLoadingRef.current = false;
        setIsLoadingMore(false);
      }
    }
  };

  const handleSendMessage = async () => {
    const text = draft.trim();
    if (!text || !roomHandle) return;

    isUserScrolledUp.current = false;

    try {
      const now = Date.now();
      await roomHandle.sendMessage(text);
      setDraft('');

      if (helia && peerId) {
        try {
          const myPeerId = (helia as any).libp2p.peerId.toString();
          const targetTopic = `${CONFIG.TOPICS.ANNOUNCE_NEW_MESSAGE}${peerId}`;
          const notificationData = { from: myPeerId, text, ts: now };
          const encoded = new TextEncoder().encode(JSON.stringify(notificationData));
          await (helia as any).libp2p.services.pubsub.publish(targetTopic, encoded);
        } catch (err) {
          console.warn('⚠️ Не удалось отправить фоновый пуш:', err);
        }
      }          
    } catch {
      console.error('Ошибка отправки сообщения');
    }
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

  return {
    navigate,
    displayName,
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
    handleInput
  };
};