import React, { useMemo } from 'react';
import {
  X,
  Reply as ReplyIcon,
  File as FileIcon,
  FileText,
  FileArchive,
  FileSpreadsheet,
  FileCode,
  Music,
  Video as VideoIcon,
} from 'lucide-react';
import type { ReplyInfo } from '../lib/p2p/services/roomService.ts';
import '../styles/ReplyPreview.scss';

interface ReplyPreviewProps {
  replyTo: ReplyInfo;
  variant?: 'composer' | 'quote';
  onRemove?: () => void;
  onClick?: () => void;
}

type IconMeta = { Icon: typeof FileIcon; color: string };

const getFileIconMetaByName = (name: string): IconMeta => {
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

const getReplyIconMeta = (replyTo: ReplyInfo): IconMeta => {
  if (!replyTo.attachmentName) return { Icon: ReplyIcon, color: '#8457A0' };
  if (replyTo.attachmentMime?.startsWith('video/'))
    return { Icon: VideoIcon, color: '#6b7280' };
  if (replyTo.attachmentMime?.startsWith('audio/'))
    return { Icon: Music, color: '#14b8a6' };
  return getFileIconMetaByName(replyTo.attachmentName);
};

const getReplySnippet = (replyTo: ReplyInfo): string => {
  if (replyTo.text?.trim()) return replyTo.text.trim();
  if (replyTo.attachmentName) return `📎 ${replyTo.attachmentName}`;
  return '📎 Вложение';
};

const ReplyPreview: React.FC<ReplyPreviewProps> = ({
  replyTo,
  variant = 'quote',
  onRemove,
  onClick,
}) => {
  const { Icon, color } = useMemo(() => getReplyIconMeta(replyTo), [replyTo]);
  const snippet = useMemo(() => getReplySnippet(replyTo), [replyTo]);
  const isComposer = variant === 'composer';

  return (
    <div
      className={`reply-preview reply-preview--${variant}`}
      onClick={!isComposer ? onClick : undefined}
      role={!isComposer && onClick ? 'button' : undefined}
      tabIndex={!isComposer && onClick ? 0 : undefined}
    >
      <div
        className="reply-preview-icon"
        style={{ background: `${color}26`, color }}
      >
        <Icon size={isComposer ? 18 : 16} />
      </div>

      <span className="reply-preview-text">{snippet}</span>

      {isComposer && onRemove && (
        <button
          type="button"
          className="reply-preview-remove"
          title="Отменить ответ"
          aria-label="Отменить ответ"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
};

export default ReplyPreview;
