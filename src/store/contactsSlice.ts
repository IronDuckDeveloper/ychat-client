import { createSlice, original, type PayloadAction } from '@reduxjs/toolkit';
import type { ContactItem } from '../lib/p2p/services/contactsService.ts';

const contactsSlice = createSlice({
  name: 'contacts',
  initialState: { items: [] as ContactItem[] },
  reducers: {
    // Замена списка. Если содержимое не изменилось, ссылка на items остаётся прежней (нет лишних ререндеров).
    // JSON-копия нужна, потому что immer замораживает state, а cachedContacts в contactsService мутируется.
  contactsReplaced(state, action: PayloadAction<ContactItem[]>) {
      const prev = original(state)?.items ?? [];
      const prevById = new Map(prev.map((c) => [c.id, c]));
      let changed = prev.length !== action.payload.length;
      const next = action.payload.map((c, i) => {
        const json = JSON.stringify(c);
        const old = prevById.get(c.id);
        if (old && JSON.stringify(old) === json) {
          if (prev[i] !== old) changed = true; // порядок поменялся
          return old;
        }
        changed = true;
        return JSON.parse(json) as ContactItem;
      });
      if (changed) state.items = next;
    },
  },
});

export const { contactsReplaced } = contactsSlice.actions;
export default contactsSlice.reducer;