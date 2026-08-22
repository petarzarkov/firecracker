import { Badge, Box, Flex, Image, Menu, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { AvatarDialog } from '@/components/ui/AvatarDialog';
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

export function UserMenu() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [pickingAvatar, setPickingAvatar] = useState(false);

  if (!user) return null;

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
      <Menu.Root>
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
        <Menu.Content
          bg="gray.800"
          border="1px solid"
          borderColor="gray.600"
          borderRadius="lg"
          boxShadow="0 8px 32px rgba(0,0,0,0.5)"
          minW="200px"
          zIndex={200}
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
            <Box>
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
              <Text fontSize="xs" color="gray.500" fontFamily="mono" mt={0.5}>
                {user.email}
              </Text>
              <Text fontSize="xs" color="green.500" fontFamily="mono" mt={0.5}>
                {user.roles.join(', ')}
              </Text>
            </Box>
          </Flex>
          <Menu.Separator borderColor="gray.700" />
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
      </Menu.Root>
      <AvatarDialog
        open={pickingAvatar}
        onClose={() => setPickingAvatar(false)}
      />
    </>
  );
}
