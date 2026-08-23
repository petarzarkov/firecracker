import { GAME_CLIENT_EVENTS } from '@firecracker/contracts';
/* oxlint-disable max-lines -- Pre-existing: 508 lines, untouched by the dunx
   migration. The transport underneath it changed and this component did not, which
   was the point of the socket shim. Worth splitting on its own, not inside a
   migration that would then be reviewing two things at once. */
import { Box, Button, Flex, Input, Tabs, Text } from '@chakra-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '@/SocketContext';
import { useAuthStore } from '@/store/authStore';
import type { BetEntry, GamePhase } from '@/store/gameStore';
import { getLiveMultiplier, useGameStore } from '@/store/gameStore';
import { autoCashOutFor, type BetTab } from './auto-cash-out';

const QUICK_AMOUNTS = [1, 5, 10, 25, 50, 100];

/**
 * What AUTO EXIT starts at.
 *
 * The field opened empty, which made the AUTO tab a dead end: the AUTO toggle is
 * disabled until there is a target, so the first thing a player found there was a
 * `—` and a button that would not press. `1.01` is the smallest exit the server
 * accepts, so it is the one default that says "this is a floor, move it" rather
 * than quietly picking a strategy for somebody.
 */
const DEFAULT_AUTO_CASH_OUT = '1.01';

/**
 * What the action button says.
 *
 * **The phase matters.** This answered on status alone, so an `ACTIVE` bet read
 * `RIDING...` for the whole betting window after it was placed - eight seconds of
 * telling a player their money was exposed to a round still sitting on the pad.
 */
function betButtonLabel(myBet: BetEntry | null, phase: GamePhase): string {
  if (myBet === null) return 'PLACE BET';
  if (myBet.status === 'CASHED_OUT')
    return `WON $${((myBet.payoutCents ?? 0) / 100).toFixed(2)}`;
  if (myBet.status === 'LOST')
    return `LOST $${(myBet.betAmountCents / 100).toFixed(2)}`;
  return phase === 'WAITING' ? 'BET PLACED' : 'RIDING...';
}

function statusBg(status: BetEntry['status']): string {
  if (status === 'CASHED_OUT') return 'green.900';
  if (status === 'LOST') return 'red.900';
  return 'blue.900';
}

function statusColor(status: BetEntry['status']): string {
  if (status === 'CASHED_OUT') return 'green.300';
  if (status === 'LOST') return 'red.300';
  return 'blue.300';
}

/** Cash-out button — updates multiplier text via RAF, not React re-renders */
function CashOutButton({
  onCashOut,
  full = false,
}: {
  onCashOut: () => void;
  full?: boolean;
}) {
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let animId: number;
    const update = () => {
      if (labelRef.current) {
        labelRef.current.textContent = `CASH OUT ${getLiveMultiplier().toFixed(2)}x`;
      }
      animId = requestAnimationFrame(update);
    };
    animId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <Button
      onClick={onCashOut}
      bg="orange.500"
      color="white"
      fontWeight="black"
      fontSize={{ base: 'sm', lg: 'md' }}
      px={{ base: 3, lg: 5 }}
      py={{ base: 3, lg: 4 }}
      borderRadius="lg"
      _hover={{ bg: 'orange.400' }}
      _active={{ bg: 'orange.600' }}
      fontFamily="mono"
      letterSpacing="wide"
      minW={{ base: '112px', lg: '140px' }}
      width={full ? 'full' : undefined}
      boxShadow="0 0 20px #ff880060"
    >
      <span ref={labelRef}>CASH OUT 1.00x</span>
    </Button>
  );
}

/** Bet status bar — always rendered; visibility toggled to avoid layout jumps */
function BetStatusBar({
  myBet,
  show,
}: {
  myBet: BetEntry | null;
  show: boolean;
}) {
  const textRef = useRef<HTMLSpanElement>(null);

  /**
   * Narrow deps on purpose: the loop reads only these two fields of `myBet`, and
   * depending on the object would restart the RAF on every settle.
   */
  useEffect(() => {
    if (!myBet || myBet.status !== 'ACTIVE') return;
    let animId: number;
    const update = () => {
      if (textRef.current) {
        const current = (
          (myBet.betAmountCents * getLiveMultiplier()) /
          100
        ).toFixed(2);
        textRef.current.textContent = `Bet: $${(myBet.betAmountCents / 100).toFixed(2)} — Current: $${current}`;
      }
      animId = requestAnimationFrame(update);
    };
    animId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animId);
  }, [myBet?.status, myBet?.betAmountCents]);

  return (
    <Box
      mt={{ base: 1, lg: 2 }}
      p={{ base: 1, lg: 1.5 }}
      borderRadius="md"
      minH={{ base: '22px', lg: '28px' }}
      // Inherited by the RAF-written `span` below, which cannot carry a
      // responsive prop of its own - chakra types `Text`'s ref to a paragraph
      // whatever `as` says.
      fontSize={{ base: 'xs', lg: 'sm' }}
      bg={show && myBet ? statusBg(myBet.status) : 'transparent'}
      visibility={show ? 'visible' : 'hidden'}
    >
      {show &&
        myBet &&
        (myBet.status === 'ACTIVE' ? (
          <span
            ref={textRef}
            style={{
              color: 'var(--chakra-colors-blue-300)',
              fontFamily: 'monospace',
            }}
          >
            Bet: ${(myBet.betAmountCents / 100).toFixed(2)} — Current: $...
          </span>
        ) : (
          <Text
            fontSize={{ base: 'xs', lg: 'sm' }}
            color={statusColor(myBet.status)}
            fontFamily="mono"
          >
            {myBet.status === 'CASHED_OUT'
              ? `Cashed out at ${myBet.cashedOutAt?.toFixed(2)}x — Won $${((myBet.payoutCents ?? 0) / 100).toFixed(2)}`
              : `Lost $${(myBet.betAmountCents / 100).toFixed(2)}`}
          </Text>
        ))}
    </Box>
  );
}

/** Place bet button — fixed dimensions to prevent layout jumps */
function PlaceBetButton({
  canBet,
  myBet,
  phase,
  overBalance,
  onPlaceBet,
}: {
  canBet: boolean;
  myBet: BetEntry | null;
  phase: GamePhase;
  /** The stake is more than the account holds - say so on the button itself. */
  overBalance: boolean;
  onPlaceBet: () => void;
}) {
  return (
    <Button
      onClick={onPlaceBet}
      disabled={!canBet}
      bg={canBet ? 'green.600' : '#2a2a2a'}
      color={canBet ? 'white' : '#888'}
      fontWeight="black"
      fontSize={{ base: 'sm', lg: 'md' }}
      px={{ base: 3, lg: 5 }}
      py={{ base: 3, lg: 4 }}
      borderRadius="lg"
      _hover={{ bg: canBet ? 'green.500' : '#333' }}
      _active={{ bg: 'green.700' }}
      _disabled={{ cursor: 'not-allowed', opacity: 1 }}
      fontFamily="mono"
      letterSpacing="wide"
      minW={{ base: '112px', lg: '140px' }}
      width={{ base: 'full', lg: 'auto' }}
      boxShadow={canBet ? '0 0 20px rgba(255,107,0,0.38)' : 'none'}
    >
      {overBalance && myBet === null
        ? 'NOT ENOUGH'
        : betButtonLabel(myBet, phase)}
    </Button>
  );
}

/**
 * Says where an edit is going.
 *
 * Without it the inputs being live is ambiguous in the worst direction: a player
 * who raises AUTO EXIT while riding at 1.4x could reasonably read it as moving the
 * exit on the bet they are watching. It cannot - the server was told at placement -
 * so the label has to say so.
 */
function NextRoundHint() {
  return (
    <Text
      as="span"
      ml={{ base: 1, lg: 2 }}
      fontSize={{ base: '2xs', lg: 'xs' }}
      /* Was `gray.500` on this panel: 2.30:1, which is unreadable rather than
         merely quiet - and it is the line that says which round an edit lands on. */
      color="orange.300"
      fontWeight="normal"
    >
      · next round
    </Text>
  );
}

function BetAmountInput({
  amount,
  onChange,
  nextRound,
}: {
  amount: string;
  onChange: (v: string) => void;
  /** The value is queued for the next round, not the one on the table. */
  nextRound: boolean;
}) {
  return (
    <Box flex={1}>
      <Text
        fontSize={{ base: '2xs', lg: 'sm' }}
        color="#aaa"
        mb={{ base: 0.5, lg: 1 }}
        letterSpacing="wide"
        fontWeight="semibold"
      >
        BET AMOUNT
        {nextRound && <NextRoundHint />}
      </Text>
      <Flex align="center" gap={{ base: 1, lg: 2 }}>
        <Text color="#aaa" fontSize={{ base: 'sm', lg: 'lg' }}>
          $
        </Text>
        <Input
          value={amount}
          onChange={(e) => onChange(e.target.value)}
          type="number"
          min="1"
          step="1"
          /* The visible "BET AMOUNT" above is a `Text`, not a `<label for>`, so
             without this the field announces as an unnamed number spinner. */
          aria-label="Bet amount in dollars"
          inputMode="decimal"
          bg="#1e1e1e"
          border="1px solid"
          borderColor="#444"
          color="white"
          fontFamily="mono"
          fontSize={{ base: 'sm', lg: 'lg' }}
          fontWeight="bold"
          px={{ base: 2, lg: 3 }}
          py={{ base: 1, lg: 1.5 }}
          borderRadius="md"
          _focus={{ borderColor: 'green.500', outline: 'none' }}
        />
      </Flex>
    </Box>
  );
}

/**
 * Taking the money, as a hook - because two places need it.
 *
 * The bet panel has the button, and on a phone the panel lives in a tab beside
 * chat and the player list, so a player reading chat mid-round had no way to cash
 * out at all. `CashOutBar` is that button pinned where the tabs cannot hide it, and
 * both call this.
 */
export function useCashOut(): { canCashOut: boolean; cashOut: () => void } {
  const socket = useSocket();
  const phase = useGameStore((state) => state.phase);
  const myBet = useGameStore((state) => state.myBet);
  const updateBet = useGameStore((state) => state.updateBet);

  const canCashOut = phase === 'RUNNING' && myBet?.status === 'ACTIVE';

  const cashOut = useCallback(() => {
    if (!socket || !canCashOut || !myBet) return;
    const mult = getLiveMultiplier();
    updateBet({
      userId: myBet.userId,
      username: myBet.username,
      betAmountCents: myBet.betAmountCents,
      status: 'CASHED_OUT',
      cashedOutAt: mult,
      payoutCents: Math.floor(myBet.betAmountCents * mult),
      isOptimistic: true,
    });
    socket.emit(GAME_CLIENT_EVENTS.CASH_OUT);
  }, [socket, canCashOut, myBet, updateBet]);

  return { canCashOut, cashOut };
}

/**
 * The cash-out button, pinned above the tab strip on a phone.
 *
 * Renders nothing unless there is something to take. It is the only control in this
 * game with a deadline, and it was the one you could navigate away from.
 */
export function CashOutBar() {
  const { canCashOut, cashOut } = useCashOut();
  if (!canCashOut) return null;

  return (
    <Box
      px={2}
      py={2}
      bg="gray.900"
      borderTop="1px solid"
      borderColor="orange.500"
      flexShrink={0}
    >
      <CashOutButton onCashOut={cashOut} full />
    </Box>
  );
}

/**
 * The controls, or an invitation to get them.
 *
 * A spectator sees the lobby now, so this panel has a signed-out state: the game is
 * watchable and betting is the thing an account buys.
 */
export function BetPanel({ onSignIn }: { onSignIn?: () => void }) {
  const socket = useSocket();
  const phase = useGameStore((state) => state.phase);
  const myBet = useGameStore((state) => state.myBet);
  const betError = useGameStore((state) => state.betError);
  const clearBetError = useGameStore((state) => state.clearBetError);
  const isDemoMode = useGameStore((state) => state.isDemoMode);
  const addBet = useGameStore((state) => state.addBet);
  const myUserId = useAuthStore((state) => state.user?.id);
  const myUsername = useAuthStore(
    (state) => state.user?.displayName ?? state.user?.email?.split('@')[0],
  );

  const balanceCents = useGameStore((state) => state.demoBalanceCents) ?? 0;
  const [amount, setAmount] = useState('5.00');
  const [autoCashOut, setAutoCashOut] = useState(DEFAULT_AUTO_CASH_OUT);
  const [autoPlay, setAutoPlay] = useState(false);
  const [activeTab, setActiveTab] = useState<BetTab>('manual');

  const amountCents = Math.round(Number.parseFloat(amount || '0') * 100);
  const overBalance = balanceCents > 0 && amountCents > balanceCents;

  /**
   * Sets the stake, held between the minimum and what is actually in the account.
   *
   * Every adjustment goes through here. Typing 99999 against $1,000 used to leave a
   * fully enabled button and a server round-trip to find out, with the refusal
   * printed at the bottom of the panel while the eye was on the button at the top.
   */
  const setStake = useCallback(
    (cents: number) => {
      const ceiling = balanceCents > 0 ? balanceCents : cents;
      setAmount((Math.max(100, Math.min(cents, ceiling)) / 100).toFixed(2));
    },
    [balanceCents],
  );
  // The tab is part of the answer - see `autoCashOutFor`.
  const autoCashOutTarget = autoCashOutFor(activeTab, autoCashOut);
  const hasAutoCashOut = autoCashOutTarget !== null;
  const canBet =
    phase === 'WAITING' &&
    myBet === null &&
    amountCents >= 100 &&
    // `0` means the balance has not arrived yet, not that the account is empty -
    // gating on it would refuse the first bet of every session.
    (balanceCents === 0 || amountCents <= balanceCents);
  const { canCashOut, cashOut } = useCashOut();
  /**
   * Whether an edit lands on the **next** round rather than this one.
   *
   * The inputs used to be *disabled* whenever a bet was open or the round was not
   * in its betting window - roughly four fifths of a cycle, and exactly the part
   * of it a player spends deciding what to do next. Nothing was protected by that:
   * `amountCents` and `autoCashOutTarget` are read in `handlePlaceBet`, and the
   * server is told `autoCashOutAt` once, at placement. There is no path by which
   * typing here changes a stake already on the table.
   *
   * So the inputs stay live and the labels say where the value is going. With
   * auto-play on it is load-bearing rather than convenient: the only moment you
   * could retune it was the one moment it was about to re-bet for you.
   */
  const editsNextRound = myBet !== null || phase !== 'WAITING';

  const handlePlaceBet = useCallback(() => {
    if (!socket || !canBet || !myUsername || myUserId === undefined) return;
    clearBetError();
    addBet(
      {
        userId: myUserId,
        username: myUsername,
        betAmountCents: amountCents,
        status: 'ACTIVE',
      },
      myUserId,
    );
    socket.emit(GAME_CLIENT_EVENTS.PLACE_BET, {
      betAmountCents: amountCents,
      isDemo: isDemoMode,
      ...(autoCashOutTarget === null
        ? {}
        : { autoCashOutAt: autoCashOutTarget }),
    });
  }, [
    socket,
    canBet,
    myUsername,
    clearBetError,
    addBet,
    amountCents,
    isDemoMode,
    autoCashOutTarget,
    // Read inside, and it arrives *after* the first render - the socket's
    // `connected` frame is what sets it. Omitted, this callback captured the
    // `undefined` it was built with and the guard above silently swallowed the bet.
    myUserId,
  ]);

  const handleCashOut = cashOut;

  // Auto-play requires auto exit — turn off if exit target is removed
  useEffect(() => {
    if (autoPlay && !hasAutoCashOut) setAutoPlay(false);
  }, [autoPlay, hasAutoCashOut]);

  // Auto-play: place bet automatically when waiting phase starts and no bet yet
  useEffect(() => {
    if (autoPlay && canBet) {
      handlePlaceBet();
    }
  }, [autoPlay, canBet, handlePlaceBet]);

  /**
   * Before the launch a bet is still yours to take back.
   *
   * Every crash game allows this and this one did not, so the only way out of a
   * mis-click was to watch it ride. The server refunds the stake and forgets the
   * auto-cashout; see `BetActionsService.cancel`.
   */
  const canCancel = phase === 'WAITING' && myBet?.status === 'ACTIVE';

  const actionButton = canCashOut ? (
    <CashOutButton onCashOut={handleCashOut} full />
  ) : canCancel ? (
    <Flex gap={2} align="stretch">
      <Button
        onClick={() => socket?.emit(GAME_CLIENT_EVENTS.CANCEL_BET, {})}
        variant="outline"
        borderColor="#5a4a3a"
        color="gray.300"
        fontFamily="mono"
        fontWeight="bold"
        fontSize={{ base: 'sm', lg: 'md' }}
        px={{ base: 3, lg: 4 }}
        py={{ base: 3, lg: 4 }}
        borderRadius="lg"
        flexShrink={0}
        _hover={{ borderColor: 'red.400', color: 'red.300' }}
      >
        CANCEL
      </Button>
      <Box flex={1}>
        <PlaceBetButton
          canBet={canBet}
          myBet={myBet}
          phase={phase}
          overBalance={overBalance}
          onPlaceBet={handlePlaceBet}
        />
      </Box>
    </Flex>
  ) : (
    <PlaceBetButton
      canBet={canBet}
      myBet={myBet}
      phase={phase}
      overBalance={overBalance}
      onPlaceBet={handlePlaceBet}
    />
  );

  if (myUserId === undefined) {
    return (
      <Box
        bg="gray.900"
        borderRadius="lg"
        border="1px solid"
        borderColor="#3a3a3a"
        p={{ base: 3, lg: 4 }}
        textAlign="center"
      >
        <Text fontSize="sm" color="gray.300" fontFamily="mono" mb={1}>
          You are watching
        </Text>
        <Text fontSize="xs" color="gray.500" mb={3}>
          Every round here is real and every crash point is checkable. Take a
          demo account to join one — $1,000 in play money, no email.
        </Text>
        <Button
          onClick={onSignIn}
          bg="green.600"
          color="white"
          fontWeight="black"
          fontFamily="mono"
          letterSpacing="wide"
          width="full"
          py={3}
          borderRadius="lg"
          _hover={{ bg: 'green.500' }}
        >
          PLAY
        </Button>
      </Box>
    );
  }

  return (
    <Box
      bg="gray.900"
      borderRadius="lg"
      border="1px solid"
      borderColor="orange.400"
      p={{ base: 1.5, lg: 3 }}
    >
      {/*
       * Status bar — always rendered with a fixed min-height so its appearance
       * never shifts the chart above. Uses visibility:hidden when not active.
       */}
      <BetStatusBar
        myBet={myBet}
        show={myBet !== null && phase !== 'WAITING'}
      />
      {/*
       * Tabs contain ONLY the config inputs so both tabs have the same height.
       * The action button and quick bets live outside the tabs — this prevents
       * height changes when switching Manual ↔ Auto, which would resize the
       * canvas and displace the chart line.
       */}
      <Tabs.Root
        defaultValue="manual"
        variant="plain"
        size="sm"
        onValueChange={(e) => setActiveTab(e.value as 'manual' | 'auto')}
      >
        {/* Tab headers */}
        <Tabs.List
          mb={{ base: 1, lg: 2 }}
          borderBottom="1px solid"
          borderColor="gray.800"
          gap={0}
        >
          {(['manual', 'auto'] as const).map((tab) => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              fontFamily="mono"
              fontSize="xs"
              fontWeight="bold"
              letterSpacing="wide"
              px={{ base: 3, lg: 3 }}
              py={{ base: 2, lg: 1.5 }}
              color="#999"
              _selected={{
                color: 'green.400',
                borderBottom: '2px solid',
                borderColor: 'green.500',
              }}
              _hover={{ color: '#ccc' }}
            >
              {tab.toUpperCase()}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Manual tab — bet amount only */}
        <Tabs.Content value="manual">
          <BetAmountInput
            amount={amount}
            onChange={setAmount}
            nextRound={editsNextRound}
          />
        </Tabs.Content>

        {/* Auto tab — bet amount + auto exit target (same row height as manual) */}
        <Tabs.Content value="auto">
          <Flex gap={{ base: 2, lg: 3 }} align="flex-end">
            <BetAmountInput
              amount={amount}
              onChange={setAmount}
              nextRound={editsNextRound}
            />

            {/* Auto exit target */}
            <Box minW={{ base: '76px', lg: '90px' }}>
              <Text
                fontSize={{ base: '2xs', lg: 'xs' }}
                color="gray.500"
                mb={{ base: 0.5, lg: 1 }}
                letterSpacing="wide"
              >
                AUTO EXIT
                {editsNextRound && <NextRoundHint />}
              </Text>
              <Flex align="center" gap={1}>
                <Input
                  value={autoCashOut}
                  onChange={(e) => setAutoCashOut(e.target.value)}
                  placeholder="—"
                  type="number"
                  min="1.01"
                  step="0.1"
                  bg="gray.800"
                  border="1px solid"
                  borderColor={hasAutoCashOut ? 'yellow.600' : 'gray.700'}
                  color={hasAutoCashOut ? 'yellow.300' : 'gray.500'}
                  fontFamily="mono"
                  fontSize={{ base: 'sm', lg: 'md' }}
                  fontWeight="bold"
                  px={2}
                  py={{ base: 1, lg: 2 }}
                  borderRadius="md"
                  _focus={{ borderColor: 'yellow.500', outline: 'none' }}
                  _placeholder={{ color: 'gray.600' }}
                />
                {hasAutoCashOut ? (
                  <Box
                    as="button"
                    onClick={() => setAutoCashOut('')}
                    color="gray.400"
                    fontSize="lg"
                    lineHeight="1"
                    px={1}
                    cursor="pointer"
                    _hover={{ color: 'red.400' }}
                    title="Clear auto exit"
                  >
                    ×
                  </Box>
                ) : (
                  <Text color="gray.600" fontSize="sm">
                    x
                  </Text>
                )}
              </Flex>
            </Box>
          </Flex>
        </Tabs.Content>
      </Tabs.Root>

      {/*
       * Adjustments, then the action - **under** the field they act on.
       *
       * The panel used to read bottom-up: the button and the quick amounts sat
       * above the MANUAL/AUTO tabs and the amount they spend, so on a phone the
       * primary action was the first thing you reached and the last thing you
       * should press.
       *
       * The AUTO-PLAY toggle is always rendered (visibility:hidden on manual) so
       * this row never changes height, and neither does the chart above it.
       */}
      <Flex
        direction={{ base: 'column', lg: 'row' }}
        gap={{ base: 2, lg: 3 }}
        align={{ base: 'stretch', lg: 'flex-end' }}
        mt={{ base: 2, lg: 2 }}
      >
        <Box flex={1}>
          <Flex gap={{ base: 1, lg: 2 }} flexWrap="wrap" align="center">
            <Text fontSize="xs" color="#aaa" alignSelf="center" mr={1}>
              Quick:
            </Text>
            {QUICK_AMOUNTS.map((a) => (
              <Button
                key={a}
                size={{ base: 'xs', lg: 'xs' }}
                variant="outline"
                borderColor="#555"
                color="#ccc"
                fontFamily="mono"
                fontSize="xs"
                /* These were 30x24 on a phone against a 44x44 guideline, and they
                   set the stake - a mis-tap here is the wrong amount of money, not
                   the wrong page. */
                minW={{ base: '52px', lg: 'auto' }}
                minH={{ base: '40px', lg: 'auto' }}
                onClick={() => setStake(a * 100)}
                _hover={{
                  borderColor: 'green.400',
                  color: 'green.300',
                  bg: 'rgba(255,107,0,0.12)',
                }}
                _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
                px={{ base: 2, lg: 3 }}
                py={1}
              >
                ${a}
              </Button>
            ))}
            {/*
              Halve, double, everything. A crash game has these three and this one
              did not, so the only way to bet what you actually hold was to know
              the number and type it.
            */}
            {(
              [
                ['½', () => setStake(Math.floor(amountCents / 2))],
                ['2×', () => setStake(amountCents * 2)],
                ['MAX', () => setStake(balanceCents)],
              ] as const
            ).map(([label, onClick]) => (
              <Button
                key={label}
                size="xs"
                variant="outline"
                borderColor="#4a3a22"
                color="orange.200"
                fontFamily="mono"
                fontSize="xs"
                minW={{ base: '52px', lg: 'auto' }}
                minH={{ base: '40px', lg: 'auto' }}
                px={{ base: 2, lg: 3 }}
                py={1}
                onClick={onClick}
                _hover={{ borderColor: 'orange.400', color: 'orange.100' }}
              >
                {label}
              </Button>
            ))}
            {/* AUTO toggle — always rendered; invisible on manual to keep row height stable */}
            <Button
              size={{ base: '2xs', lg: 'xs' }}
              variant="outline"
              borderColor={
                autoPlay
                  ? 'green.500'
                  : hasAutoCashOut
                    ? 'gray.600'
                    : 'gray.700'
              }
              /* `gray.700` on this ground measured 1.21:1 - a disabled control
                 still has to be readable enough to say why it is disabled. */
              color={
                autoPlay
                  ? 'green.400'
                  : hasAutoCashOut
                    ? 'gray.400'
                    : 'gray.500'
              }
              fontFamily="mono"
              fontSize="xs"
              minH={{ base: '40px', lg: 'auto' }}
              disabled={!hasAutoCashOut}
              onClick={() => setAutoPlay((v) => !v)}
              visibility={activeTab === 'auto' ? 'visible' : 'hidden'}
              pointerEvents={activeTab === 'auto' ? 'auto' : 'none'}
              _hover={{
                borderColor: 'green.400',
                color: 'green.300',
                bg: 'rgba(255,107,0,0.1)',
              }}
              _disabled={{ opacity: 0.35, cursor: 'not-allowed' }}
              title={
                hasAutoCashOut
                  ? autoPlay
                    ? 'Auto-play ON — click to stop'
                    : 'Auto-play: bet automatically each round'
                  : 'Set an AUTO EXIT value to enable auto-play'
              }
            >
              {autoPlay ? 'AUTO-PLAY ON' : 'AUTO-PLAY'}
            </Button>
          </Flex>
        </Box>

        {/*
          Stuck to the bottom of the panel's scroll area on anything narrow.
          
          The panel is 170px tall in landscape and the action is the last thing in
          it, so on a phone held sideways `PLACE BET` sat below the fold of a
          container most people would not think to scroll. `lg` has room for the
          row, so there it stays where it is.
        */}
        <Box
          flexShrink={0}
          position={{ base: 'sticky', lg: 'static' }}
          bottom={0}
          zIndex={1}
          bg={{ base: 'gray.900', lg: 'transparent' }}
          pt={{ base: 1, lg: 0 }}
        >
          {actionButton}
        </Box>
      </Flex>

      {/*
       * Error slot — always rendered at fixed height so its appearance never
       * shifts the action row. Uses visibility:hidden when there is no error.
       */}
      <Text
        fontSize={{ base: 'xs', lg: 'sm' }}
        color="red.400"
        fontFamily="mono"
        mt={{ base: 1, lg: 2 }}
        px={1}
        minH={{ base: '1rem', lg: '1.25rem' }}
        visibility={betError ? 'visible' : 'hidden'}
      >
        {betError ?? '\u00A0'}
      </Text>
    </Box>
  );
}
