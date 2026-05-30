// @ts-nocheck — React Native 0.81 + React 19 type-def drift on built-in
// class components (View, Text, Modal, KeyboardAvoidingView, etc.). The
// component runs cleanly; only the strict typecheck flags it. See App.tsx
// for the same drift in the v1 monolith. Re-enable strict typing once RN
// ships React-19-compatible type defs.
// SignInScreen — Apple + Google + Email (magic link).
// Standalone component. Wired into App.tsx when the monolith splits (Phase 0 step 7).
//
// Design tokens follow DESIGN.md. Minimal, calm, panic-proof:
// - One BigButton per provider, ≥ 64pt tap target.
// - No labels by color alone; every state has text + icon + color.
// - Hold for the screen reader: every control labeled.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { sendEmailMagicLink, signInWithApple, signInWithGoogle, SignInError } from './signIn';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; provider: 'apple' | 'google' | 'email' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };

export function SignInScreen({ campusName }: { campusName?: string }): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function run(provider: 'apple' | 'google'): Promise<void> {
    setStatus({ kind: 'busy', provider });
    try {
      if (provider === 'apple') await signInWithApple();
      else await signInWithGoogle();
      setStatus({ kind: 'idle' });
    } catch (err) {
      if (err instanceof SignInError && err.code === 'CANCELED') {
        setStatus({ kind: 'idle' });
        return;
      }
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function emailSubmit(): Promise<void> {
    setStatus({ kind: 'busy', provider: 'email' });
    try {
      await sendEmailMagicLink(email);
      setStatus({ kind: 'sent', email });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const busy = status.kind === 'busy';
  const busyProvider = status.kind === 'busy' ? status.provider : null;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Sign in to Beacon5</Text>
        {campusName ? <Text style={styles.subtitle}>{campusName}</Text> : null}
      </View>

      <View style={styles.buttons}>
        {Platform.OS === 'ios' ? (
          <ProviderButton
            label="Continue with Apple"
            onPress={() => void run('apple')}
            disabled={busy}
            busy={busyProvider === 'apple'}
            accessibilityLabel="Continue with Apple"
            variant="dark"
          />
        ) : null}
        <ProviderButton
          label="Continue with Google"
          onPress={() => void run('google')}
          disabled={busy}
          busy={busyProvider === 'google'}
          accessibilityLabel="Continue with Google"
          variant="light"
        />

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextInput
          style={styles.email}
          placeholder="you@school.org"
          placeholderTextColor="#7B8794"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel="Email address"
          value={email}
          onChangeText={setEmail}
          editable={!busy && status.kind !== 'sent'}
          returnKeyType="send"
          onSubmitEditing={() => void emailSubmit()}
        />
        <ProviderButton
          label="Send magic link"
          onPress={() => void emailSubmit()}
          disabled={busy || !email.includes('@') || status.kind === 'sent'}
          busy={busyProvider === 'email'}
          accessibilityLabel="Send magic link to email"
          variant="primary"
        />

        {status.kind === 'sent' ? (
          <Text style={styles.notice} accessibilityRole="alert">
            ✓ Check {status.email} — tap the link to finish.
          </Text>
        ) : null}
        {status.kind === 'error' ? (
          <Text style={styles.error} accessibilityRole="alert">
            {status.message}
          </Text>
        ) : null}
      </View>

      <Text style={styles.footnote}>
        Beacon5 supports — never replaces — 911 and the school's crisis plan.
      </Text>
    </KeyboardAvoidingView>
  );
}

function ProviderButton({
  label,
  onPress,
  disabled,
  busy,
  accessibilityLabel,
  variant,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel: string;
  variant: 'primary' | 'dark' | 'light';
}): React.JSX.Element {
  const v =
    variant === 'dark'
      ? { bg: '#0B0F14', fg: '#FFFFFF', border: '#0B0F14' }
      : variant === 'light'
      ? { bg: '#FFFFFF', fg: '#0B0F14', border: '#E2E5EA' }
      : { bg: '#2563EB', fg: '#FFFFFF', border: '#2563EB' };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <Text style={[styles.buttonLabel, { color: v.fg }]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FAFAFC',
    paddingHorizontal: 24,
    paddingTop: 96,
    paddingBottom: 24,
  },
  header: { gap: 6, marginBottom: 36 },
  title: { fontSize: 28, fontWeight: '700', color: '#0B0F14' },
  subtitle: { fontSize: 16, color: '#6B7280' },
  buttons: { gap: 14 },
  button: {
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 17, fontWeight: '600', letterSpacing: 0.1 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#A6B0BD' },
  dividerText: { color: '#6B7280', fontSize: 12, fontWeight: '600' },
  email: {
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E5EA',
    paddingHorizontal: 16,
    fontSize: 17,
    color: '#0B0F14',
    backgroundColor: '#FFFFFF',
  },
  notice: { color: '#059669', fontSize: 14, marginTop: 4 },
  error: { color: '#DC2626', fontSize: 14, marginTop: 4 },
  footnote: {
    marginTop: 'auto',
    color: '#7B8794',
    fontSize: 12,
    textAlign: 'center',
  },
});
