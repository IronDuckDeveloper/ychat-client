import { configureStore } from '@reduxjs/toolkit';
import contacts from './contactsSlice.ts';
import profile, { initialProfileState, type ProfileState } from './profileSlice.ts';

const SNAPSHOT_KEY = 'ychat_profile_snapshot';

function readProfileSnapshot(): Partial<ProfileState> {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const store = configureStore({
  reducer: { contacts, profile },
  // loaded всегда false на старте: спиннер/кнопки ждут реального чтения БД
  preloadedState: { profile: { ...initialProfileState, ...readProfileSnapshot(), loaded: false } },
});

let lastSnapshot = '';
store.subscribe(() => {
  const { nickname, bio, privacy, avatarCid, loaded } = store.getState().profile;
  if (!loaded) return; // не пишем плейсхолдеры и текст ошибки загрузки
  const snapshot = JSON.stringify({ nickname, bio, privacy, avatarCid });
  if (snapshot === lastSnapshot) return;
  lastSnapshot = snapshot;
  try {
    localStorage.setItem(SNAPSHOT_KEY, snapshot);
  } catch { /* квота */ }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;