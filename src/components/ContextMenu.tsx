import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import '../styles/context-menu.scss';

export type ContextMenuItem = {
  label: string;
  icon?: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  disabled?: boolean;
};

type Props = {
  items: ContextMenuItem[];
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  anchorEl: HTMLElement | null;
};

const ContextMenu: React.FC<Props> = ({
  items,
  className = '',
  onClick,
  anchorEl,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    visibility: 'hidden',
    zIndex: 9999,
  });

  useEffect(() => {
    if (!anchorEl || !menuRef.current) return;

    const anchorRect = anchorEl.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();

    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const openUp = spaceBelow < menuRect.height + 12;

    const top = openUp
      ? anchorRect.top - menuRect.height - 6
      : anchorRect.bottom + 6;

    let left = anchorRect.right - menuRect.width;
    if (left < 8) left = 8;

    setStyle({
      position: 'fixed',
      top,
      left,
      bottom: 'auto',
      right: 'auto',
      margin: 0,
      zIndex: 9999,
      visibility: 'visible',
    });
  }, [anchorEl]);

  if (!anchorEl) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      style={style}
      onClick={onClick}
    >
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          className={item.danger ? 'delete-option' : undefined}
          disabled={item.disabled}
          onClick={(e) => {
            e.stopPropagation();
            item.onClick(e);
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
};

export default ContextMenu;