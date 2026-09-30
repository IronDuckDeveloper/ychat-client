import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PrivacyType } from '../lib/p2p/services/contactsService.ts';

export interface ProfileState {
  nickname: string;
  bio: string;
  privacy: PrivacyType;
  avatarCid: string;
  loaded: boolean;
}

export const initialProfileState: ProfileState = {
  nickname: '',
  bio: '',
  privacy: 'public',
  avatarCid: '',
  loaded: false,
};

const profileSlice = createSlice({
  name: 'profile',
  initialState: initialProfileState,
  reducers: {
    profileUpdated(state, action: PayloadAction<Partial<ProfileState>>) {
      Object.assign(state, action.payload);
    },
  },
});

export const { profileUpdated } = profileSlice.actions;
export default profileSlice.reducer;