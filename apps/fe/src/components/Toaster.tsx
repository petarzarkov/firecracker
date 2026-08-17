import {
  Box,
  Toaster as ChakraToaster,
  createToaster,
  IconButton,
  Portal,
  Spinner,
  Stack,
  Toast,
} from '@chakra-ui/react';
import { useEffect, useRef } from 'react';
import {
  FiAlertCircle,
  FiAlertTriangle,
  FiCheckCircle,
  FiInfo,
  FiX,
} from 'react-icons/fi';

export const toaster = createToaster({
  placement: 'bottom-end',
  pauseOnPageIdle: true,
  overlap: true,
  duration: 4000,
  max: 6,
});

const getToastConfig = (type: string | undefined) => {
  const configs = {
    success: {
      icon: FiCheckCircle,
      bg: 'success.50',
      color: 'success.600',
      borderColor: 'success.200',
    },
    error: {
      icon: FiAlertCircle,
      bg: 'error.50',
      color: 'error.600',
      borderColor: 'error.200',
    },
    warning: {
      icon: FiAlertTriangle,
      bg: 'warning.50',
      color: 'warning.600',
      borderColor: 'warning.200',
    },
    info: {
      icon: FiInfo,
      bg: 'purple.50',
      color: 'purple.400',
      borderColor: 'purple.200',
    },
    loading: {
      icon: Spinner,
      bg: 'gray.50',
      color: 'gray.600',
      borderColor: 'gray.200',
    },
  };
  return configs[(type || 'info') as keyof typeof configs] || configs.info;
};

export const Toaster = () => {
  const portalRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    portalRef.current = document.body;
  }, []);

  return (
    <Portal container={portalRef}>
      <ChakraToaster
        toaster={toaster}
        insetInline={{ mdDown: '4' }}
        zIndex={1500}
      >
        {(toast) => {
          const config = getToastConfig(toast.type);
          const IconComponent = config.icon;

          return (
            <Toast.Root
              width={{ md: 'sm' }}
              bg={config.bg}
              border="1px solid"
              borderColor={config.borderColor}
              borderRadius="md"
              boxShadow="lg"
              position="relative"
              pr={12} // Add right padding for close button
              data-chakra-toast="true"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
              }}
            >
              {toast.type === 'loading' ? (
                <Spinner size="sm" color={config.color} />
              ) : (
                <Box
                  as={IconComponent}
                  color={config.color}
                  boxSize={5}
                  flexShrink={0}
                  mt={0.5}
                />
              )}
              <Stack gap="1" flex="1" maxWidth="100%">
                {toast.title && (
                  <Toast.Title color={config.color} fontWeight="semibold">
                    {toast.title}
                  </Toast.Title>
                )}
                {toast.description && (
                  <Toast.Description color={config.color} opacity={0.9}>
                    {toast.description}
                  </Toast.Description>
                )}
              </Stack>
              {toast.action && (
                <Toast.ActionTrigger color={config.color}>
                  {toast.action.label}
                </Toast.ActionTrigger>
              )}

              {/* Custom close button */}
              {toast.closable !== false && (
                <Toast.CloseTrigger asChild>
                  <IconButton
                    aria-label="Close notification"
                    variant="ghost"
                    size="sm"
                    color={config.color}
                    position="absolute"
                    top={3}
                    right={3}
                    minW={6}
                    h={6}
                    _hover={{ bg: 'blackAlpha.100' }}
                    _active={{ bg: 'blackAlpha.200' }}
                    data-testid="toaster-close-button"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                    }}
                  >
                    <FiX size={14} />
                  </IconButton>
                </Toast.CloseTrigger>
              )}
            </Toast.Root>
          );
        }}
      </ChakraToaster>
    </Portal>
  );
};
