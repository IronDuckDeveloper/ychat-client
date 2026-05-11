import { configureStore } from '@reduxjs/toolkit';

// Dummy reducer to fix the error
const dummyReducer = (state = {}, _action: any) => state;

export const store = configureStore({
  reducer: {
    dummy: dummyReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
