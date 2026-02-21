import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useGameStore } from '@/store/gameStore';

export function WalletWidget() {
  const token = useAuthStore(state => state.token);
  const { walletBalanceCents, setWalletBalance } = useGameStore();
  const [depositing, setDepositing] = useState(false);
  const [depositAmount, setDepositAmount] = useState('20.00');
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositMsg, setDepositMsg] = useState('');

  // Fetch wallet balance on mount
  useEffect(() => {
    if (!token) return;
    fetch('/api/wallet', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d?.balanceCents !== undefined) {
          setWalletBalance(d.balanceCents);
        }
      })
      .catch(() => {});
  }, [token, setWalletBalance]);

  async function handleDeposit() {
    if (!token) return;
    const amountCents = Math.round(
      Number.parseFloat(depositAmount || '0') * 100,
    );
    if (amountCents < 100) {
      setDepositMsg('Minimum deposit is $1.00');
      return;
    }
    setDepositLoading(true);
    setDepositMsg('');
    try {
      const res = await fetch('/api/wallet/deposit/session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amountCents }),
      });
      if (!res.ok) {
        setDepositMsg('Failed to create deposit session');
      } else {
        setDepositMsg(
          'Deposit session created — Stripe payment UI coming soon. Use the clientSecret with stripe.js.',
        );
      }
    } catch {
      setDepositMsg('Network error');
    } finally {
      setDepositLoading(false);
    }
  }

  const balance = walletBalanceCents !== null ? walletBalanceCents / 100 : null;

  return (
    <Box position="relative">
      <Flex
        align="center"
        gap={2}
        cursor="pointer"
        onClick={() => setDepositing(v => !v)}
        px={3}
        py={1.5}
        borderRadius="md"
        bg="gray.800"
        border="1px solid"
        borderColor={depositing ? 'green.600' : 'gray.600'}
        _hover={{ borderColor: 'green.600' }}
        transition="border-color 0.2s"
      >
        <Text fontSize="xs" color="gray.500">
          Balance
        </Text>
        <Text
          fontSize="sm"
          fontWeight="bold"
          color={balance !== null ? 'green.400' : 'gray.500'}
          fontFamily="mono"
        >
          {balance !== null ? `$${balance.toFixed(2)}` : '...'}
        </Text>
        <Text fontSize="xs" color="gray.600">
          ▾
        </Text>
      </Flex>

      {depositing && (
        <Box
          position="absolute"
          top="calc(100% + 6px)"
          right={0}
          bg="gray.800"
          border="1px solid"
          borderColor="gray.600"
          borderRadius="lg"
          p={3}
          w="220px"
          zIndex={100}
          boxShadow="0 8px 32px rgba(0,0,0,0.5)"
        >
          <Text fontSize="xs" color="gray.400" mb={2} fontWeight="bold">
            DEPOSIT FUNDS
          </Text>
          <Flex gap={2} mb={2}>
            <Text color="gray.400" alignSelf="center">
              $
            </Text>
            <Input
              value={depositAmount}
              onChange={e => setDepositAmount(e.target.value)}
              type="number"
              min="1"
              step="1"
              bg="gray.700"
              border="1px solid"
              borderColor="gray.500"
              color="white"
              fontFamily="mono"
              fontSize="sm"
              size="sm"
              flex={1}
              _focus={{ borderColor: 'green.500', outline: 'none' }}
            />
          </Flex>
          <Button
            onClick={handleDeposit}
            loading={depositLoading}
            w="full"
            size="sm"
            bg="green.700"
            color="white"
            fontFamily="mono"
            _hover={{ bg: 'green.600' }}
            mb={depositMsg ? 2 : 0}
          >
            Deposit via Stripe
          </Button>
          {depositMsg && (
            <Text fontSize="xs" color="yellow.300" mt={1}>
              {depositMsg}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
