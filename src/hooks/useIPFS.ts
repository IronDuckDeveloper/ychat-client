import { useState, useEffect, useCallback } from 'react'
import { createBrowserHelia } from '../lib/helia'
import type { Helia } from 'helia'
import { pipe } from 'it-pipe'

let heliaInstance: Helia | null = null

export const useIPFS = () => {
  const [isReady, setIsReady] = useState<boolean>(false)
  const [nodeId, setNodeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      try {
        if (heliaInstance) {
          setIsReady(true)
          setNodeId(heliaInstance.libp2p.peerId.toString())
          return
        }

        const helia = await createBrowserHelia();
        (window as any).helia = helia

        const libp2p = helia.libp2p
        const pubsub = libp2p.services.pubsub as any

        heliaInstance = helia
        setNodeId(libp2p.peerId.toString())
        setIsReady(true)

        const interval = setInterval(() => {
          if (heliaInstance) {
            const allPeers = libp2p.getPeers()
            const pubsubPeers = pubsub.getPeers()
            const topics = pubsub.getTopics()
            
            console.log(
              `📊 Network: Peers=${allPeers.length} | PubSub=${pubsubPeers.length} | Topics=${JSON.stringify(topics)}`
            )
          }
        }, 5000)

        return () => clearInterval(interval)
      } catch (err: any) {
        console.error('Ошибка инициализации:', err)
        setError(err?.message ? err.message : String(err))
        setIsReady(false)
      }
    }

    init()
  }, [])

  const joinRoomCallback = useCallback(
    async (roomName: string, onMessage: (message: string) => void) => {
      if (!heliaInstance) {
        throw new Error('Helia node is not ready yet')
      }
      return await joinRoom(heliaInstance, roomName, onMessage)
    },
    []
  )

  return {
    helia: heliaInstance,
    isReady,
    nodeId,
    error,
    joinRoom: joinRoomCallback
  }
}

export const joinRoom = async (
  helia: Helia,
  roomName: string,
  onMessage: (message: string) => void
) => {
  const libp2p = helia.libp2p
  const pubsub = libp2p.services.pubsub as any
  const ANNOUNCE_TOPIC = 'rooms:announce'

const notifyPeer = async (peerId: any) => {
  let stream;
  try {
    stream = await libp2p.dialProtocol(peerId, '/p2p-relay/v1/announce');
    
    // Кодируем сразу в JSON-строку
    const data = new TextEncoder().encode(JSON.stringify(roomName));
    
    // Отправляем
    // await stream.send(data);

    await pipe(
  [data],  // Источник данных (массив или генератор)
  stream   // Куда отправляем (наш стрим)
)
    
    console.log(`🚀 [Protocol] Анонс ${roomName} отправлен пиру ${peerId.toString().slice(-6)}`);
    
  } catch (err) {
    console.error('❌ Ошибка отправки анонса:', err);
  }
};

  // 1. Сразу подписываемся сами
  await pubsub.subscribe(roomName)
  console.log(`📡 Браузер подписан на: ${roomName}`)

  // 2. СЛУШАЕМ НОВЫЕ ПОДКЛЮЧЕНИЯ (Критически важно!)
  // Как только сервер подцепится (реконнект), мы тут же отправим ему анонс
  const onConnect = (evt: any) => {
    const peerId = evt.detail
    console.log(`🤝 Новое соединение: ${peerId.toString().slice(-6)}. Отправляю анонс...`)
    notifyPeer(peerId)
  }
  libp2p.addEventListener('peer:connect', onConnect)

  // 3. Уведомляем тех, кто уже подключен
  libp2p.getPeers().forEach(peerId => notifyPeer(peerId))

  // 4. Публикуем в общий топик (для других серверов/браузеров)
  const announcementPayload = new TextEncoder().encode(JSON.stringify({ room: roomName, ts: Date.now() }))
  await pubsub.publish(ANNOUNCE_TOPIC, announcementPayload)

  // Обработчик сообщений
  const handler = (evt: any) => {
    const message = evt.detail || evt
    if (message?.topic === roomName) {
      try {
        const text = new TextDecoder().decode(message.data)
        const decoded = JSON.parse(text)
        onMessage(decoded.text)
      } catch (e) { console.error('Ошибка парсинга:', e) }
    }
  }

  pubsub.addEventListener('message', handler)

  return {
    sendMessage: async (text: string) => {
      const encoded = new TextEncoder().encode(JSON.stringify({ text, ts: Date.now() }))
      await pubsub.publish(roomName, encoded)
      console.log(`✅ Отправлено: ${text}`)
    },
    leaveRoom: () => {
      libp2p.removeEventListener('peer:connect', onConnect)
      pubsub.removeEventListener('message', handler)
      pubsub.unsubscribe(roomName)
    }
  }
}