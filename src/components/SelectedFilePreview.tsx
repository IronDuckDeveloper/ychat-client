import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  File as FileIcon,
  FileText,
  FileArchive,
  FileSpreadsheet,
  FileCode,
  Music,
  Video as VideoIcon,
} from 'lucide-react';
import '../styles/SelectedFilePreview.scss';

interface SelectedFilePreviewProps {
  file: File;
  onRemove: () => void;
  disabled?: boolean;
}

type IconMeta = { Icon: typeof FileIcon; color: string };

// Иконка + цвет по расширению файла. Используется для всех типов, кроме
// картинок (для них рендерим настоящую миниатюру) и видео/аудио (свои иконки).
const getFileIconMeta = (name: string): IconMeta => {
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
      'js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css',
      'py', 'java', 'c', 'cpp', 'go', 'rs', 'sh',
    ].includes(ext)
  ) {
    return { Icon: FileCode, color: '#8b5cf6' };
  }

  return { Icon: FileIcon, color: '#3b82f6' };
};

const getPreviewIconMeta = (file: File): IconMeta => {
  if (file.type.startsWith('video/')) return { Icon: VideoIcon, color: '#6b7280' };
  if (file.type.startsWith('audio/')) return { Icon: Music, color: '#14b8a6' };
  return getFileIconMeta(file.name);
};

const formatFileSize = (bytes: number): string => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
};

/**
 * Превью файла, выбранного для отправки, но ещё не загруженного в сеть.
 * Рендерится над строкой ввода сообщения; крестик снимает файл с отправки.
 */
const SelectedFilePreview: React.FC<SelectedFilePreviewProps> = ({
  file,
  onRemove,
  disabled,
}) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const isImage = file.type.startsWith('image/');

  useEffect(() => {
    if (!isImage) {
      setThumbnailUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setThumbnailUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, isImage]);

  const { Icon: FileTypeIcon, color: fileIconColor } = useMemo(
    () => getPreviewIconMeta(file),
    [file],
  );

  return (
    <div className="selected-file-preview">
      <div className="selected-file-preview-thumb">
        {isImage && thumbnailUrl ? (
          <img src={thumbnailUrl} alt={file.name} />
        ) : (
          <div
            className="selected-file-preview-icon"
            style={{ background: `${fileIconColor}26`, color: fileIconColor }}
          >
            <FileTypeIcon size={18} />
          </div>
        )}
      </div>

      <div className="selected-file-preview-info">
        <span className="selected-file-preview-name" title={file.name}>
          {file.name}
        </span>
        <span className="selected-file-preview-size">
          {formatFileSize(file.size)}
        </span>
      </div>

      <button
        type="button"
        className="selected-file-preview-remove"
        title="Убрать файл"
        aria-label="Убрать файл"
        onClick={onRemove}
        disabled={disabled}
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default SelectedFilePreview;
