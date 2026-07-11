import React, { useState, useEffect } from 'react';
import { File, Download, AlertTriangle, Loader2 } from 'lucide-react';
import { globalHelia } from '../lib/p2p/services/authService.ts';
import { fetchAvatarFromHelia } from '../lib/p2p/services/avatarService.ts'; 
import { type FileAttachment } from '../lib/p2p/services/fileService.ts';
import '../styles/MessageAttachment.scss';

interface MessageAttachmentProps {
  attachment: FileAttachment;
}

const MessageAttachment: React.FC<MessageAttachmentProps> = ({ attachment }) => {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  const isImage = React.useMemo(() => {
    if (attachment.type === 'image') return true;
    
    const runtimeMime = (attachment as any).mimeType;
    if (typeof runtimeMime === 'string' && runtimeMime.startsWith('image/')) return true;
    
    if (attachment.name) {
      return /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(attachment.name);
    }
    
    return false;
  }, [attachment]);

  useEffect(() => {
    if (!isImage || !globalHelia || !attachment.cid) return;

    let isMounted = true;
    
    const autoLoadImage = async () => {
      try {
        setDownloadError(false);
        const url = await fetchAvatarFromHelia(globalHelia, attachment.cid);
        if (isMounted) {
          setFileUrl(url);
        }
      } catch (err) {
        console.error(`❌ Ошибка автозагрузки изображения ${attachment.cid}:`, err);
        if (isMounted) {
          setDownloadError(true);
        }
      }
    };

    autoLoadImage();
    return () => { isMounted = false; };
  }, [attachment.cid, isImage]);

  const handleDownloadFile = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!globalHelia || !attachment.cid || isDownloading) return;

    try {
      setIsDownloading(true);
      setDownloadError(false);
      
      const url = await fetchAvatarFromHelia(globalHelia, attachment.cid);
      
      if (!url) throw new Error("URL не был получен");

      const link = document.createElement('a');
      link.href = url; 
      link.download = attachment.name || 'file'; 
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      if (isImage) setFileUrl(url);
    } catch (err) {
      console.error('❌ Не удалось скачать файл по требованию:', err);
      setDownloadError(true);
    } finally {
      setIsDownloading(false);
    }
  };

  if (isImage) {
    return (
      <div className="attachment-image-wrapper">
        {fileUrl ? (
          <img 
            src={fileUrl} 
            alt={attachment.name || 'image'} 
            className="attachment-img loaded" 
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

      <button 
        className={`file-action-btn ${downloadError ? 'error' : ''}`}
        disabled={isDownloading} 
        onClick={handleDownloadFile}
        title="Скачать файл"
      >
        {isDownloading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : downloadError ? (
          <AlertTriangle size={16} />
        ) : (
          <Download size={16} />
        )}
      </button>
    </div>
  );
};

export default MessageAttachment;