// Beacon5 server env loader — runs at process boot.
// Throws (and exits) with a clear, actionable message if any required var is missing.
// Every error line points to a section of KEYS.md.

import { z } from 'zod';

const ServerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    // Supabase — KEYS.md §1
    SUPABASE_URL: z.string().url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_JWT_SECRET: z.string().min(1),
    SUPABASE_DB_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),

    // Gemini (server-only) — KEYS.md §2
    GEMINI_API_KEY: z.string().min(1),
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

    // Google Geocoding (server-only) — KEYS.md §3
    GOOGLE_GEOCODING_API_KEY: z.string().optional(),

    // Sign in with Apple — KEYS.md §4 (Supabase brokers; kept for reference)
    APPLE_TEAM_ID: z.string().optional(),
    APPLE_SERVICES_ID: z.string().optional(),
    APPLE_KEY_ID: z.string().optional(),
    APPLE_PRIVATE_KEY_PATH: z.string().optional(),

    // Google OAuth (Supabase brokers) — KEYS.md §5
    GOOGLE_OAUTH_WEB_CLIENT_ID: z.string().optional(),

    // APNs — KEYS.md §6
    APNS_KEY_ID: z.string().optional(),
    APNS_TEAM_ID: z.string().optional(),
    APNS_PRIVATE_KEY_PATH: z.string().optional(),
    APNS_BUNDLE_ID: z.string().optional(),
    APNS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),

    // FCM (Android Push) — KEYS.md §7
    FCM_SERVICE_ACCOUNT_PATH: z.string().optional(),
    FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),

    // Expo Push — KEYS.md §8
    EXPO_ACCESS_TOKEN: z.string().optional(),
    EAS_PROJECT_ID: z.string().optional(),

    // Sentry — KEYS.md §10
    SENTRY_DSN: z.string().optional(),

    // KMS — KEYS.md §11
    KMS_PROVIDER: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.enum(['gcp', 'aws', 'azure']).optional(),
    ),
    KMS_KEY_RESOURCE: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.KMS_PROVIDER || !env.KMS_KEY_RESOURCE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'KMS_PROVIDER and KMS_KEY_RESOURCE are required in production',
          path: ['KMS_PROVIDER'],
        });
      }
    }
  });

const KEYS_MD_ANCHORS: Record<string, string> = {
  SUPABASE_URL: 'KEYS.md §1',
  SUPABASE_PUBLISHABLE_KEY: 'KEYS.md §1',
  SUPABASE_SERVICE_ROLE_KEY: 'KEYS.md §1',
  SUPABASE_JWT_SECRET: 'KEYS.md §1',
  SUPABASE_DB_URL: 'KEYS.md §1',
  GEMINI_API_KEY: 'KEYS.md §2',
  GEMINI_MODEL: 'KEYS.md §2',
  GOOGLE_GEOCODING_API_KEY: 'KEYS.md §3',
  APPLE_TEAM_ID: 'KEYS.md §4',
  APPLE_SERVICES_ID: 'KEYS.md §4',
  APPLE_KEY_ID: 'KEYS.md §4',
  APPLE_PRIVATE_KEY_PATH: 'KEYS.md §4',
  GOOGLE_OAUTH_WEB_CLIENT_ID: 'KEYS.md §5',
  APNS_KEY_ID: 'KEYS.md §6',
  APNS_TEAM_ID: 'KEYS.md §6',
  APNS_PRIVATE_KEY_PATH: 'KEYS.md §6',
  APNS_BUNDLE_ID: 'KEYS.md §6',
  FCM_SERVICE_ACCOUNT_PATH: 'KEYS.md §7',
  FCM_SERVICE_ACCOUNT_JSON: 'KEYS.md §7',
  EXPO_ACCESS_TOKEN: 'KEYS.md §8',
  EAS_PROJECT_ID: 'KEYS.md §8',
  SENTRY_DSN: 'KEYS.md §10',
  KMS_PROVIDER: 'KEYS.md §11',
  KMS_KEY_RESOURCE: 'KEYS.md §11',
};

function failLoud(errors: { path: string; message: string }[]): never {
  const banner = '═'.repeat(72);
  const lines = [
    '',
    banner,
    '  Beacon5 server failed to start — environment is invalid',
    banner,
    '',
  ];
  for (const e of errors) {
    const ref = KEYS_MD_ANCHORS[e.path] ?? 'KEYS.md';
    lines.push(`  • ${e.path}: ${e.message}  →  see ${ref}`);
  }
  lines.push('');
  lines.push('  Fix server/.env and try again.');
  lines.push('  Template: server/.env.example');
  lines.push('');
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(1);
}

const parsed = ServerEnvSchema.safeParse(process.env);
if (!parsed.success) {
  failLoud(
    parsed.error.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    })),
  );
}

export const env = parsed.data;
export type ServerEnv = typeof env;
