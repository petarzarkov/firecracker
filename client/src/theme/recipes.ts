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
