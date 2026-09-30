import { configureStore } from '@reduxjs/toolkit';
import contacts from './contactsSlice.ts';
import profile from './profileSlice.ts';

export const store = configureStore({
  reducer: {
    contacts,
    profile,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
