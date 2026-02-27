import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';
import { buttonRecipe, dialogRecipe } from './recipes';

const customConfig = defineConfig({
  globalCss: {
    body: {
      bg: 'gaming.darker',
      color: 'white',
    },
  },
  theme: {
    recipes: {
      button: buttonRecipe,
    },
    slotRecipes: {
      dialog: dialogRecipe,
    },
    keyframes: {
      fireBackground: {
        '0%': { backgroundPosition: '0% 50%' },
        '50%': { backgroundPosition: '100% 50%' },
        '100%': { backgroundPosition: '0% 50%' },
      },
      cardGlowPulse: {
        '0%': {
          boxShadow:
            '0 0 20px rgba(255,107,0,0.12), 0 20px 60px rgba(0,0,0,0.5)',
        },
        '50%': {
          boxShadow:
            '0 0 40px rgba(255,107,0,0.25), 0 20px 60px rgba(0,0,0,0.5)',
        },
        '100%': {
          boxShadow:
            '0 0 20px rgba(255,107,0,0.12), 0 20px 60px rgba(0,0,0,0.5)',
        },
      },
      buttonShimmer: {
        '0%': { backgroundPosition: '-200% center' },
        '100%': { backgroundPosition: '200% center' },
      },
    },
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
          glow: { value: '#ff6b00' },
          accent: { value: '#e74c3c' },
        },
        fire: {
          orange: { value: '#ff6b00' },
          amber: { value: '#ff9500' },
          deep: { value: '#2a1000' },
        },
        // Warm fire-tinted gray palette — flows into all game components
        // that reference gray.* tokens without touching them individually
        gray: {
          50: { value: '#f5ede0' },
          100: { value: '#e8d5be' },
          200: { value: '#c8ad8a' },
          300: { value: '#a08060' },
          400: { value: '#7a6252' },
          500: { value: '#5c4a3f' },
          600: { value: '#3d3028' },
          700: { value: '#2a2018' },
          800: { value: '#1c1510' },
          900: { value: '#110e08' },
          950: { value: '#0a0700' },
        },
        // Override Chakra's green palette with fire/orange tones so all
        // green.* tokens automatically render in the fire theme.
        green: {
          50: { value: '#fff3e0' },
          100: { value: '#ffe0b2' },
          200: { value: '#ffcc80' },
          300: { value: '#ffb347' },
          400: { value: '#ff9500' },
          500: { value: '#ff6b00' },
          600: { value: '#e05500' },
          700: { value: '#b84300' },
          800: { value: '#8b3200' },
          900: { value: '#5a1e00' },
          950: { value: '#3a1000' },
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
