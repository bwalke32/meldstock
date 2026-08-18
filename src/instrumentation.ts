// @polsia:framework-owned — DO NOT EDIT. Next.js server-startup hook.
//
// Next calls register() ONCE when the server process boots. An operator must apply
// committed migrations before starting the app. The optional demo seed runs only
// after explicit ENABLE_DEMO_SEED=1. Put seed logic in src/lib/seed.ts (user-owned)
// — this file only owns the
// correctness envelope the agent must not get wrong:
//   - Node-runtime guard: register() ALSO fires for the edge runtime, where Prisma
//     cannot run, so we return early there and never pull server-only code into an
//     edge bundle.
//   - fail-open: a throwing seed is logged and swallowed, never re-thrown, so a bad
//     seed can never stop the server from booting (a failure in the `start` chain
//     would). Seed failures degrade gracefully.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.ENABLE_DEMO_SEED !== '1') return;

  try {
    const { seed } = await import('@/lib/seed');
    await seed();
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: startup diagnostics — the seed failed but the server still boots.
    console.error('[meldstock] opt-in demo seed failed:', error);
  }
}
