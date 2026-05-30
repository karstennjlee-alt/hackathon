// Sign-in helpers for the three providers Beacon5 v2 supports.
//
// Apple — uses expo-apple-authentication (native iOS dialog) and exchanges the
//         Apple identity token for a Supabase session via signInWithIdToken.
//         iOS-only at the native level; on Android we fall back to OAuth web flow.
// Google — uses Supabase's OAuth redirect via expo-web-browser. Supabase brokers
//          the Google handshake on the dashboard side, so no Google SDK on the
//          device.
// Email — magic link. Supabase emails a one-time link; the user taps it on the
//         device to complete sign-in.

import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { Platform } from 'react-native';
import { supabase } from '../supabase';

WebBrowser.maybeCompleteAuthSession();

// Match the scheme in app.json (currently "exp" by default for Expo Go).
// For a real EAS build this becomes "beacon5://" — wire it in step 7.
const redirectTo = AuthSession.makeRedirectUri({
  scheme: undefined, // let Expo pick exp+xxx during Go; the EAS build sets scheme via app.json
  path: 'auth-callback',
});

export class SignInError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// ──────────────────────────────────────────────────────────────────
// Sign in with Apple
// ──────────────────────────────────────────────────────────────────
export async function signInWithApple(): Promise<void> {
  if (Platform.OS !== 'ios') {
    // Android: fall back to OAuth web flow brokered by Supabase.
    await signInWithOAuth('apple');
    return;
  }
  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    throw new SignInError('APPLE_UNAVAILABLE', 'Sign in with Apple is not available on this device');
  }
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new SignInError('APPLE_NO_TOKEN', 'Apple did not return an identity token');
    }
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error) throw new SignInError('SUPABASE_APPLE_REJECT', error.message);
  } catch (err) {
    if (err instanceof SignInError) throw err;
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ERR_REQUEST_CANCELED') {
      throw new SignInError('CANCELED', 'sign-in canceled');
    }
    throw new SignInError('APPLE_ERROR', err instanceof Error ? err.message : String(err));
  }
}

// ──────────────────────────────────────────────────────────────────
// Sign in with Google (or Apple on Android) — Supabase OAuth flow
// ──────────────────────────────────────────────────────────────────
export async function signInWithGoogle(): Promise<void> {
  await signInWithOAuth('google');
}

async function signInWithOAuth(provider: 'google' | 'apple'): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw new SignInError('OAUTH_INIT', error.message);
  if (!data?.url) throw new SignInError('OAUTH_NO_URL', 'no OAuth URL returned');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success' || !result.url) {
    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new SignInError('CANCELED', 'sign-in canceled');
    }
    throw new SignInError('OAUTH_FAILED', `OAuth result: ${result.type}`);
  }

  // Parse code+state out of the redirect URL and complete the exchange.
  const url = new URL(result.url);
  const code = url.searchParams.get('code');
  if (!code) throw new SignInError('OAUTH_NO_CODE', 'no authorization code in redirect');
  const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchErr) throw new SignInError('OAUTH_EXCHANGE', exchErr.message);
}

// ──────────────────────────────────────────────────────────────────
// Sign in with Email — magic link
// ──────────────────────────────────────────────────────────────────
export async function sendEmailMagicLink(email: string): Promise<void> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) {
    throw new SignInError('EMAIL_INVALID', 'enter a valid email');
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw new SignInError('EMAIL_SEND', error.message);
}

// ──────────────────────────────────────────────────────────────────
// Sign out
// ──────────────────────────────────────────────────────────────────
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
