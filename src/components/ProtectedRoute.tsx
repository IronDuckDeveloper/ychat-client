import React from 'react';
import { Navigate } from 'react-router-dom';
import { isAuthenticated } from '../lib/p2p/crypto/crypto.js'; // Проверь правильность пути до твоего crypto.ts

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  if (!isAuthenticated()) {
    // Если ключей в localStorage нет, принудительно перенаправляем на корень (Auth)
    return <Navigate to="/" replace />;
  }

  // Если всё ок, рендерим защищенную страницу (Chat или Contacts)
  return <>{children}</>;
}