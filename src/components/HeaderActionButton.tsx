import React, { useState, useRef, useEffect } from 'react';
import '../styles/headerActionButton.scss';

type ButtonVariant = 'default' | 'logout';

interface HeaderActionButtonProps {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  icon: React.ReactNode;
  title: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  delay?: number; // Настраиваемая задержка в мс (по умолчанию 500)
}

const HeaderActionButton = ({ 
  onClick, 
  icon, 
  title, 
  variant = 'default', 
  disabled = false,
  delay = 500
}: HeaderActionButtonProps) => {
  const [isTemporarilyDisabled, setIsTemporarilyDisabled] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Если кнопка заблокирована внутренним таймером — игнорируем клик
    if (isTemporarilyDisabled) return;

    // Вызываем оригинальный onClick
    onClick(e);

    // Блокируем кнопку и запускаем таймер на разблокировку
    setIsTemporarilyDisabled(true);
    timerRef.current = setTimeout(() => {
      setIsTemporarilyDisabled(false);
    }, delay);
  };

  // Очищаем таймер при размонтировании компонента (защита от утечек памяти)
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <button
      className={`header-action-btn ${variant === 'logout' ? 'logout-btn' : ''}`}
      onClick={handleClick}
      title={title}
      // Кнопка недоступна, если передан внешний prop disabled ИЛИ идет задержка
      disabled={disabled || isTemporarilyDisabled}
    >
      {icon}
    </button>
  );
};

export default HeaderActionButton;