import React, { useState, useEffect } from 'react';
import {
  File,
  Download,
  AlertTriangle,
  Loader2,
  Trash2,
  Music,
  Play,
  Video as VideoIcon,
  FileText,
  FileArchive,
  FileSpreadsheet,
  FileCode,
  MoreVertical,
  Forward,
} from 'lucide-react';
import { globalHelia } from '../lib/p2p/services/authService.ts';
import {
  type FileAttachment,
  fetchFileFromHelia,
  convertBlobForDownload,
} from '../lib/p2p/services/fileService.ts';
import '../styles/MessageAttachment.scss';
import { createPortal } from 'react-dom';
import ContextMenu from './ContextMenu';

interface MessageAttachmentProps {
  attachment: FileAttachment;
  onDelete?: () => void; // 🔥 Проп для связи с БД (чтобы удалить само сообщение)
}

const MessageAttachment: React.FC<MessageAttachmentProps> = ({
  attachment,
  onDelete,
}) => {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false); // 🔥 Состояние удаленного файла
  const [duration, setDuration] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const fileMimeType = React.useMemo(() => {
    const type = attachment.type;
    if (type === 'image') return 'image/jpeg';
    if (type && type.includes('/') && type !== 'application/octet-stream')
      return type;
    const extension = attachment.name
      ? attachment.name.split('.').pop()?.toLowerCase()
      : '';
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      heic: 'image/heif',
      bmp: 'image/bmp',
      // 🔥 Аудио: браузер не всегда проставляет корректный MIME для
      // распространённых аудиоконтейнеров, поэтому добираем по расширению
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      flac: 'audio/flac',
      weba: 'audio/webm',
      opus: 'audio/opus',
      // 🔥 Видео
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      mkv: 'video/x-matroska',
      avi: 'video/x-msvideo',
      m4v: 'video/x-m4v',
      '3gp': 'video/3gpp',
    };
    return mimeMap[extension || ''] || 'application/octet-stream';
  }, [attachment]);

  const isImage = React.useMemo(
    () => fileMimeType.startsWith('image/'),
    [fileMimeType],
  );
  const isAudio = React.useMemo(
    () => fileMimeType.startsWith('audio/'),
    [fileMimeType],
  );
  const isVideo = React.useMemo(
    () => fileMimeType.startsWith('video/'),
    [fileMimeType],
  );

  useEffect(() => {
    if (!isImage || !globalHelia || !attachment.cid || isDeleted) return;

    let isMounted = true;
    const autoLoadImage = async () => {
      try {
        setDownloadError(false);
        const url = await fetchFileFromHelia(
          globalHelia,
          attachment.cid,
          fileMimeType,
          attachment.serverCid,
          attachment.encryptionKey,
          20000,
          attachment.serverRelays,
        );
        if (isMounted && url) setFileUrl(url);
      } catch (err) {
        console.error(
          `❌ Ошибка автозагрузки изображения ${attachment.cid}:`,
          err,
        );
        if (isMounted) setDownloadError(true);
      }
    };

    autoLoadImage();
    return () => {
      isMounted = false;
    };
  }, [attachment.cid, isImage, fileMimeType, isDeleted]);

useEffect(() => {
  if (!isFullscreen) return;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setIsFullscreen(false);
  };

  document.addEventListener('keydown', handleKeyDown);

  // Блокируем скролл на html и body
  const prevBody = document.body.style.overflow;
  const prevHtml = document.documentElement.style.overflow;
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';

  return () => {
    document.removeEventListener('keydown', handleKeyDown);
    document.body.style.overflow = prevBody;
    document.documentElement.style.overflow = prevHtml;
  };
}, [isFullscreen]);

useEffect(() => {
  if (!isMenuOpen) return;
  const close = () => setIsMenuOpen(false);
  document.addEventListener('click', close);
  return () => document.removeEventListener('click', close);
}, [isMenuOpen]);

  // 🔥 Обработчик удаления
  const handleDeleteFile = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!window.confirm('Удалить этот файл локально?')) return;

    if (onDelete) {
      onDelete();
    }
  };

  const handleDownloadFile = async (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();

  if (!globalHelia || !attachment.cid || isDownloading || isDeleted) return;

  try {
    setIsDownloading(true);
    setDownloadError(false);

    const url = await fetchFileFromHelia(globalHelia, attachment.cid, fileMimeType, attachment.serverCid, attachment.encryptionKey, 20000, attachment.serverRelays);
    
    if (!url) {
      throw new Error("Не удалось получить URL из Helia");
    }

    let downloadUrl = url;
    let downloadName = attachment.name || 'file';
    let convertedUrl: string | null = null;

    // 🔥 На диск WebP не сохраняем — конвертируем в JPEG/PNG в зависимости от прозрачности
    if (isImage && fileMimeType === 'image/webp') {
      try {
        const originalBlob = await (await fetch(url)).blob();
        const converted = await convertBlobForDownload(originalBlob, downloadName);
        convertedUrl = URL.createObjectURL(converted.blob);
        downloadUrl = convertedUrl;
        downloadName = converted.name;
      } catch (convErr) {
        console.warn('[Download] Конвертация не удалась, скачиваем WebP как есть:', convErr);
      }
    }

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (convertedUrl) {
      URL.revokeObjectURL(convertedUrl);
    }
    
    if (isImage || isAudio || isVideo) {
      setFileUrl(url); // для плеера/просмотра в чате оставляем оригинальный WebP — конвертация только для скачанного файла
    }
  } catch (err) {
    console.error('❌ Ошибка при скачивании файла:', err);
    setDownloadError(true);
  } finally {
    setIsDownloading(false);
  }
};

  // 🔥 Отдельная загрузка для аудио: только подгружает и включает плеер,
  // без принудительного сохранения файла на диск (в отличие от handleDownloadFile)
  const handleLoadAudio = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (
      !globalHelia ||
      !attachment.cid ||
      isDownloading ||
      isDeleted ||
      fileUrl
    )
      return;

    try {
      setIsDownloading(true);
      setDownloadError(false);
      const url = await fetchFileFromHelia(
        globalHelia,
        attachment.cid,
        fileMimeType,
        attachment.serverCid,
        attachment.encryptionKey,
        20000,
        attachment.serverRelays,
      );
      if (url) {
        setFileUrl(url);
      } else {
        setDownloadError(true);
      }
    } catch (err) {
      console.error(`❌ Ошибка загрузки аудио ${attachment.cid}:`, err);
      setDownloadError(true);
    } finally {
      setIsDownloading(false);
    }
  };

  // 🔥 Отдельная загрузка для видео: подгружает и включает плеер,
  // без принудительного скачивания файла (в отличие от handleDownloadFile)
  const handleLoadVideo = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (
      !globalHelia ||
      !attachment.cid ||
      isDownloading ||
      isDeleted ||
      fileUrl
    )
      return;

    try {
      setIsDownloading(true);
      setDownloadError(false);
      const url = await fetchFileFromHelia(
        globalHelia,
        attachment.cid,
        fileMimeType,
        attachment.serverCid,
        attachment.encryptionKey,
        20000,
        attachment.serverRelays,
      );
      if (url) {
        setFileUrl(url);
      } else {
        setDownloadError(true);
      }
    } catch (err) {
      console.error(`❌ Ошибка загрузки видео ${attachment.cid}:`, err);
      setDownloadError(true);
    } finally {
      setIsDownloading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // 🔥 Иконка + акцентный цвет для generic-карточки в зависимости от расширения
  const getFileIconMeta = (
    name: string,
  ): { Icon: typeof File; color: string } => {
    const ext = name.split('.').pop()?.toLowerCase() || '';

    if (ext === 'pdf') return { Icon: FileText, color: '#ef4444' };
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext))
      return { Icon: FileArchive, color: '#eab308' };
    if (['doc', 'docx', 'odt', 'rtf'].includes(ext))
      return { Icon: FileText, color: '#3b82f6' };
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext))
      return { Icon: FileSpreadsheet, color: '#22c55e' };
    if (['ppt', 'pptx', 'odp'].includes(ext))
      return { Icon: FileText, color: '#f97316' };
    if (['txt', 'md', 'log'].includes(ext))
      return { Icon: FileText, color: '#a3a3a3' };
    if (
      [
        'js',
        'ts',
        'tsx',
        'jsx',
        'json',
        'html',
        'css',
        'py',
        'java',
        'c',
        'cpp',
        'go',
        'rs',
        'sh',
      ].includes(ext)
    ) {
      return { Icon: FileCode, color: '#8b5cf6' };
    }

    return { Icon: File, color: '#3b82f6' }; // дефолт — как сейчас
  };

  const attachmentMenu = (
  <div
    className="attachment-menu-wrap"
    onClick={(e) => e.stopPropagation()}
  >
    <button
      type="button"
      className="attachment-menu-btn"
      title="Опции"
      onClick={(e) => {
        e.stopPropagation();
        setIsMenuOpen((v) => !v);
      }}
    >
      <MoreVertical size={16} color="white" />
    </button>

    {isMenuOpen && (
      <ContextMenu
        className="attachment-item-menu"
        items={[
          {
            label: 'Скачать',
            icon: <Download size={16} />,
            onClick: (e) => {
              handleDownloadFile(e);
              setIsMenuOpen(false);
            },
          },
          {
            label: 'Переслать',
            icon: <Forward size={16} />, // или <Share2 size={16} />
            onClick: () => {
              // TODO: логика пересылки
              console.log('Переслать', attachment.cid);
              setIsMenuOpen(false);
            },
          },
          {
            label: 'Удалить',
            icon: <Trash2 size={16} />,
            danger: true,
            onClick: (e) => {
              handleDeleteFile(e);
              setIsMenuOpen(false);
            },
          },
        ]}
      />
    )}
  </div>
);

  // Если файл был удален, показываем заглушку
  if (isDeleted) {
    return (
      <div className="attachment-file-card deleted">
        <div className="file-info">
          <Trash2 size={20} color="#ff4d4f" />
          <span style={{ marginLeft: '8px', color: '#ff4d4f' }}>
            Файл удален
          </span>
        </div>
      </div>
    );
  }

  if (isImage) {
  return (
    <>
      <div
        className="attachment-image-wrapper"
        style={{ position: 'relative' }}
      >
        {attachmentMenu}

        {fileUrl ? (
          <img
            src={fileUrl}
            alt={attachment.name || 'image'}
            className="attachment-img loaded"
            onClick={() => setIsFullscreen(true)}
            style={{ cursor: 'pointer' }}
          />
        ) : (
          <div className="image-loading-placeholder">
            {attachment.preview ? (
              <img
                src={attachment.preview || undefined}
                alt="blur-preview"
                className="attachment-img blurred"
              />
            ) : (
              <div className="empty-preview-box" />
            )}

            <div className="placeholder-overlay">
              {downloadError ? (
                <button
                  className="retry-file-btn"
                  onClick={handleDownloadFile}
                  title="Ошибка загрузки. Повторить?"
                >
                  <AlertTriangle size={18} className="error-icon" />
                  <span>Повторить</span>
                </button>
              ) : (
                <div className="spinner-box">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 🔥 Полноэкранный просмотр */}
      {isFullscreen && fileUrl && createPortal(
        <div
          className="image-fullscreen-overlay"
          onClick={() => setIsFullscreen(false)}
        >
          <button
            className="image-fullscreen-close"
            onClick={(e) => {
              e.stopPropagation();
              setIsFullscreen(false);
            }}
            title="Закрыть"
          >
            ✕
          </button>

          <img
            src={fileUrl}
            alt={attachment.name || 'image'}
            className="image-fullscreen-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </>
  );
}

  // 🔥 Карточка аудио с нативным HTML5-плеером
  if (isAudio) {
    return (
      <div className="attachment-audio-card">
        <div className="audio-card-top">
          <div className="file-icon-wrapper">
            <Music size={20} />
          </div>
          <div className="file-metadata">
            <span className="file-name" title={attachment.name || 'audio'}>
              {attachment.name || 'Аудио'}
            </span>
            <span
              className="file-size"
              style={{ marginLeft: '8px', fontSize: '0.9em', color: '#a3a3a3' }}
            >
              {duration
                ? formatDuration(duration)
                : attachment.size
                  ? `${(attachment.size / 1024).toFixed(1)} КБ`
                  : ''}
            </span>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            {attachmentMenu}
          </div>
        </div>

        <div className="audio-player-area">
          {fileUrl ? (
            <audio
              controls
              src={fileUrl}
              className="audio-player"
              preload="metadata"
              // 🔥 Вытаскиваем длительность сразу после подгрузки файла
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            >
              Ваш браузер не поддерживает воспроизведение аудио.
            </audio>
          ) : downloadError ? (
            <button
              className="retry-file-btn audio-retry"
              onClick={handleLoadAudio}
              title="Ошибка загрузки. Повторить?"
            >
              <AlertTriangle size={16} className="error-icon" />
              <span>Повторить</span>
            </button>
          ) : (
            <button
              className="audio-load-btn"
              onClick={handleLoadAudio}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              <span>{isDownloading ? 'Загрузка...' : 'Воспроизвести'}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // 🔥 Карточка видео: превью-бокс фиксированного размера (как у картинки),
  // плеер подгружается по клику, чтобы не тянуть тяжёлые файлы автоматически
  if (isVideo) {
    return (
      <div className="attachment-video-wrapper">

        {attachmentMenu}

        {fileUrl ? (
          <video
            controls
            playsInline /* 🔥 Жизненно важно для Safari (iOS/macOS) */
            webkit-playsinline="true"
            className="attachment-video loaded"
            preload="metadata"
          >
            {/* 🔥 Safari лучше воспринимает Blob URL, если явно указать type через source */}
            <source src={fileUrl} type={fileMimeType} />
            Ваш браузер не поддерживает воспроизведение видео.
          </video>
        ) : (
          <div className="video-loading-placeholder">
            {attachment.preview ? (
              <img
                src={attachment.preview || undefined}
                alt="video-preview"
                className="attachment-img blurred"
              />
            ) : (
              <div className="empty-preview-box video-empty">
                <VideoIcon size={28} color="#6b7280" />
              </div>
            )}

            <div className="placeholder-overlay">
              {downloadError ? (
                <button
                  className="retry-file-btn"
                  onClick={handleLoadVideo}
                  title="Ошибка загрузки. Повторить?"
                >
                  <AlertTriangle size={18} className="error-icon" />
                  <span>Повторить</span>
                </button>
              ) : (
                <button
                  className="video-play-btn"
                  onClick={handleLoadVideo}
                  disabled={isDownloading}
                  title="Воспроизвести"
                >
                  {isDownloading ? (
                    <Loader2 size={22} className="animate-spin" />
                  ) : (
                    <Play size={22} fill="white" />
                  )}
                </button>
              )}
            </div>

            {attachment.size ? (
              <span className="video-size-badge">
                {(attachment.size / 1024 / 1024).toFixed(1)} МБ
              </span>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  const { Icon: FileTypeIcon, color: fileIconColor } = getFileIconMeta(
    attachment.name || '',
  );

  return (
    <div className="attachment-file-card">
      <div className="file-info">
        <div
          className="file-icon-wrapper"
          style={{ background: `${fileIconColor}26`, color: fileIconColor }}
        >
          <FileTypeIcon size={20} />
        </div>
        <div className="file-metadata">
          <span className="file-name" title={attachment.name || 'file'}>
            {attachment.name || 'Без названия'}
          </span>
          <span className="file-size">
            {attachment.size
              ? `${(attachment.size / 1024).toFixed(1)} КБ`
              : 'Размер неизвестен'}
          </span>
        </div>
      </div>
      {attachmentMenu}
    </div>
  );
};

export default MessageAttachment;
