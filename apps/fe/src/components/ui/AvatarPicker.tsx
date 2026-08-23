import { Box, Image, SimpleGrid, Text } from '@chakra-ui/react';
import type { TrendingAvatars } from '@firecracker/contracts';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/systems/network/api';
import { Button } from './Button';
import { InputField } from './InputField';

/** The offline fallback, used when the trending call cannot be made at all. */
const AVATARS: readonly string[] = [
  '/png/android-chrome-192x192.png',
  '/png/apple-touch-icon.png',
  '/png/favicon-32x32.png',
];

export const AvatarPicker = ({
  currentPicture,
  customUrl,
  onSelect,
  onCustomUrlChange,
  onUpload,
  defaultOpen = false,
}: {
  currentPicture: string;
  customUrl: string;
  onSelect: (url: string) => void;
  onCustomUrlChange: (val: string) => void;
  /**
   * Given a file, make it the avatar. **Absent on the sign-up form**, and that is
   * not an oversight: an upload belongs to an account, and there is no account yet
   * when this picker is on the register screen - the route would answer 401.
   */
  onUpload?: (file: File) => Promise<void>;
  /** The panel starts open where the picker *is* the screen, as in the dialog. */
  defaultOpen?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [avatars, setAvatars] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Fetched whenever the panel is open and has nothing, from
   * `GET /api/profile/avatars/trending`.
   *
   * **An effect, not the toggle's business.** It used to live inside the click
   * handler, which meant it only ran on a transition into open - and `defaultOpen`
   * skips that transition. So the one place that passes it, `AvatarDialog`, opened
   * the picker already open, over an empty `avatars`, and rendered a grid with no
   * avatars in it. "Change Avatar" showed a panel with nothing to choose, and the
   * only route to a filled grid was to close the picker and open it again.
   *
   * It was `/api/auth/avatars/trending` before the migration; better-auth owns
   * `/auth` now, so the route moved. The endpoint degrades to a single fallback
   * rather than failing, so this never leaves the form unusable - and the bundled
   * set below covers the case where even that call does not return.
   */
  useEffect(() => {
    if (!isOpen || avatars.length > 0) return;

    let dismissed = false;
    const settle = (next: readonly string[]) => {
      if (!dismissed) setAvatars([...next]);
    };

    apiFetch('/api/profile/avatars/trending')
      .then((res) => res.json() as Promise<TrendingAvatars>)
      .then(({ avatars: trending }) =>
        settle(trending.length > 0 ? trending : AVATARS),
      )
      .catch(() => settle(AVATARS));

    return () => {
      dismissed = true;
    };
  }, [isOpen, avatars.length]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so that picking the same file again is still a change event, which
    // is what a failed upload leaves a user wanting to do.
    event.target.value = '';
    if (file === undefined || onUpload === undefined) return;

    setUploading(true);
    setUploadError('');
    try {
      await onUpload(file);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box>
      <Text
        color="rgba(255,255,255,0.7)"
        mb="2"
        fontSize="sm"
        fontFamily="monospace"
        letterSpacing="wide"
      >
        Avatar (optional)
      </Text>
      {currentPicture && (
        <Box mb="3" textAlign="center">
          <Image
            src={currentPicture}
            boxSize="64px"
            borderRadius="md"
            border="2px solid"
            borderColor="orange.400"
            mx="auto"
          />
        </Box>
      )}
      <Button
        onClick={() => setIsOpen((open) => !open)}
        variant="glass"
        width="full"
        mb="3"
        color="orange.300"
      >
        {isOpen ? 'Hide Avatar Picker' : 'Choose Avatar'}
      </Button>

      {isOpen && (
        <Box
          p="4"
          borderRadius="md"
          mb="3"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,107,0,0.15)',
          }}
        >
          {onUpload !== undefined && (
            <Box mb="4">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={handleFile}
              />
              <Button
                onClick={() => fileInput.current?.click()}
                loading={uploading}
                variant="glass"
                width="full"
                color="orange.300"
              >
                Upload Your Own
              </Button>
              {uploadError && (
                <Text
                  color="red.300"
                  fontSize="xs"
                  mt="2"
                  fontFamily="monospace"
                >
                  {uploadError}
                </Text>
              )}
            </Box>
          )}
          <SimpleGrid columns={5} gap={2} mb="4">
            {avatars.map((url) => (
              <Box
                as="button"
                key={url}
                onClick={() => onSelect(url)}
                border="2px solid"
                borderColor={
                  currentPicture === url ? 'orange.400' : 'transparent'
                }
                borderRadius="md"
                overflow="hidden"
                _hover={{ borderColor: 'orange.400' }}
              >
                <Image src={url} width="100%" />
              </Box>
            ))}
          </SimpleGrid>
          <InputField
            label="Or paste custom image URL:"
            placeholder="https://example.com/avatar.png"
            value={customUrl}
            onChange={(e) => onCustomUrlChange(e.target.value)}
            fontSize="xs"
          />
        </Box>
      )}
    </Box>
  );
};
