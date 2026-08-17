import {
  Button as ChakraButton,
  type ButtonProps as ChakraButtonProps,
  type RecipeVariantProps,
} from '@chakra-ui/react';
import { buttonRecipe } from '../../theme/recipes';

type ButtonVariantProps = RecipeVariantProps<typeof buttonRecipe>;

export type ButtonProps = Omit<ChakraButtonProps, keyof ButtonVariantProps> &
  ButtonVariantProps;

export const Button = (props: ButtonProps) => (
  <ChakraButton {...(props as ChakraButtonProps)} />
);
