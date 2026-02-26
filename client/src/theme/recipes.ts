import { defineRecipe, defineSlotRecipe } from '@chakra-ui/react';

export const buttonRecipe = defineRecipe({
  base: {
    fontFamily: 'monospace',
    fontWeight: 'bold',
    borderRadius: '4px',
    transition: 'all 0.2s',
  },
  variants: {
    variant: {
      solid: {
        bg: 'gaming.glow',
        color: 'black',
        _hover: {
          bg: 'gaming.accent',
        },
      },
      ghost: {
        bg: 'transparent',
        color: 'white',
        _hover: {
          bg: 'brand.100',
        },
      },
      fire: {
        background:
          'linear-gradient(90deg, #ff6b00, #e74c3c, #ff9500, #e74c3c)',
        backgroundSize: '200% auto',
        animation: 'buttonShimmer 3s linear infinite',
        color: 'white',
        fontWeight: 'black',
        letterSpacing: 'wider',
        borderRadius: '8px',
        boxShadow: '0 4px 15px rgba(255,107,0,0.35)',
        _hover: {
          filter: 'brightness(1.2)',
          transform: 'translateY(-1px)',
          boxShadow: '0 6px 20px rgba(255,107,0,0.5)',
        },
        _active: {
          filter: 'brightness(0.9)',
          transform: 'translateY(0px)',
        },
      },
      glass: {
        background: 'rgba(255,255,255,0.07)',
        border: '1px solid rgba(255,255,255,0.15)',
        color: 'white',
        borderRadius: '8px',
        _hover: {
          filter: 'brightness(1.6)',
        },
        _active: {
          filter: 'brightness(0.9)',
        },
      },
    },
  },
  defaultVariants: {
    variant: 'solid',
  },
});

export const dialogRecipe = defineSlotRecipe({
  slots: ['backdrop', 'content', 'header', 'body', 'footer'],
  base: {
    backdrop: {
      bg: 'blackAlpha.600',
    },
    content: {
      bg: 'gaming.dark',
      border: '1px solid',
      borderColor: 'brand.300',
      borderRadius: '8px',
      fontFamily: 'monospace',
    },
    header: {
      color: 'white',
      fontWeight: 'bold',
      borderBottom: '1px solid',
      borderColor: 'brand.200',
    },
    body: {
      color: 'white',
    },
  },
});
