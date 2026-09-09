import React from 'react';
import '../styles/confirmModal.scss';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  isDanger = false,
  onConfirm,
  onCancel
}) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="confirm-modal-title">{title}</h3>
        <p className="confirm-modal-message">{message}</p>

        <div className="confirm-modal-actions">
          <button className="btn-cancel" onClick={onCancel}>
            {cancelText ?? t('confirmModal.cancel')}
          </button>
          <button
            className={isDanger ? "btn-confirm danger" : "btn-confirm"}
            onClick={onConfirm}
          >
            {confirmText ?? t('confirmModal.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};