import React from 'react';
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
  /** Класс обёртки: context-menu | header-context-menu | attachment-context-menu */
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
};

const ContextMenu: React.FC<Props> = ({
  items,
  className = 'context-menu',
  onClick,
}) => {
  return (
    <div className={className} onClick={onClick}>
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
    </div>
  );
};

export default ContextMenu;