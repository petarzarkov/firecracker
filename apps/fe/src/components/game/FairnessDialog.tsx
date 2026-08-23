import { Box, Dialog, Flex, Portal, Text } from '@chakra-ui/react';
import { GAME_CLIENT_EVENTS } from '@firecracker/contracts';
import { useEffect, useState } from 'react';
import { useSocket } from '@/SocketContext';
import { Button } from '@/components/ui/Button';
import { InputField } from '@/components/ui/InputField';
import { type RoundProof, useGameStore } from '@/store/gameStore';
import {
  commitmentHolds,
  fetchProof,
  type Recipe,
  rngSeedOf,
} from '@/systems/network/fairness';

/**
 * What a round was drawn from, and how to check it.
 *
 * The server has published every part of this from the beginning - the commitment
 * before a round runs, the seeds after it crashes, and a public endpoint that
 * re-serves both with the steps to redo the draw. The client showed none of it, so
 * the one claim this game makes that a player cannot verify by watching was also the
 * one thing they had to take on faith.
 *
 * Two views, because a round has two halves. Before the crash there is a commitment
 * and a seed you can still influence; after it there is everything.
 */

const MONO = {
  fontFamily: 'monospace',
  fontSize: '11px',
  wordBreak: 'break-all' as const,
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text
        fontSize="2xs"
        color="gray.500"
        letterSpacing="wider"
        fontFamily="monospace"
      >
        {label}
      </Text>
      <Text color="gray.100" {...MONO}>
        {value}
      </Text>
    </Box>
  );
}

/** The commitment check, run in the browser. See `commitmentHolds`. */
function CommitmentBadge({ proof }: { proof: RoundProof }) {
  const [holds, setHolds] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    commitmentHolds(proof)
      .then((result) => {
        if (live) setHolds(result);
      })
      .catch(() => {
        if (live) setHolds(false);
      });
    return () => {
      live = false;
    };
  }, [proof]);

  if (holds === null) return null;

  return (
    <Flex
      align="center"
      gap={2}
      px={3}
      py={2}
      borderRadius="md"
      bg={holds ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.12)'}
      border="1px solid"
      borderColor={holds ? 'green.700' : 'red.600'}
    >
      <Text fontSize="sm">{holds ? '✓' : '✕'}</Text>
      <Text fontSize="xs" color={holds ? 'green.300' : 'red.300'}>
        {holds
          ? 'Checked here in your browser: the seed matches the hash published before this round ran.'
          : 'The seed does not match the hash published before this round. Do not trust this result.'}
      </Text>
    </Flex>
  );
}

/** The round on the table: a commitment, and a seed you can still add to. */
function LiveRound({ onClose }: { onClose: () => void }) {
  const socket = useSocket();
  const seedHash = useGameStore((state) => state.seedHash);
  const nonce = useGameStore((state) => state.nonce);
  const phase = useGameStore((state) => state.phase);
  const [seed, setSeed] = useState('');
  const [sent, setSent] = useState(false);

  const canSend = phase === 'WAITING' && seed.trim().length > 0;

  return (
    <Flex direction="column" gap={4}>
      <Text fontSize="xs" color="gray.400">
        The crash point does not exist yet. We have committed to a server seed
        by publishing its hash below, and we draw the multiplier only once the
        betting window closes — from that seed, the players' seeds and the round
        number together.
      </Text>

      {seedHash === null ? (
        <Text fontSize="xs" color="gray.500">
          Waiting for the next round's commitment…
        </Text>
      ) : (
        <>
          <Field label="COMMITMENT · SHA256(server seed)" value={seedHash} />
          {nonce !== null && (
            <Field label="ROUND NUMBER" value={String(nonce)} />
          )}
        </>
      )}

      <Box borderTop="1px solid" borderColor="#2a2a2a" pt={3}>
        <InputField
          label="Add your own seed"
          value={seed}
          onChange={(event) => {
            setSeed(event.target.value);
            setSent(false);
          }}
          placeholder="anything you like"
          maxLength={128}
          disabled={phase !== 'WAITING'}
        />
        <Text fontSize="2xs" color="gray.500" mt={2}>
          Mixed into the draw with every other player's. We cannot know the
          outcome without it, and you can prove afterwards that yours was used.
          {phase !== 'WAITING' && ' Available during the betting window.'}
        </Text>
        <Button
          mt={3}
          width="full"
          variant="glass"
          disabled={!canSend}
          onClick={() => {
            socket?.emit(GAME_CLIENT_EVENTS.SUBMIT_CLIENT_SEED, {
              seed: seed.trim(),
            });
            setSent(true);
          }}
        >
          {sent ? 'Seed submitted' : 'Use this seed'}
        </Button>
      </Box>

      <Button variant="glass" width="full" onClick={onClose}>
        Close
      </Button>
    </Flex>
  );
}

/** A round that has crashed: everything, and what to run. */
function CrashedRound({
  roundId,
  onClose,
}: {
  roundId: string;
  onClose: () => void;
}) {
  const known = useGameStore((state) => state.proofs[roundId]);
  const [proof, setProof] = useState<RoundProof | undefined>(known);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    // The socket carried the proof for any round this session watched crash; older
    // ones - anything from before a reload - come from the endpoint.
    fetchProof(roundId)
      .then((fetched) => {
        if (!live) return;
        setProof(fetched.proof);
        setRecipe(fetched.recipe);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        if (known === undefined) {
          setError(
            failure instanceof Error ? failure.message : 'Could not load it',
          );
        }
      });
    return () => {
      live = false;
    };
  }, [roundId, known]);

  if (proof === undefined) {
    return (
      <Flex direction="column" gap={4}>
        <Text fontSize="xs" color={error ? 'red.300' : 'gray.500'}>
          {error || 'Loading…'}
        </Text>
        <Button variant="glass" width="full" onClick={onClose}>
          Close
        </Button>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap={3}>
      <Flex align="baseline" gap={2}>
        <Text fontSize="2xl" fontWeight="black" color="orange.300">
          {proof.crashPoint.toFixed(2)}x
        </Text>
        <Text fontSize="xs" color="gray.500">
          crashed here
        </Text>
      </Flex>

      <CommitmentBadge proof={proof} />

      <Field
        label="SERVER SEED · revealed after the crash"
        value={proof.serverSeed}
      />
      <Field
        label="COMMITMENT · published before it"
        value={proof.serverSeedHash}
      />
      <Field
        label="CLIENT SEED · every player's, combined"
        value={proof.clientSeed}
      />
      <Text fontSize="2xs" color="gray.600" mt={-2}>
        A hash of every seed submitted for this round, in a fixed order — so one
        player cannot read another's, and adding yours provably changes it. With
        nobody contributing it is the word <em>firecracker</em>.
      </Text>
      <Field label="ROUND NUMBER" value={String(proof.nonce)} />
      <Field label="ALGORITHM" value={proof.algorithm} />
      <Field
        label="GENERATOR SEED"
        value={recipe?.rngSeed ?? rngSeedOf(proof)}
      />

      {recipe !== null && (
        <Box borderTop="1px solid" borderColor="#2a2a2a" pt={3}>
          <Text
            fontSize="2xs"
            color="gray.500"
            letterSpacing="wider"
            fontFamily="monospace"
            mb={2}
          >
            REDRAW IT YOURSELF
          </Text>
          {recipe.steps.map((step) => (
            <Text key={step} color="gray.300" {...MONO} mb={1}>
              {step}
            </Text>
          ))}
        </Box>
      )}

      <Button variant="glass" width="full" onClick={onClose} mt={1}>
        Close
      </Button>
    </Flex>
  );
}

export function FairnessDialog({
  roundId,
  open,
  onClose,
}: {
  /** A crashed round to open, or `null` for the round in progress. */
  roundId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(event) => {
        if (!event.open) onClose();
      }}
      placement="center"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop style={{ background: 'rgba(0,0,0,0.7)' }} />
        <Dialog.Positioner>
          <Dialog.Content
            borderRadius="xl"
            maxW="480px"
            maxH="86dvh"
            overflowY="auto"
            p="6"
            style={{
              background: 'rgba(13, 8, 0, 0.97)',
              border: '1px solid rgba(255, 107, 0, 0.25)',
            }}
          >
            <Dialog.Title
              color="orange.300"
              fontFamily="monospace"
              letterSpacing="wider"
              mb="1"
            >
              PROVABLY FAIR
            </Dialog.Title>
            <Text fontSize="2xs" color="gray.600" fontFamily="monospace" mb="4">
              {roundId === null
                ? 'THIS ROUND'
                : `ROUND ${roundId.slice(0, 8)}…`}
            </Text>

            {roundId === null ? (
              <LiveRound onClose={onClose} />
            ) : (
              <CrashedRound roundId={roundId} onClose={onClose} />
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
