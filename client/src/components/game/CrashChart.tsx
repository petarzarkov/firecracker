import { Box, Text } from '@chakra-ui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '@/store/gameStore';

const PAD = { top: 30, right: 20, bottom: 40, left: 55 };
const VW = 1000;
const VH = 380;
const CW = VW - PAD.left - PAD.right;
const CH = VH - PAD.top - PAD.bottom;

const GRID_MULTIPLIERS = [1, 1.5, 2, 3, 5, 10, 20, 50];
const LOG_MAX = Math.log(50);

function mToY(m: number): number {
  const normalized = Math.min(Math.log(Math.max(1.001, m)) / LOG_MAX, 1);
  return PAD.top + CH * (1 - normalized);
}

function eToX(elapsed: number, maxElapsed: number): number {
  return PAD.left + (elapsed / Math.max(maxElapsed, 1)) * CW;
}

function CountdownDisplay() {
  const waitingEndsAt = useGameStore(state => state.waitingEndsAt);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!waitingEndsAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((waitingEndsAt.getTime() - Date.now()) / 1000),
      );
      setSecs(remaining);
    }, 100);
    return () => clearInterval(interval);
  }, [waitingEndsAt]);

  return (
    <Text fontSize="2xl" color="gray.400" fontWeight="semibold">
      {secs > 0 ? `Starting in ${secs}s` : 'Starting...'}
    </Text>
  );
}

export function CrashChart() {
  const { phase, multiplier, chartPoints } = useGameStore();
  const animRef = useRef(0);
  const [, forceUpdate] = useState(0);

  // Animate multiplier glow during RUNNING
  useEffect(() => {
    if (phase !== 'RUNNING') {
      cancelAnimationFrame(animRef.current);
      return;
    }
    const tick = () => {
      forceUpdate(n => n + 1);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase]);

  const { pathD, fillD, lastX, lastY, maxElapsed } = useMemo(() => {
    if (chartPoints.length < 2) {
      return {
        pathD: '',
        fillD: '',
        lastX: PAD.left,
        lastY: PAD.top + CH,
        maxElapsed: 1,
      };
    }

    const max = chartPoints[chartPoints.length - 1].elapsed;
    let path = '';
    for (let i = 0; i < chartPoints.length; i++) {
      const pt = chartPoints[i];
      const x = eToX(pt.elapsed, max);
      const y = mToY(pt.multiplier);
      path += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
    }

    const lp = chartPoints[chartPoints.length - 1];
    const lx = eToX(lp.elapsed, max);
    const ly = mToY(lp.multiplier);
    const fill = `${path}L${lx.toFixed(1)},${(PAD.top + CH).toFixed(1)} L${PAD.left},${(PAD.top + CH).toFixed(1)} Z`;

    return { pathD: path, fillD: fill, lastX: lx, lastY: ly, maxElapsed: max };
  }, [chartPoints]);

  const color = phase === 'CRASHED' ? '#ff4444' : '#4CAF50';
  const hasCurve = chartPoints.length >= 2;

  return (
    <Box
      position="relative"
      flex={1}
      minH="280px"
      borderRadius="lg"
      overflow="hidden"
      bg="#0a0a0a"
      border="1px solid"
      borderColor="gray.700"
    >
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block' }}
        aria-label="Crash multiplier chart"
        role="img"
      >
        <title>Crash multiplier chart</title>
        {/* Grid lines */}
        {GRID_MULTIPLIERS.map(m => {
          const y = mToY(m);
          if (y > PAD.top + CH || y < PAD.top) return null;
          return (
            <g key={m}>
              <line
                x1={PAD.left}
                y1={y}
                x2={VW - PAD.right}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 6}
                y={y + 4}
                fill="rgba(255,255,255,0.35)"
                fontSize="14"
                textAnchor="end"
                fontFamily="monospace"
              >
                {m}x
              </text>
            </g>
          );
        })}

        {/* Axes */}
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + CH}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1"
        />
        <line
          x1={PAD.left}
          y1={PAD.top + CH}
          x2={VW - PAD.right}
          y2={PAD.top + CH}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1"
        />

        {/* Fill */}
        {hasCurve && (
          <defs>
            <linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={color}
                stopOpacity={phase === 'CRASHED' ? 0.2 : 0.25}
              />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
        )}
        {hasCurve && <path d={fillD} fill="url(#fillGrad)" />}

        {/* Curve */}
        {hasCurve && (
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* End dot */}
        {hasCurve && (
          <>
            <circle cx={lastX} cy={lastY} r="7" fill={color} opacity="0.3" />
            <circle cx={lastX} cy={lastY} r="4" fill={color} />
          </>
        )}

        {/* Time axis labels */}
        {maxElapsed > 0 &&
          [0.25, 0.5, 0.75, 1].map(frac => {
            const t = maxElapsed * frac;
            const x = eToX(t, maxElapsed);
            return (
              <text
                key={frac}
                x={x}
                y={PAD.top + CH + 20}
                fill="rgba(255,255,255,0.25)"
                fontSize="12"
                textAnchor="middle"
                fontFamily="monospace"
              >
                {(t / 1000).toFixed(1)}s
              </text>
            );
          })}
      </svg>

      {/* Multiplier overlay */}
      <Box
        position="absolute"
        top="50%"
        left="50%"
        transform="translate(-50%, -50%)"
        textAlign="center"
        pointerEvents="none"
        userSelect="none"
      >
        {phase === 'IDLE' && (
          <Text fontSize="3xl" color="gray.600" fontWeight="bold">
            Loading...
          </Text>
        )}
        {phase === 'WAITING' && <CountdownDisplay />}
        {phase === 'RUNNING' && (
          <Text
            fontSize="7xl"
            fontWeight="black"
            color="green.400"
            lineHeight="1"
            style={{
              textShadow: `0 0 30px #4CAF50, 0 0 60px #4CAF5088`,
              letterSpacing: '-2px',
            }}
          >
            {multiplier.toFixed(2)}x
          </Text>
        )}
        {phase === 'CRASHED' && (
          <Box>
            <Text
              fontSize="xl"
              color="red.400"
              fontWeight="bold"
              letterSpacing="widest"
            >
              CRASHED AT
            </Text>
            <Text
              fontSize="6xl"
              fontWeight="black"
              color="red.300"
              lineHeight="1"
              style={{ textShadow: '0 0 30px #ff4444' }}
            >
              {multiplier.toFixed(2)}x
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
