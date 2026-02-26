import {
  Box,
  Button,
  Flex,
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
import { FaGamepad, FaGithub, FaLinkedin } from 'react-icons/fa';
import { useAuthStore } from '../../store/authStore';
import { useGameStore } from '../../store/gameStore';

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
    title: 'Welcome Back',
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
    <Text
      color="rgba(255,255,255,0.7)"
      mb="2"
      fontSize="sm"
      fontFamily="monospace"
      letterSpacing="wide"
    >
      {label}
    </Text>
    <Input
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

const GradientDivider = () => (
  <Flex alignItems="center" gap={3} my={2}>
    <Box
      flex={1}
      style={{
        height: '1px',
        background:
          'linear-gradient(90deg, transparent, rgba(255,107,0,0.4), transparent)',
      }}
    />
    <Text color="rgba(255,255,255,0.4)" fontSize="xs" fontFamily="monospace">
      OR
    </Text>
    <Box
      flex={1}
      style={{
        height: '1px',
        background: 'linear-gradient(90deg, rgba(255,107,0,0.4), transparent)',
      }}
    />
  </Flex>
);

const SocialButtons = ({
  isLoading,
  onDemoLogin,
}: {
  isLoading: boolean;
  onDemoLogin: () => void;
}) => (
  <>
    <GradientDivider />
    <Stack gap={3}>
      <Button
        onClick={() => {
          window.location.href = `/api/auth/github`;
        }}
        disabled={isLoading}
        variant="glass"
        width="full"
      >
        <Icon as={FaGithub} />
        Continue with GitHub
      </Button>
      <Button
        onClick={() => {
          window.location.href = `/api/auth/linkedin`;
        }}
        disabled={isLoading}
        variant="glass"
        width="full"
        style={{
          background: 'rgba(0,119,181,0.3)',
          border: '1px solid rgba(0,119,181,0.5)',
        }}
      >
        <Icon as={FaLinkedin} />
        Continue with LinkedIn
      </Button>
    </Stack>
    <Text
      color="rgba(255,255,255,0.35)"
      fontSize="xs"
      textAlign="center"
      mt={2}
      fontFamily="monospace"
    >
      Use your existing account credentials
    </Text>
    <Box
      style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
      pt={3}
      mt={1}
    >
      <Button
        onClick={onDemoLogin}
        disabled={isLoading}
        variant="glass"
        width="full"
        color="yellow.300"
        style={{
          background: 'transparent',
          border: '1px dashed rgba(255,200,0,0.4)',
        }}
      >
        <Icon as={FaGamepad} />
        Try Demo
      </Button>
      <Text
        color="rgba(255,255,255,0.35)"
        fontSize="xs"
        textAlign="center"
        mt={1}
        fontFamily="monospace"
      >
        Temporary account · play money only
      </Text>
    </Box>
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
        onClick={togglePicker}
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
          <SimpleGrid columns={5} gap={2} mb="4">
            {avatars.map(url => (
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
            onChange={e => onCustomUrlChange(e.target.value)}
            fontSize="xs"
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
  const setIsDemoMode = useGameStore(state => state.setIsDemoMode);

  const handleDemoLogin = async () => {
    setStatus({ isLoading: true, error: '', success: '' });
    try {
      const response = await fetch('/api/auth/demo', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Demo login failed');
      setAuth(data.accessToken, data.user);
      setIsDemoMode(true);
    } catch (err) {
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Demo login failed',
      }));
    }
  };

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
    setFormData(INITIAL_STATE);
    if (newMode === 'login') {
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
      width="100%"
      height="100vh"
      position="relative"
      overflow="hidden"
      style={{
        background:
          'linear-gradient(135deg, #0d0d0d 0%, #1a0a00 20%, #2a1000 40%, #1a0500 60%, #0d0d0d 80%, #1a0a00 100%)',
        backgroundSize: '400% 400%',
      }}
      animation="fireBackground 8s ease infinite"
    >
      {/* Ambient fire glow — top-left */}
      <Box
        position="absolute"
        top="0"
        left="0"
        width="400px"
        height="400px"
        borderRadius="full"
        pointerEvents="none"
        zIndex={0}
        style={{
          background:
            'radial-gradient(circle, rgba(255,107,0,0.07) 0%, transparent 70%)',
          transform: 'translate(-30%, -30%)',
        }}
      />
      {/* Ambient fire glow — bottom-right */}
      <Box
        position="absolute"
        bottom="0"
        right="0"
        width="500px"
        height="500px"
        borderRadius="full"
        pointerEvents="none"
        zIndex={0}
        style={{
          background:
            'radial-gradient(circle, rgba(231,76,60,0.05) 0%, transparent 70%)',
          transform: 'translate(30%, 30%)',
        }}
      />

      {/* Scrollable inner layer — contains the card */}
      <Box
        width="100%"
        height="100%"
        display="flex"
        alignItems="center"
        justifyContent="center"
        overflow="auto"
        py="10"
        position="relative"
        zIndex={1}
      >
        {/* Glass card */}
        <Box
          as="form"
          onSubmit={handleSubmit}
          borderRadius="xl"
          width="420px"
          maxW="92vw"
          p="8"
          position="relative"
          zIndex={1}
          animation="cardGlowPulse 3s ease-in-out infinite"
          style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            background: 'rgba(13, 8, 0, 0.85)',
            border: '1px solid rgba(255, 107, 0, 0.2)',
          }}
        >
          {/* Logo + brand header */}
          <Box textAlign="center" mb="6">
            <Box
              display="inline-block"
              mb="3"
              p="2"
              borderRadius="2xl"
              style={{
                background: 'rgba(255,107,0,0.1)',
                border: '1px solid rgba(255,107,0,0.3)',
                boxShadow: '0 0 20px rgba(255,107,0,0.2)',
              }}
            >
              <Image
                src="/png/android-chrome-192x192.png"
                alt="Firecracker"
                boxSize="72px"
                objectFit="contain"
              />
            </Box>
            <Text
              fontSize="2xl"
              fontWeight="black"
              fontFamily="monospace"
              letterSpacing="widest"
              style={{
                background:
                  'linear-gradient(135deg, #ff9500 0%, #ff6b00 50%, #e74c3c 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              FIRECRACKER
            </Text>
            <Text
              fontSize="sm"
              color="rgba(255,255,255,0.45)"
              mt="1"
              fontFamily="monospace"
              letterSpacing="wider"
            >
              {config.title.toUpperCase()}
            </Text>
          </Box>

          {/* Status banners */}
          {status.error && (
            <Box
              color="red.300"
              p="3"
              borderRadius="md"
              mb="5"
              fontSize="sm"
              fontFamily="monospace"
              style={{
                background: 'rgba(231,76,60,0.15)',
                border: '1px solid rgba(231,76,60,0.4)',
              }}
            >
              {status.error}
            </Box>
          )}
          {status.success && (
            <Box
              color="orange.300"
              p="3"
              borderRadius="md"
              mb="5"
              fontSize="sm"
              fontWeight="bold"
              fontFamily="monospace"
              style={{
                background: 'rgba(255,149,0,0.15)',
                border: '1px solid rgba(255,149,0,0.4)',
              }}
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
              variant="fire"
              size="lg"
              width="full"
            >
              {status.isLoading ? config.loadingLabel : config.submitLabel}
            </Button>

            {/* Navigation links */}
            <Box textAlign="center" fontSize="sm">
              {mode === 'login' && (
                <>
                  <Link
                    color="orange.400"
                    onClick={() => switchMode('requestReset')}
                    _hover={{ color: 'orange.300' }}
                  >
                    Forgot Password?
                  </Link>
                  <SocialButtons
                    isLoading={status.isLoading}
                    onDemoLogin={handleDemoLogin}
                  />
                  <Box mt={4}>
                    <Link
                      color="orange.400"
                      onClick={() => switchMode('register')}
                      _hover={{ color: 'orange.300' }}
                    >
                      Don't have an account? Register
                    </Link>
                  </Box>
                </>
              )}

              {(mode === 'register' ||
                mode === 'requestReset' ||
                mode === 'resetPassword') && (
                <Link
                  color="orange.400"
                  onClick={() => switchMode('login')}
                  _hover={{ color: 'orange.300' }}
                >
                  Back to Login
                </Link>
              )}
            </Box>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
