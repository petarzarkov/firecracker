import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';

const customConfig = defineConfig({
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: '#1a1a1a' },
          100: { value: '#2d2d2d' },
          200: { value: '#404040' },
          300: { value: '#595959' },
          400: { value: '#737373' },
          500: { value: '#8c8c8c' },
          600: { value: '#a6a6a6' },
          700: { value: '#bfbfbf' },
          800: { value: '#d9d9d9' },
          900: { value: '#f2f2f2' },
        },
        gaming: {
          dark: { value: '#1a1a1a' },
          darker: { value: '#0d0d0d' },
          glow: { value: '#4CAF50' },
          accent: { value: '#e74c3c' },
        },
      },
      fonts: {
        body: { value: 'monospace' },
        heading: { value: 'monospace' },
      },
    },
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: { value: '{colors.gaming.dark}' },
          subtle: { value: '{colors.gaming.darker}' },
        },
        fg: {
          DEFAULT: { value: 'white' },
          muted: { value: '#aaa' },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, customConfig);
