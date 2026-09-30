import { createSlice, original, type PayloadAction } from '@reduxjs/toolkit';
import type { ContactItem } from '../lib/p2p/services/contactsService.ts';

const contactsSlice = createSlice({
  name: 'contacts',
  initialState: { items: [] as ContactItem[] },
  reducers: {
    // Замена списка. Если содержимое не изменилось, ссылка на items остаётся прежней (нет лишних ререндеров).
    // JSON-копия нужна, потому что immer замораживает state, а cachedContacts в contactsService мутируется.
    contactsReplaced(state, action: PayloadAction<ContactItem[]>) {
      const json = JSON.stringify(action.payload);
      if (json === JSON.stringify(original(state)?.items)) return;
      state.items = JSON.parse(json);
    },
  },
});

export const { contactsReplaced } = contactsSlice.actions;
export default contactsSlice.reducer;