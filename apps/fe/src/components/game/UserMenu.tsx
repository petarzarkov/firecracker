import { Badge, Box, Flex, Image, Menu, Portal, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { AvatarDialog } from '@/components/ui/AvatarDialog';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';
import { signOut } from '@/systems/auth/auth-api';

function getInitials(displayName?: string | null, email?: string): string {
  if (displayName) {
    const [first, second] = displayName.trim().split(/\s+/);
    if (first !== undefined && second !== undefined) {
      return `${first[0] ?? ''}${second[0] ?? ''}`.toUpperCase();
    }
    return displayName.slice(0, 2).toUpperCase();
  }
  return (email ?? '??').slice(0, 2).toUpperCase();
}

export function UserMenu({
  onSignIn,
  onConvert,
}: {
  onSignIn?: () => void;
  /** Turn a demo account into a real one. See the menu item below. */
  onConvert?: () => void;
}) {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [pickingAvatar, setPickingAvatar] = useState(false);

  /**
   * A spectator's header. The lobby is public now, so this is the one place that
   * says how to stop watching and start playing.
   */
  if (!user) {
    return (
      <Button size="sm" variant="fire" onClick={onSignIn} fontSize="xs">
        Sign in
      </Button>
    );
  }

  const initials = getInitials(user.displayName, user.email);
  const displayLabel = user.displayName ?? user.email.split('@')[0];

  /**
   * **Ends the session on the server first.** Clearing the store alone only forgot
   * the *client's* copy: better-auth's session lives in an `HttpOnly` cookie, so the
   * reload below re-ran `AuthMiddleware`, which asked `/get-session`, got the still
   * live session back and signed the user straight back in. Logging out did nothing
   * but flicker.
   *
   * Awaited, because the reload is what races it. The call swallows its own errors,
   * so a dead network still clears the client and lands on the login form.
   */
  async function handleLogout() {
    await signOut(token);
    clearAuth();
    window.location.href = '/';
  }

  return (
    <>
      {/*
       * **Portalled, and positioned by a `Menu.Positioner`.** Neither is optional
       * here, and the two failures they fix look like one bug.
       *
       * Without the positioner the content is not floated at all - it lays out in
       * flow, inside the header, so it hangs off whichever edge the trigger happens
       * to sit near. Without the portal it also inherits the header's stacking and
       * clipping: `Game`'s root is `overflow="hidden"`, which is what cropped the
       * panel at the viewport edge on a phone.
       *
       * `overflowPadding` is what keeps it on screen once it *is* floated - the
       * trigger is at the right edge of the header, and a 240px panel anchored
       * `bottom-end` on a 390px screen has nowhere to go but inward.
       */}
      <Menu.Root
        positioning={{ placement: 'bottom-end', gutter: 8, overflowPadding: 8 }}
      >
        <Menu.Trigger asChild>
          <Flex
            align="center"
            gap={2}
            cursor="pointer"
            px={2}
            py={1}
            borderRadius="md"
            _hover={{ bg: 'gray.800' }}
            transition="background 0.15s"
          >
            {user.picture ? (
              <Image
                src={user.picture}
                alt={displayLabel}
                boxSize={7}
                borderRadius="full"
                flexShrink={0}
                objectFit="cover"
              />
            ) : (
              <Flex
                w={7}
                h={7}
                bg="green.700"
                borderRadius="full"
                align="center"
                justify="center"
                flexShrink={0}
              >
                <Text
                  fontSize="xs"
                  fontWeight="bold"
                  color="white"
                  lineHeight={1}
                >
                  {initials}
                </Text>
              </Flex>
            )}
            <Text
              fontSize="sm"
              color="gray.300"
              fontFamily="mono"
              maxW="120px"
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              display={{ base: 'none', sm: 'block' }}
            >
              {displayLabel}
            </Text>
            <Text fontSize="xs" color="gray.600">
              ▾
            </Text>
          </Flex>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner zIndex={1400}>
            <Menu.Content
              bg="gray.800"
              border="1px solid"
              borderColor="gray.600"
              borderRadius="lg"
              boxShadow="0 8px 32px rgba(0,0,0,0.5)"
              minW="200px"
              maxW="calc(100vw - 16px)"
            >
              <Flex px={3} py={2} gap={3} align="center">
                {user.picture ? (
                  <Image
                    src={user.picture}
                    alt={displayLabel}
                    boxSize={10}
                    borderRadius="full"
                    objectFit="cover"
                    flexShrink={0}
                  />
                ) : (
                  <Flex
                    w={10}
                    h={10}
                    bg="green.700"
                    borderRadius="full"
                    align="center"
                    justify="center"
                    flexShrink={0}
                  >
                    <Text
                      fontSize="sm"
                      fontWeight="bold"
                      color="white"
                      lineHeight={1}
                    >
                      {initials}
                    </Text>
                  </Flex>
                )}
                <Box minW={0}>
                  <Flex align="center" gap={2} mb={0.5}>
                    <Text fontSize="xs" color="gray.500" fontFamily="mono">
                      ACCOUNT
                    </Text>
                    {user.isDemo && (
                      <Badge
                        colorPalette="yellow"
                        variant="subtle"
                        fontSize="xs"
                        fontFamily="mono"
                      >
                        DEMO
                      </Badge>
                    )}
                  </Flex>
                  <Text
                    fontSize="sm"
                    color="gray.200"
                    fontFamily="mono"
                    fontWeight="bold"
                  >
                    {user.displayName ?? user.email.split('@')[0]}
                  </Text>
                  {/*
                   * `break-all`, because a demo email is one unbroken token -
                   * `temp-<uuid>@demo.firecracker.local` - and nothing else in it is a
                   * break opportunity. Left to overflow it is what widened the panel
                   * past the screen in the first place.
                   */}
                  {/*
                    A demo player is shown what their account *is*, not its
                    machine-generated address - `temp-<uuid>@demo.firecracker.local`
                    tells them nothing and takes three lines to do it. Their role
                    was on show too, which means even less to them than the address.
                  */}
                  <Text
                    fontSize="xs"
                    color="gray.500"
                    fontFamily="mono"
                    mt={0.5}
                    wordBreak="break-all"
                  >
                    {user.isDemo ? 'Demo account · play money' : user.email}
                  </Text>
                </Box>
              </Flex>
              <Menu.Separator borderColor="gray.700" />
              {/*
                The way out of a demo account.
                
                `anonymous()` links a sign-up to the session already open, and
                `AccountLinker` moves the wallet, the bets and the avatar across
                before the demo row is deleted - so this keeps the run rather than
                starting a new one. There was no path to it at all before: a player
                who had had a good evening could only lose it.
              */}
              {user.isDemo === true && onConvert !== undefined && (
                <Menu.Item
                  value="convert"
                  color="orange.300"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="bold"
                  _hover={{ bg: 'gray.700', color: 'orange.200' }}
                  onClick={onConvert}
                  cursor="pointer"
                >
                  Keep this account
                </Menu.Item>
              )}
              <Menu.Item
                value="avatar"
                color="gray.200"
                fontFamily="mono"
                fontSize="sm"
                _hover={{ bg: 'gray.700', color: 'orange.300' }}
                onClick={() => setPickingAvatar(true)}
                cursor="pointer"
              >
                Change Avatar
              </Menu.Item>
              <Menu.Item
                value="logout"
                color="red.400"
                fontFamily="mono"
                fontSize="sm"
                _hover={{ bg: 'red.900', color: 'red.300' }}
                onClick={handleLogout}
                cursor="pointer"
              >
                Logout
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>
      <AvatarDialog
        open={pickingAvatar}
        onClose={() => setPickingAvatar(false)}
      />
    </>
  );
}
