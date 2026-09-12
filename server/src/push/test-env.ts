// Minimal env so `env.ts` doesn't exit the test process. Imported first.
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY ??= 'x';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'x';
process.env.SUPABASE_JWT_SECRET ??= 'x';
process.env.GEMINI_API_KEY ??= 'x';
