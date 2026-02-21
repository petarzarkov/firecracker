import { create } from 'zustand';

interface KeyboardState {
  disabled: boolean;
  setDisabled: (disabled: boolean) => void;
}

export const useKeyboardStore = create<KeyboardState>(set => ({
  disabled: false,
  setDisabled: (disabled: boolean) => set({ disabled }),
}));
