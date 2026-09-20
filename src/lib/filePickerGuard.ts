const PICKER_GRACE_MS = 3 * 60_000; // подобрать при тесте
let lastPickerTs = 0;

document.addEventListener('click', (e) => {
  const el = e.target;
  if (el instanceof HTMLInputElement && el.type === 'file') lastPickerTs = Date.now();
}, true); // capture: ловит и программный inputRef.click()

export const wasPickerRecentlyUsed = () => Date.now() - lastPickerTs < PICKER_GRACE_MS;