/**
 * `bun run dev` - the web process **and** the worker, together.
 *
 * ## Why this script exists
 *
 * This is a two-process application: the web process owns the clock and the
 * sockets, and the worker owns every round transition. Running only the first one
 * gets you an app that boots, serves, authenticates, accepts a socket - and then
 * sits on `Starting...` forever, because the round it scheduled is a BullMQ job
 * with nobody to consume it.
 *
 * That is a miserable first five minutes, and it is exactly what `bun dev` used to
 * do. The worker was a second terminal you had to know about. Nothing about a
 * frozen countdown points at it.
 *
 * Production keeps the two separate - see docker-compose.prod.yml, where they are
 * one image with different commands - because there they scale and restart
 * independently. In development they always want to be up together, so `dev` runs
 * both and `bun run worker` still runs one alone.
 */
const processes = [
  { name: 'web', entry: 'src/main.ts', colour: '\x1b[36m' },
  { name: 'worker', entry: 'src/worker.ts', colour: '\x1b[35m' },
] as const;

const RESET = '\x1b[0m';

const children = processes.map(({ name, entry, colour }) => {
  const child = Bun.spawn(['bun', '--watch', entry], {
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });

  /** Prefix every line so two processes' logs stay tellable apart. */
  const label = `${colour}[${name}]${RESET}`;
  const pipe = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    for await (const chunk of stream) {
      const text = new TextDecoder().decode(chunk);
      for (const line of text.split('\n')) {
        if (line.length > 0) console.log(`${label} ${line}`);
      }
    }
  };

  void pipe(child.stdout);
  void pipe(child.stderr);

  return { name, child };
});

/**
 * Either one dying takes the pair down. A half-running pair is the state this
 * script exists to prevent, and leaving the survivor behind would also hold the
 * port and the SQLite file against the next `bun dev`.
 */
const shutdown = (): void => {
  for (const { child } of children) child.kill();
};

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

const [{ name, child }] = await Promise.race(
  children.map(async (entry) => {
    await entry.child.exited;
    return [entry] as const;
  }),
);

console.error(`\n${name} exited with ${child.exitCode}. Stopping the other.`);
shutdown();
process.exit(child.exitCode ?? 1);
