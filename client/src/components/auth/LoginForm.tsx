import {
  Box,
  Button,
  Heading,
  Icon,
  Image,
  Input,
  InputProps,
  Link,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react';
import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { FaGithub, FaLinkedin } from 'react-icons/fa';
import { useAuthStore } from '../../store/authStore';

// --- Types ---
type FormMode = 'login' | 'register' | 'requestReset' | 'resetPassword';

interface FormData {
  email: string;
  password: string;
  newPassword: string;
  confirmPassword: string;
  displayName: string;
  picture: string;
  customPictureUrl: string;
}

const INITIAL_STATE: FormData = {
  email: '',
  password: '',
  newPassword: '',
  confirmPassword: '',
  displayName: '',
  picture: '',
  customPictureUrl: '',
};

// --- Config ---
const MODE_CONFIG: Record<
  FormMode,
  { title: string; submitLabel: string; loadingLabel: string }
> = {
  login: {
    title: 'Firecracker Login',
    submitLabel: 'Login',
    loadingLabel: 'Logging in...',
  },
  register: {
    title: 'Create Account',
    submitLabel: 'Create Account',
    loadingLabel: 'Creating account...',
  },
  requestReset: {
    title: 'Reset Password',
    submitLabel: 'Send Reset Email',
    loadingLabel: 'Sending email...',
  },
  resetPassword: {
    title: 'Set New Password',
    submitLabel: 'Reset Password',
    loadingLabel: 'Resetting password...',
  },
};

// --- Sub-Components ---

const InputField = ({ label, ...props }: InputProps & { label: string }) => (
  <Box>
    <Text color="white" mb="2" fontSize="sm">
      {label}
    </Text>
    <Input
      bg="gaming.dark"
      color="white"
      border="1px solid"
      borderColor="brand.300"
      _focus={{
        borderColor: 'gaming.glow',
        boxShadow: '0 0 0 1px var(--chakra-colors-gaming-glow)',
      }}
      {...props}
    />
  </Box>
);

const SocialButtons = ({ isLoading }: { isLoading: boolean }) => (
  <>
    <Text textAlign="center" color="fg.muted" fontSize="sm" my={2}>
      or
    </Text>
    <Stack gap={3}>
      <Button
        onClick={() => {
          window.location.href = `/api/auth/github`;
        }}
        disabled={isLoading}
        variant="outline"
        width="full"
        bg="gray.800"
        color="white"
        borderColor="brand.300"
        _hover={{ bg: 'gray.700' }}
      >
        <Icon as={FaGithub} />
        Continue with GitHub
      </Button>
      <Button
        onClick={() => {
          window.location.href = `/api/auth/linkedin`;
        }}
        disabled={isLoading}
        variant="outline"
        width="full"
        bg="#0077b5"
        color="white"
        borderColor="brand.300"
        _hover={{ bg: '#005885' }}
      >
        <Icon as={FaLinkedin} />
        Continue with LinkedIn
      </Button>
    </Stack>
    <Text color="fg.muted" fontSize="xs" textAlign="center" mt={2}>
      Use your existing account credentials
    </Text>
  </>
);

const AvatarPicker = ({
  currentPicture,
  customUrl,
  onSelect,
  onCustomUrlChange,
}: {
  currentPicture: string;
  customUrl: string;
  onSelect: (url: string) => void;
  onCustomUrlChange: (val: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [avatars, setAvatars] = useState<string[]>([]);

  const togglePicker = async () => {
    const newState = !isOpen;
    setIsOpen(newState);
    if (newState && avatars.length === 0) {
      try {
        const res = await fetch('/api/auth/avatars/trending');
        const data = await res.json();
        setAvatars(data.avatars || []);
      } catch (e) {
        console.error('Avatar fetch failed', e);
      }
    }
  };

  return (
    <Box>
      <Text color="white" mb="2" fontSize="sm">
        Avatar (optional)
      </Text>
      {currentPicture && (
        <Box mb="3" textAlign="center">
          <Image
            src={currentPicture}
            boxSize="64px"
            borderRadius="md"
            border="2px solid"
            borderColor="gaming.glow"
            mx="auto"
          />
        </Box>
      )}
      <Button
        onClick={togglePicker}
        variant="outline"
        width="full"
        mb="3"
        color="white"
        borderColor="brand.300"
        _hover={{ bg: 'brand.200' }}
      >
        {isOpen ? 'Hide Avatar Picker' : 'Choose Avatar'}
      </Button>

      {isOpen && (
        <Box bg="gaming.dark" p="4" borderRadius="md" mb="3">
          <SimpleGrid columns={5} gap={2} mb="4">
            {avatars.map(url => (
              <Box
                as="button"
                key={url}
                onClick={() => onSelect(url)}
                border="2px solid"
                borderColor={
                  currentPicture === url ? 'gaming.glow' : 'transparent'
                }
                borderRadius="md"
                overflow="hidden"
                _hover={{ borderColor: 'gaming.glow' }}
              >
                <Image src={url} width="100%" />
              </Box>
            ))}
          </SimpleGrid>
          <InputField
            label="Or paste custom image URL:"
            placeholder="https://example.com/avatar.png"
            value={customUrl}
            onChange={e => onCustomUrlChange(e.target.value)}
            fontSize="xs"
            bg="brand.100"
          />
        </Box>
      )}
    </Box>
  );
};

// --- Main Component ---

export function LoginForm() {
  const [mode, setMode] = useState<FormMode>('login');
  const [formData, setFormData] = useState<FormData>(INITIAL_STATE);
  const [resetToken, setResetToken] = useState('');
  const [status, setStatus] = useState<{
    isLoading: boolean;
    error: string;
    success: string;
  }>({
    isLoading: false,
    error: '',
    success: '',
  });

  const setAuth = useAuthStore(state => state.setAuth);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) {
      setResetToken(token);
      setMode('resetPassword');
    }
  }, []);

  const handleChange =
    (field: keyof FormData) => (e: ChangeEvent<HTMLInputElement>) => {
      setFormData(prev => ({ ...prev, [field]: e.target.value }));
    };

  const switchMode = (newMode: FormMode) => {
    setMode(newMode);
    setStatus({ isLoading: false, error: '', success: '' });
    setFormData(INITIAL_STATE); // Clear form on switch
    if (newMode === 'login') {
      // clean up URL if returning from reset flow
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const handleApiCall = async (endpoint: string, body: object) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Request failed');
    return data;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus({ isLoading: true, error: '', success: '' });

    try {
      if (mode === 'login') {
        const data = await handleApiCall('/api/auth/login', {
          email: formData.email,
          password: formData.password,
        });
        setAuth(data.accessToken, data.user);
      } else if (mode === 'register') {
        const data = await handleApiCall('/api/auth/register', {
          email: formData.email,
          password: formData.password,
          displayName: formData.displayName || formData.email.split('@')[0],
          picture:
            formData.customPictureUrl.trim() || formData.picture || undefined,
        });
        setAuth(data.accessToken, data.user);
      } else if (mode === 'requestReset') {
        await handleApiCall('/api/auth/forgotten-password', {
          email: formData.email,
        });
        setStatus(prev => ({
          ...prev,
          isLoading: false,
          success: 'Password reset email sent! Check your inbox.',
        }));
        setFormData(prev => ({ ...prev, email: '' }));
      } else if (mode === 'resetPassword') {
        if (formData.newPassword !== formData.confirmPassword)
          throw new Error('Passwords do not match');
        if (formData.newPassword.length < 8)
          throw new Error('Password must be at least 8 characters');

        await handleApiCall('/api/auth/password-reset', {
          resetToken,
          newPassword: formData.newPassword,
        });
        setStatus(prev => ({
          ...prev,
          isLoading: false,
          success: 'Success! Redirecting to login...',
        }));

        setTimeout(() => switchMode('login'), 2000);
      }
    } catch (err) {
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'An error occurred',
      }));
    }
  };

  const config = MODE_CONFIG[mode];

  return (
    <Box
      width="100vw"
      height="100vh"
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg="gaming.dark"
      overflow="auto"
      py="10"
    >
      <Box
        as="form"
        onSubmit={handleSubmit}
        bg="brand.100"
        p="10"
        borderRadius="lg"
        width="400px"
        maxW="90vw"
        boxShadow="lg"
      >
        <Heading size="lg" textAlign="center" mb="8" color="white">
          {config.title}
        </Heading>

        {status.error && (
          <Box
            bg="gaming.accent"
            color="white"
            p="3"
            borderRadius="md"
            mb="5"
            fontSize="sm"
          >
            {status.error}
          </Box>
        )}
        {status.success && (
          <Box
            bg="gaming.glow"
            color="black"
            p="3"
            borderRadius="md"
            mb="5"
            fontSize="sm"
            fontWeight="bold"
          >
            {status.success}
          </Box>
        )}

        <Stack gap="5">
          {mode === 'register' && (
            <>
              <InputField
                label="Display Name (optional)"
                value={formData.displayName}
                onChange={handleChange('displayName')}
                placeholder="How you'll appear"
              />
              <AvatarPicker
                currentPicture={formData.customPictureUrl || formData.picture}
                customUrl={formData.customPictureUrl}
                onSelect={url =>
                  setFormData(p => ({
                    ...p,
                    picture: url,
                    customPictureUrl: '',
                  }))
                }
                onCustomUrlChange={url =>
                  setFormData(p => ({ ...p, customPictureUrl: url }))
                }
              />
            </>
          )}

          {mode !== 'resetPassword' && (
            <InputField
              label="Email"
              type="email"
              value={formData.email}
              onChange={handleChange('email')}
              required
            />
          )}

          {(mode === 'login' || mode === 'register') && (
            <InputField
              label="Password"
              type="password"
              value={formData.password}
              onChange={handleChange('password')}
              required
              minLength={8}
            />
          )}

          {mode === 'resetPassword' && (
            <>
              <InputField
                label="New Password"
                type="password"
                value={formData.newPassword}
                onChange={handleChange('newPassword')}
                required
                minLength={8}
              />
              <InputField
                label="Confirm Password"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange('confirmPassword')}
                required
                minLength={8}
              />
            </>
          )}

          <Button
            type="submit"
            loading={status.isLoading}
            variant="solid"
            size="lg"
            width="full"
            bg={mode === 'login' ? 'blue.500' : 'gaming.glow'}
            color={mode === 'login' ? 'white' : 'black'}
            _hover={{ bg: mode === 'login' ? 'blue.600' : 'gaming.accent' }}
          >
            {status.isLoading ? config.loadingLabel : config.submitLabel}
          </Button>

          {/* Navigation Links */}
          <Box textAlign="center" fontSize="sm">
            {mode === 'login' && (
              <>
                <Link
                  color="blue.400"
                  onClick={() => switchMode('requestReset')}
                >
                  Forgot Password?
                </Link>
                <SocialButtons isLoading={status.isLoading} />
                <Box mt={4}>
                  <Link color="blue.400" onClick={() => switchMode('register')}>
                    Don't have an account? Register
                  </Link>
                </Box>
              </>
            )}

            {(mode === 'register' ||
              mode === 'requestReset' ||
              mode === 'resetPassword') && (
              <Link color="blue.400" onClick={() => switchMode('login')}>
                Back to Login
              </Link>
            )}
          </Box>
        </Stack>
      </Box>
    </Box>
  );
}
