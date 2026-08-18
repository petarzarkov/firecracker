/* oxlint-disable max-lines -- One component covering four flows: sign in, sign up,
   request a reset and apply one. It crossed the limit when the Better Auth port
   added the social and anonymous paths. Worth splitting per mode, and not inside a
   migration that would then be reviewing two changes at once. */
import { Box, Icon, Image, Link, Stack, Text } from '@chakra-ui/react';
import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import { FaGamepad, FaGithub, FaLinkedin } from 'react-icons/fa';
import { useAuthStore } from '../../store/authStore';
import { useGameStore } from '../../store/gameStore';
import * as authApi from '../../systems/auth/auth-api';
import type { SocialProvider } from '../../systems/auth/auth-api';
import { AvatarPicker } from '../ui/AvatarPicker';
import { Button } from '../ui/Button';
import { GradientDivider } from '../ui/GradientDivider';
import { InputField } from '../ui/InputField';

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

const SocialButtons = ({
  isLoading,
  onDemoLogin,
  onSocial,
}: {
  isLoading: boolean;
  onDemoLogin: () => void;
  onSocial: (provider: SocialProvider) => void;
}) => (
  <>
    <GradientDivider />
    <Stack gap={3}>
      <Button
        onClick={() => onSocial('github')}
        disabled={isLoading}
        variant="glass"
        width="full"
      >
        <Icon as={FaGithub} />
        Continue with GitHub
      </Button>
      <Button
        onClick={() => onSocial('linkedin')}
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
    </Box>
  </>
);

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

  const setAuth = useAuthStore((state) => state.setAuth);
  const setIsDemoMode = useGameStore((state) => state.setIsDemoMode);

  const handleDemoLogin = async () => {
    setStatus({ isLoading: true, error: '', success: '' });
    try {
      // A real user row with a demo wallet and no credential - better-auth's
      // `anonymous()` plugin. The old `/api/auth/demo` did the same by hand.
      const { token, user } = await authApi.signInAnonymous();
      setAuth(token, user);
      setIsDemoMode(true);
    } catch (err) {
      setStatus((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Demo login failed',
      }));
    }
  };

  const handleSocial = (provider: SocialProvider) => {
    setStatus({ isLoading: true, error: '', success: '' });
    // Navigates on success, so there is no success branch to write.
    void authApi.signInSocial(provider, window.location.origin).catch((err) => {
      setStatus({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Sign-in failed',
        success: '',
      });
    });
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
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));
    };

  const switchMode = (newMode: FormMode) => {
    setMode(newMode);
    setStatus({ isLoading: false, error: '', success: '' });
    setFormData(INITIAL_STATE);
    if (newMode === 'login') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus({ isLoading: true, error: '', success: '' });

    try {
      if (mode === 'login') {
        const { token, user } = await authApi.signIn(
          formData.email,
          formData.password,
        );
        setAuth(token, user);
      } else if (mode === 'register') {
        const { token, user } = await authApi.signUp({
          email: formData.email,
          password: formData.password,
          name: formData.displayName || formData.email.split('@')[0] || '',
          image:
            formData.customPictureUrl.trim() || formData.picture || undefined,
        });
        setAuth(token, user);
      } else if (mode === 'requestReset') {
        // `redirectTo` is where the emailed link lands. It carries `?token=`,
        // which the effect above reads to switch this form into reset mode.
        await authApi.requestPasswordReset(
          formData.email,
          window.location.origin,
        );
        setStatus((prev) => ({
          ...prev,
          isLoading: false,
          success: 'Password reset email sent! Check your inbox.',
        }));
        setFormData((prev) => ({ ...prev, email: '' }));
      } else if (mode === 'resetPassword') {
        if (formData.newPassword !== formData.confirmPassword)
          throw new Error('Passwords do not match');
        if (formData.newPassword.length < 8)
          throw new Error('Password must be at least 8 characters');

        await authApi.resetPassword(resetToken, formData.newPassword);
        setStatus((prev) => ({
          ...prev,
          isLoading: false,
          success: 'Success! Redirecting to login...',
        }));

        setTimeout(() => switchMode('login'), 2000);
      }
    } catch (err) {
      setStatus((prev) => ({
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
      minHeight="100vh"
      position="relative"
      overflowX="hidden"
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
        minHeight="100vh"
        display="flex"
        alignItems="center"
        justifyContent="center"
        py="10"
        position="relative"
        zIndex={1}
      >
        {/* Glass card */}
        <Box
          as="form"
          onSubmit={handleSubmit}
          borderRadius="xl"
          width="460px"
          maxW="110vw"
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
                  onSelect={(url) =>
                    setFormData((p) => ({
                      ...p,
                      picture: url,
                      customPictureUrl: '',
                    }))
                  }
                  onCustomUrlChange={(url) =>
                    setFormData((p) => ({ ...p, customPictureUrl: url }))
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
                    onSocial={handleSocial}
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
