// AuthContext — wraps Supabase session state and exposes it to the tree.
// Stays current via supabase.auth.onAuthStateChange. After sign-in, calls
// POST /v1/auth/session to mint the campusId/role claims server-side, then
// forces a JWT refresh so the new claims are visible to RLS.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User as SupaUser } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { env } from '../env';

type Role = 'student' | 'parent' | 'staff' | 'admin';

export interface BeaconSession {
  uid: string;
  campusId: string | null;
  role: Role | null;
  displayName: string | null;
  isMinor: boolean;
  linkedStudents?: string[];
}

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  user: SupaUser | null;
  beacon: BeaconSession | null;
  refresh: () => Promise<void>;
  demoMode: boolean;
  enterDemo: () => void;
  exitDemo: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchBeaconSession(jwt: string): Promise<BeaconSession | null> {
  const res = await fetch(`${env.EXPO_PUBLIC_API_BASE_URL}/v1/auth/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 404) {
    // NEEDS_JOIN — user authed but no campus membership yet.
    const text = await res.text().catch(() => '');
    return {
      uid: '',
      campusId: null,
      role: null,
      displayName: null,
      isMinor: false,
      ...(text ? {} : {}),
    };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/v1/auth/session ${res.status}: ${text}`);
  }
  const body = (await res.json()) as {
    uid: string;
    campusId: string;
    role: Role;
    displayName: string;
    isMinor: boolean;
    linkedStudents?: string[];
  };
  return body;
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [beacon, setBeacon] = useState<BeaconSession | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  async function applySession(s: Session | null): Promise<void> {
    setSession(s);
    if (!s?.access_token) {
      setBeacon(null);
      return;
    }
    try {
      const b = await fetchBeaconSession(s.access_token);
      setBeacon(b);
      // Refresh the local JWT so the new app_metadata claims are picked up.
      if (b?.campusId) await supabase.auth.refreshSession();
    } catch (err) {
      // Log but don't blow up the tree — the SignInScreen will show "needs join" state.
      console.warn('[auth] fetchBeaconSession failed:', err);
      setBeacon(null);
    }
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) {
        await applySession(data.session);
        setLoading(false);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      void applySession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = useMemo(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      beacon,
      refresh: async () => {
        const { data } = await supabase.auth.getSession();
        await applySession(data.session);
      },
      demoMode,
      enterDemo: () => setDemoMode(true),
      exitDemo: () => setDemoMode(false),
    }),
    [loading, session, beacon, demoMode],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
