# @firecracker/stage

The crash round, rendered. PIXI 8, no React, no Chakra, no store.

## The shape

The stage is handed a canvas and a **sampler** — a function answering "what is
true right now" — and draws that until it is destroyed.

```ts
const stage = await createStage({
  canvas,
  sample: () => ({ phase: 'running', multiplier: 2.41, points }),
  rocketUrl: '/png/rocket.png',
});
stage.destroy();
```

The sampler is why this package has no dependency on the client. It also keeps
the contract the canvas version got right: ticks mutate a plain ref that the
sampler reads, so a running round never re-renders React.

## What lives here, and what does not

**Here:** the grid and its labels, the curve, the starfield, the rocket, the wick,
the trail, the crash burst and the fireworks.

**Not here:** the multiplier readout, the countdown and the crash result. Those
are DOM in `apps/fe`, because they are read rather than watched — selectable,
accessible, and styled by the theme.

The axis labels went the other way, and that is the point of the split. They were
DOM nodes positioned against a hardcoded `REF_H = 360` while the gridlines were
drawn against the canvas's real height, so on a 652px chart the `1x` label sat
43px below its own line and `50x` sat 82px below. `scale.ts` is now the single
mapping both read.

## The scale

`createScale` also fixes the ceiling. The old axis normalised against `log(50)`
and clamped, so every round past 50× drew as a line pressed to the roof — and the
history routinely carries 99×. The ceiling now climbs a ladder as the round does,
eases rather than snaps, and never drops back inside a round.

## Testing

`bun test` covers the two things that can be checked without hardware: the scale's
geometry and the mote pool's recycling. PIXI's scene objects construct fine
headlessly — only the renderer needs a GPU.

**The renderer itself is not covered.** `Application.init()` hangs without
resolving *or throwing* on a machine with no usable GPU (reproduced with a
five-line PIXI page under ANGLE/SwiftShader), so it cannot be exercised in a
headless CI container. `createStage` races it against a timeout for that reason —
a rejection reaches the caller, where a silent hang would leave a black rectangle
and nothing in the console.
