import { Box, Dialog, Portal, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { chooseAvatar, uploadAvatar } from '@/systems/network/avatar';
import { AvatarPicker } from './AvatarPicker';
import { Button } from './Button';

/**
 * The signed-in half of {@link AvatarPicker}.
 *
 * The picker on the register screen collects a choice and hands it to sign-up. It
 * is the same three sources here - an emote, a URL, a file - but there is an
 * account now, so each one is saved as it is chosen and the file is a real upload.
 *
 * The store is written from the server's answer rather than from what was picked:
 * an uploaded avatar's URL is minted by the server, and the session behind the
 * socket is what everything else reads it from.
 */
export const AvatarDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [customUrl, setCustomUrl] = useState('');
  const [error, setError] = useState('');

  const applied = (picture: string) => {
    updateUser({ picture });
    setCustomUrl('');
    setError('');
    onClose();
  };

  const chooseUrl = async (url: string) => {
    try {
      applied((await chooseAvatar({ url })).picture);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save');
    }
  };

  // Thrown on rather than caught: `AvatarPicker` owns the busy state of its own
  // upload button, and shows what came back beside it.
  const upload = async (file: File) => {
    applied((await uploadAvatar(file)).picture);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(event) => {
        if (!event.open) onClose();
      }}
      placement="center"
    >
      <Portal>
        <Dialog.Backdrop style={{ background: 'rgba(0,0,0,0.6)' }} />
        <Dialog.Positioner>
          <Dialog.Content
            borderRadius="xl"
            maxW="420px"
            p="6"
            style={{
              background: 'rgba(13, 8, 0, 0.95)',
              border: '1px solid rgba(255, 107, 0, 0.25)',
            }}
          >
            <Dialog.Title
              color="orange.300"
              fontFamily="monospace"
              letterSpacing="wider"
              mb="4"
            >
              YOUR AVATAR
            </Dialog.Title>

            <AvatarPicker
              defaultOpen
              currentPicture={customUrl || (user?.picture ?? '')}
              customUrl={customUrl}
              onSelect={(url) => void chooseUrl(url)}
              onCustomUrlChange={setCustomUrl}
              onUpload={upload}
            />

            {customUrl.trim().length > 0 && (
              <Button
                onClick={() => void chooseUrl(customUrl.trim())}
                variant="fire"
                width="full"
                mt="3"
              >
                Use This URL
              </Button>
            )}

            {error && (
              <Text color="red.300" fontSize="xs" mt="3" fontFamily="monospace">
                {error}
              </Text>
            )}

            <Box mt="4">
              <Button onClick={onClose} variant="glass" width="full">
                Close
              </Button>
            </Box>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
};
