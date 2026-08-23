# Visual tests

Chromium, driven by Playwright, from `bun test`. Two suites, and the difference
between them is what they need running.

```bash
bun run visual        # the stage. Needs nothing.
bun run visual:app    # the client. Needs `docker compose up -d` and `bun dev`.
```

Both write PNGs to `visual/screens/`, gitignored, and print each path as they go.
**The pictures are the point**: an assertion can say the middle of the plot got
brighter, and only a person or a model looking at the frame can say the rocket was
hidden behind the countdown.

## Why two suites

`bun run visual` drives `@firecracker/stage` through a harness page — the client's
`CrashChart` with React, the store and the socket removed. That is possible because
`createStage` takes a **sampler**, so a test can be the thing answering "what is
true right now". No API, no Redis, no round anybody else is having: `harness.ts`
bundles `stage.entry.ts` with `Bun.build` and serves it, and the whole suite is
about twenty seconds.

`bun run visual:app` is the other half — React, Chakra, the store, the socket and a
real round — and it needs the stack up. It signs in through the lobby's own **Try
Demo** button, because the client shows a login screen to anyone else and a spec
that only loaded the page would be asserting about a form.

## Determinism

The stage suite freezes the page's clock and seeds `Math.random` before any script
runs (`clock.ts`). A frame happens only when a test asks for one, and each is
exactly 1/60s — so `advance(90)` is the same ninety frames on every run and on
every machine. Without it, "wait 500ms and screenshot" catches a different frame
each time and no two screenshots of the same moment match.

The app suite runs on the real clock. Its animations are the app's own, and
freezing them would stop the thing it is there to look at.

## Asserting on pixels

`harness.grid(cols, rows)` reads the drawing buffer back as a coarse grid of
average colours. That is what a spec can compare: a region got brighter, the
brightest cell is in the middle, the fireball is dimmer two seconds later.

It must be called **in the same `page.evaluate` as the frames it is reading** —
WebGL only guarantees the buffer's contents until the end of the task that drew
them, which is why `frameAfter` does both in one call and why the stage does not
pay for `preserveDrawingBuffer`.

SwiftShader logs a `GPU stall due to ReadPixels` warning every time, which is a
cost this rig chooses knowingly; `browser.ts` filters that one line and nothing
else. Every spec asserts the page logged no errors at all.

## The renderer

Playwright's Chromium falls back to SwiftShader with no flags and draws WebGL
correctly, just slowly. That matters beyond convenience: the stage's own README
records `Application.init()` hanging without resolving _or throwing_ on a machine
with no usable GPU, which is why `createStage` races it against a timeout. The
first test in `stage.visual.ts` is the standing check that it still starts.

## What this has already caught

None of it was findable in the arithmetic, and all of it shipped-looking-fine:

- The boarding figure was a dark smudge on a near-black plot.
- Four players boarding together drew as one clump under three overlapping labels
  — the ease put every one of them beside the hull for two thirds of the climb.
- The betting window's countdown printed straight over the rocket it was counting
  down for.
