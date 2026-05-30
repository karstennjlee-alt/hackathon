// Beacon5 app env loader — runs at JS module load (boot).
// Throws (instead of process.exit) so React Native shows a red-box with the message.
// Every error line points to a section of KEYS.md.
//
// Only EXPO_PUBLIC_* vars belong here. Anything else is a server secret —
// it goes in server/.env and is reached via EXPO_PUBLIC_API_BASE_URL.

import { z } from 'zod';

const AppEnvSchema = z.object({
  EXPO_PUBLIC_API_BASE_URL: z.string().url(),

  // Supabase (Postgres + Auth + Realtime + Storage) — KEYS.md §1
  EXPO_PUBLIC_SUPABASE_URL: z.string().url(),
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),

  // Google Maps Android — KEYS.md §9
  EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: z.string().optional(),

  // Sentry DSN — KEYS.md §10
  EXPO_PUBLIC_SENTRY_DSN: z.string().optional(),

  // Demo flag — DECISIONS.md D11
  EXPO_PUBLIC_DEMO: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const KEYS_MD_ANCHORS: Record<string, string> = {
  EXPO_PUBLIC_API_BASE_URL: 'README.md (root) — backend base URL',
  EXPO_PUBLIC_SUPABASE_URL: 'KEYS.md §1',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'KEYS.md §1',
  EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: 'KEYS.md §9',
  EXPO_PUBLIC_SENTRY_DSN: 'KEYS.md §10',
};

const parsed = AppEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const banner = '═'.repeat(60);
  const lines = [
    '',
    banner,
    '  Beacon5 app — environment invalid',
    banner,
    '',
  ];
  for (const e of parsed.error.errors) {
    const key = e.path.join('.');
    const ref = KEYS_MD_ANCHORS[key] ?? 'KEYS.md';
    lines.push(`  • ${key}: ${e.message}  →  see ${ref}`);
  }
  lines.push('');
  lines.push('  Fix app/.env, then re-bundle.');
  lines.push('  Template: app/.env.example');
  lines.push('');
  throw new Error(lines.join('\n'));
}

export const env = parsed.data;
export type AppEnv = typeof env;
