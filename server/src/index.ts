// Beacon5 server entry point.
// Phase 0 step 0: this just validates env and prints a ready message.
// Phase 0 step 4 wires up the HTTP API (Cloud Functions or Express).

import { env } from './env';

process.stdout.write(
  `\nBeacon5 server — env loaded\n` +
    `  NODE_ENV=${env.NODE_ENV}\n` +
    `  PORT=${env.PORT}\n` +
    `  FIREBASE_PROJECT_ID=${env.FIREBASE_PROJECT_ID}\n` +
    `  GEMINI_MODEL=${env.GEMINI_MODEL}\n` +
    `  (API not wired yet — Phase 0 step 4)\n\n`,
);
