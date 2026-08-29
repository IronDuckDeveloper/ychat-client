import { useEffect, useState } from 'react';

interface Toast {
  id: string;
  message: string;
  kind: 'error' | 'info';
}

export function useUploadEvents() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onUploadError = (evt: Event) => {
      const { message, fileName } = (evt as CustomEvent).detail;
      const id = crypto.randomUUID();
      setToasts(prev => [...prev, { id, message: `${fileName}: ${message}`, kind: 'error' }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    };

    const onUploadRetrying = (evt: Event) => {
      const { fileName, attempt, maxRetries } = (evt as CustomEvent).detail;
      const id = crypto.randomUUID();
      setToasts(prev => [...prev, { id, message: `${fileName}: повтор ${attempt}/${maxRetries}...`, kind: 'info' }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
    };

    const onAuthError = (evt: Event) => {
      const { message } = (evt as CustomEvent).detail;
      const id = crypto.randomUUID();
      setToasts(prev => [...prev, { id, message, kind: 'error' }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000);
    };

    window.addEventListener('uploadError', onUploadError);
    window.addEventListener('uploadRetrying', onUploadRetrying);
    window.addEventListener('authError', onAuthError);
    return () => {
      window.removeEventListener('uploadError', onUploadError);
      window.removeEventListener('uploadRetrying', onUploadRetrying);
      window.removeEventListener('authError', onAuthError);
    };
  }, []);

  return toasts;
}