import { Box, chakra, Input, type InputProps } from '@chakra-ui/react';
import { useId } from 'react';

/**
 * A labelled field.
 *
 * The label used to be a `Text` beside the input rather than a `<label for>`, so
 * every field on the sign-in and register forms announced as an unnamed box - and
 * tapping the word did not focus the field, which on a phone is most of what a
 * label is for. `useId` rather than a caller-supplied id: two of these on one page
 * must not collide, and no caller should have to think about it.
 */
export const InputField = ({
  label,
  id,
  ...props
}: InputProps & { label: string }) => {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <Box>
      <chakra.label
        htmlFor={fieldId}
        display="block"
        color="rgba(255,255,255,0.7)"
        mb="2"
        fontSize="sm"
        fontFamily="monospace"
        letterSpacing="wide"
      >
        {label}
      </chakra.label>
      <Input
        id={fieldId}
        color="white"
        fontFamily="monospace"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,107,0,0.25)',
        }}
        _focus={{
          borderColor: 'fire.amber',
          boxShadow: '0 0 0 1px #ff9500, 0 0 12px rgba(255,149,0,0.3)',
        }}
        {...props}
      />
    </Box>
  );
};
