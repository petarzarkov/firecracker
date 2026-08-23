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
the trail, the players boarding and bailing out, the crash burst and the fireworks.

**Not here:** the multiplier readout, the countdown and the crash result. Those
are DOM in `apps/fe`, because they are read rather than watched — selectable,
accessible, and styled by the theme.

The axis labels went the other way, and that is the point of the split. They were
DOM nodes positioned against a hardcoded `REF_H = 360` while the gridlines were
drawn against the canvas's real height, so on a 652px chart the `1x` label sat
43px below its own line and `50x` sat 82px below. `scale.ts` is now the single
mapping both read.

## Size, and how much motion

Every sprite here declares a pixel size drawn against a desktop plot, and
`spriteZoom` is what makes that survive a phone: it maps the plot's **height** to a
factor between 0.5 and 1.2, and the four layers that draw artwork take it per frame.
Unscaled, the rocket was half the height of a 320px chart and sat across the
multiplier readout; on a 1180px tablet it was a speck.

The scene also reads `prefers-reduced-motion`, and keeps reading it. A crash's
screen-wide red wash and its 26-frame shake are gated by it; the fireball is not,
because it is the event rather than decoration around one. `detonation.ts` owns that
whole sequence and hands the caller a per-frame displacement rather than moving the
scene itself.

## The wait

The betting window is the longest stretch anybody looks at this chart, and for a
long time nothing happened in it: the rocket was `place()`d at the same point
every frame with a lit fuse on it, which is a still image.

It now hovers, and strains. `tensionAt` turns `waitingLeft` — how long the window
has left — into `0` at the top of it and `1` at the launch, and that one number
drives the bob flattening out, the lift, the rumble, the fuse swelling and the
sparks it starts throwing. The countdown's digits are DOM over the top; this is
what makes them mean something before they run out.

Players arriving are drawn on the rocket rather than only in a list beside it.
`takeBoardings` is an event queue like `takeCashOuts`, and one bet is a figure
launching from under the plot, arcing up, shrinking into the hull with a puff of
sparks — and the rocket lurching on a spring under the weight. `parachutes.ts` is
the same idea for how they leave.

Anyone still climbing when the round starts is simply aboard: a boarder eases
toward the rocket's _current_ position, so the rocket leaving the middle of the
plot for the curve's tip would drag them a third of the way across it on one
frame.

## The light under the curve

`textures.ts` paints it rather than `FillGradient` doing so, because the shape needs
to fade in **two** directions and a linear gradient has one. The fill closes with a
vertical drop from the tip to the axis; fading only downward left that closing edge
as a hard step - 34 against 24 of luminance in a single column, two hundred pixels
tall, a rocket's width from where every eye already is. `visual/screens/running.png`
is where it was finally visible, and `stage.visual.ts` measures the step now.

## The scale

`createScale` also fixes the ceiling. The old axis normalised against `log(50)`
and clamped, so every round past 50× drew as a line pressed to the roof — and the
history routinely carries 99×. The ceiling now climbs a ladder as the round does,
eases rather than snaps, and never drops back inside a round.

## Testing

`bun test` covers what can be checked without hardware: the scale's geometry, the
mote pool's recycling, the drawn path, the fuse's heat, the pre-launch tension and
the boarding arc. PIXI's scene objects construct fine
headlessly — only the renderer needs a GPU.

**The renderer itself is not covered.** `Application.init()` hangs without
resolving _or throwing_ on a machine with no usable GPU (reproduced with a
five-line PIXI page under ANGLE/SwiftShader), so it cannot be exercised in a
headless CI container. `createStage` races it against a timeout for that reason —
a rejection reaches the caller, where a silent hang would leave a black rectangle
and nothing in the console.
