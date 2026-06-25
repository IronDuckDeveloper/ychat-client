import React from 'react';
import '../styles/headerActionButton.scss';

type ButtonVariant = 'default' | 'logout';

interface HeaderActionButtonProps {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  icon: React.ReactNode;
  title: string;
  variant?: ButtonVariant;
  disabled?: boolean;
}

const HeaderActionButton = ({ 
  onClick, 
  icon, 
  title, 
  variant = 'default', 
  disabled = false
}: HeaderActionButtonProps) => {
  return (
    <button
      className={`header-action-btn ${variant === 'logout' ? 'logout-btn' : ''}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {icon}
    </button>
  );
};

export default HeaderActionButton;