// AuthContext — wraps Supabase session state and exposes it to the tree.
// Stays current via supabase.auth.onAuthStateChange. After sign-in, calls
// POST /v1/auth/session to mint the campusId/role claims server-side, then
// forces a JWT refresh so the new claims are visible to RLS.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Linking } from 'react-native';
import type { Session, User as SupaUser } from '@supabase/supabase-js';
import { handleAuthUrl } from './signIn';
import { supabase } from '../supabase';
import { env } from '../env';
import { startRealtimeSync, stopRealtimeSync } from '../data/realtime';
import { resetEventStoreForSignOut, setStorageScope } from '../data/events';
import { registerForPush } from '../push';

type Role = 'student' | 'parent' | 'staff' | 'admin';

export interface BeaconSession {
  uid: string;
  campusId: string | null;
  campusName: string | null;
  campusCode: string | null;
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
  // Demo mode is only reachable when EXPO_PUBLIC_DEMO=true (DECISIONS D11).
  demoAvailable: boolean;
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
      campusName: null,
      campusCode: null,
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
    campusName: string;
    campusCode: string;
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
      // Sign-out path: tear down realtime + wipe in-memory event store
      // so the next user doesn't see the previous one's data. Also
      // flip the AsyncStorage bucket back to the shared demo key so
      // demo mode cross-profile flow keeps working.
      void stopRealtimeSync();
      resetEventStoreForSignOut();
      setStorageScope(null);
      return;
    }
    try {
      const b = await fetchBeaconSession(s.access_token);
      setBeacon(b);
      // Per-user AsyncStorage bucket. If the user has a real campus we
      // key by uid so two people sharing the phone don't see each other's
      // events; if they're still pre-join, scope by auth sub so even the
      // half-finished session doesn't leak into the demo bucket.
      const scope = b?.uid || s.user?.id || null;
      setStorageScope(scope);
      if (b?.campusId) {
        // Refresh the local JWT only if it doesn't already carry the campus
        // claim. Refreshing unconditionally re-enters this function through
        // the TOKEN_REFRESHED event and loops until Supabase's refresh-token
        // reuse detection signs the user out.
        const claims = (s.user?.app_metadata ?? {}) as { campus_id?: string };
        if (claims.campus_id !== b.campusId) {
          await supabase.auth.refreshSession();
        }
        void startRealtimeSync(b.campusId);
        void registerForPush();
      } else {
        void stopRealtimeSync();
      }
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
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // A token refresh doesn't change membership — just keep the session
      // object current. Re-running the membership fetch here would refresh
      // again and loop.
      if (event === 'TOKEN_REFRESHED') {
        setSession(s);
        return;
      }
      void applySession(s);
    });
    // Magic links / OAuth redirects delivered by the OS. The session they
    // establish flows through onAuthStateChange like any other sign-in.
    const onUrl = ({ url }: { url: string }) => {
      handleAuthUrl(url).catch((err) => console.warn('[auth] link failed:', err));
    };
    const linkSub = Linking.addEventListener('url', onUrl);
    void Linking.getInitialURL().then((url) => {
      if (url) onUrl({ url });
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      linkSub.remove();
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
      demoAvailable: env.EXPO_PUBLIC_DEMO,
      demoMode,
      enterDemo: () => {
        if (env.EXPO_PUBLIC_DEMO) setDemoMode(true);
      },
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
