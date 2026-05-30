// Supabase client factories.
//   admin  — uses SERVICE_ROLE_KEY. Bypasses RLS. Used by the server for
//            authoritative writes + custom claims updates. NEVER ship.
//   asUser — given a user's JWT, returns a client that operates as that user,
//            so RLS enforces all reads (defense in depth on top of explicit
//            permission gates).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

export const admin: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  global: {
    headers: { 'X-Client-Info': 'beacon5-server-admin' },
  },
});

export function asUser(jwt: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'X-Client-Info': 'beacon5-server-asuser',
      },
    },
  });
}
