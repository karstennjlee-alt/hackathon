// Display-name cache for the campus roster. Used by the realtime
// transformers to fill BeaconEvent.studentName / .senderName from
// Supabase rows that only carry the auth UUID.
//
// Hydrate once on campus entry, then lazy-fill on misses. Cache lives
// for the lifetime of the JS instance — sign-out clears it.

import { supabase } from '../supabase';

let cache = new Map<string, string>();

export async function hydrateCampusRoster(campusId: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, display_name')
      .eq('campus_id', campusId);
    if (error || !data) return;
    for (const row of data) {
      if (typeof row.id === 'string' && typeof row.display_name === 'string') {
        cache.set(row.id, row.display_name);
      }
    }
  } catch {
    // best effort — names will lazy-fill on miss
  }
}

export function getCachedName(userId: string): string | null {
  return cache.get(userId) ?? null;
}

export async function lookupUserName(userId: string): Promise<string> {
  const cached = cache.get(userId);
  if (cached) return cached;
  try {
    const { data } = await supabase
      .from('users')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();
    const name = typeof data?.display_name === 'string' ? data.display_name : '';
    if (name) {
      cache.set(userId, name);
      return name;
    }
  } catch {
    // ignored
  }
  // Last-resort fallback — never block render on a missing name.
  return 'Campus member';
}

export function clearUserCache(): void {
  cache = new Map();
}
