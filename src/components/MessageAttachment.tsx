import React, { useState, useEffect } from 'react';
import { File, Download, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { globalHelia } from '../lib/p2p/services/authService.ts';
import { type FileAttachment, fetchFileFromHelia } from '../lib/p2p/services/fileService.ts'; 
import '../styles/MessageAttachment.scss';

interface MessageAttachmentProps {
  attachment: FileAttachment;
  onDelete?: () => void; // 🔥 Проп для связи с БД (чтобы удалить само сообщение)
}

const MessageAttachment: React.FC<MessageAttachmentProps> = ({ attachment, onDelete }) => {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false); // 🔥 Состояние удаленного файла

  const fileMimeType = React.useMemo(() => {
    const type = attachment.type;
    if (type === 'image') return 'image/jpeg';
    if (type && type.includes('/') && type !== 'application/octet-stream') return type; 
    const extension = attachment.name ? attachment.name.split('.').pop()?.toLowerCase() : '';
    const mimeMap: Record<string, string> = {
      'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
      'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
      'heic': 'image/heif', 'bmp': 'image/bmp'
    };
    return mimeMap[extension || ''] || 'application/octet-stream';
  }, [attachment]);

  const isImage = React.useMemo(() => fileMimeType.startsWith('image/'), [fileMimeType]);

  useEffect(() => {
    if (!isImage || !globalHelia || !attachment.cid || isDeleted) return;

    let isMounted = true;
    const autoLoadImage = async () => {
      try {
        setDownloadError(false);
        const url = await fetchFileFromHelia(globalHelia, attachment.cid, fileMimeType, attachment.serverCid, attachment.encryptionKey, 20000, attachment.serverRelays);
        if (isMounted && url) setFileUrl(url);
      } catch (err) {
        console.error(`❌ Ошибка автозагрузки изображения ${attachment.cid}:`, err);
        if (isMounted) setDownloadError(true);
      }
    };

    autoLoadImage();
    return () => { isMounted = false; };
  }, [attachment.cid, isImage, fileMimeType, isDeleted]);

  // 🔥 Обработчик удаления
const handleDeleteFile = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!window.confirm('Удалить этот файл локально?')) return;

    // Если родитель передал функцию удаления — вызываем её один раз
    if (onDelete) {
      onDelete();
    }
  };

  const handleDownloadFile = async (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation(); // Чтобы событие не всплыло дальше, если есть обертки

  if (!globalHelia || !attachment.cid || isDownloading || isDeleted) return;

  try {
    setIsDownloading(true);
    setDownloadError(false);
    console.log(`⬇️ [MessageAttachment] Запрос на скачивание: ${attachment.cid}`);

    // Получаем URL из P2P сети через твой сервис
    const url = await fetchFileFromHelia(globalHelia, attachment.cid, fileMimeType, attachment.serverCid, attachment.encryptionKey, 20000, attachment.serverRelays);
    
    if (!url) {
      throw new Error("Не удалось получить URL из Helia");
    }

    // Создаем DOM-элемент для скачивания
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.name || 'file';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Если это картинка, сохраняем URL, чтобы она появилась в UI
    if (isImage) {
      setFileUrl(url);
    }
  } catch (err) {
    console.error('❌ Ошибка при скачивании файла:', err);
    setDownloadError(true);
  } finally {
    setIsDownloading(false);
  }
};

  // Если файл был удален, показываем заглушку
  if (isDeleted) {
    return (
      <div className="attachment-file-card deleted">
        <div className="file-info">
          <Trash2 size={20} color="#ff4d4f" />
          <span style={{ marginLeft: '8px', color: '#ff4d4f' }}>Файл удален</span>
        </div>
      </div>
    );
  }

  if (isImage) {
    return (
      <div className="attachment-image-wrapper">
        {/* 🔥 Кнопка удаления для картинок (крепится в правом верхнем углу) */}
        <button 
          className="delete-file-btn" 
          onClick={handleDeleteFile}
          title="Удалить файл"
          style={{ position: 'absolute', top: 5, right: 5, zIndex: 10, background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%', padding: '5px', cursor: 'pointer' }}
        >
          <Trash2 size={16} color="white" />
        </button>

        {fileUrl ? (
          <img src={fileUrl} alt={attachment.name || 'image'} className="attachment-img loaded" />
        ) : (
          <div className="image-loading-placeholder">
            {attachment.preview ? (
              <img src={attachment.preview || undefined} alt="blur-preview" className="attachment-img blurred" />
            ) : (
              <div className="empty-preview-box" />
            )}
            
            <div className="placeholder-overlay">
              {downloadError ? (
                <button className="retry-file-btn" onClick={handleDownloadFile} title="Ошибка загрузки. Повторить?">
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
    );
  }

  return (
    <div className="attachment-file-card">
      <div className="file-info">
        <div className="file-icon-wrapper">
          <File size={20} />
        </div>
        <div className="file-metadata">
          <span className="file-name" title={attachment.name || 'file'}>
            {attachment.name || 'Без названия'}
          </span>
          <span className="file-size">
            {attachment.size ? `${(attachment.size / 1024).toFixed(1)} КБ` : 'Размер неизвестен'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {/* 🔥 Кнопка удаления для обычных файлов */}
        <button 
          className="file-action-btn"
          onClick={handleDeleteFile}
          title="Удалить файл"
        >
          <Trash2 size={16} color="#ff4d4f" />
        </button>

        <button 
          className={`file-action-btn ${downloadError ? 'error' : ''}`}
          disabled={isDownloading} 
          onClick={handleDownloadFile}
          title="Скачать файл"
        >
          {isDownloading ? <Loader2 size={16} className="animate-spin" /> : downloadError ? <AlertTriangle size={16} /> : <Download size={16} />}
        </button>
      </div>
    </div>
  );
};

export default MessageAttachment;