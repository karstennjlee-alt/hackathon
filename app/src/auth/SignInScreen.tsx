// @ts-nocheck — React Native 0.81 + React 19 type-def drift on built-in
// class components. Runtime fine. Remove once RN ships React-19 defs.
//
// SignInScreen — matches the v1 dark glassmorphic aesthetic.
// Black background, BlurView panels, red emergency accent, amber outline.

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
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { ShieldAlert, Mail } from 'lucide-react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { sendEmailMagicLink, signInWithApple, signInWithGoogle, SignInError } from './signIn';

function GoogleLogo({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

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
    <View style={styles.root}>
      {/* Ambient red glow at the top — matches the threat-button aesthetic */}
      <LinearGradient
        colors={['rgba(239,68,68,0.18)', 'rgba(10,10,11,0)']}
        style={styles.ambient}
        pointerEvents="none"
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <ShieldAlert size={22} color="#ef4444" strokeWidth={2.5} />
            <Text style={styles.brand}>BEACON5</Text>
          </View>
          <Text style={styles.title}>Sign in</Text>
          {campusName ? <Text style={styles.subtitle}>{campusName}</Text> : (
            <Text style={styles.subtitle}>Campus safety, coordinated.</Text>
          )}
        </View>

        <BlurView intensity={28} tint="dark" style={styles.panel}>
          <View style={styles.panelInner}>
            {Platform.OS === 'ios' ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={14}
                style={styles.appleBtn}
                onPress={() => void run('apple')}
              />
            ) : null}
            <ProviderButton
              label="Sign in with Google"
              icon={<GoogleLogo size={20} />}
              onPress={() => void run('google')}
              disabled={busy}
              busy={busyProvider === 'google'}
              accessibilityLabel="Sign in with Google"
              variant="dark"
            />

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.emailRow}>
              <Mail size={18} color="#7d7d83" strokeWidth={2.5} style={styles.emailIcon} />
              <TextInput
                style={styles.email}
                placeholder="you@school.org"
                placeholderTextColor="#7d7d83"
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
            </View>
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
                ✓  Link sent to {status.email}. Open it on this device.
              </Text>
            ) : null}
            {status.kind === 'error' ? (
              <Text style={styles.error} accessibilityRole="alert">
                {status.message}
              </Text>
            ) : null}
          </View>
        </BlurView>

        <Text style={styles.footnote}>
          Beacon5 supports — never replaces — 911 and your school's crisis plan.
        </Text>
      </KeyboardAvoidingView>
    </View>
  );
}

function ProviderButton({
  label,
  icon,
  onPress,
  disabled,
  busy,
  accessibilityLabel,
  variant,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel: string;
  variant: 'primary' | 'dark' | 'white';
}): React.JSX.Element {
  const v =
    variant === 'white'
      ? { bg: '#f4f4f5', fg: '#0a0a0b', border: '#f4f4f5' }
      : variant === 'dark'
      ? { bg: '#18181b', fg: '#f4f4f5', border: 'rgba(255,255,255,0.14)' }
      : { bg: '#ef4444', fg: '#fff', border: '#ef4444' };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
        variant === 'primary' && styles.primaryGlow,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <View style={styles.buttonIcon}>{icon}</View> : null}
          <Text style={[styles.buttonLabel, { color: v.fg }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0b',
  },
  flex: { flex: 1 },
  ambient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 280,
  },
  header: {
    paddingTop: 96,
    paddingHorizontal: 28,
    paddingBottom: 28,
    gap: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brand: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
  },
  title: {
    color: '#f4f4f5',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '500',
  },
  panel: {
    marginHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(76,69,70,0.54)',
    overflow: 'hidden',
    backgroundColor: 'rgba(20,20,22,0.6)',
  },
  panelInner: {
    padding: 20,
    gap: 12,
  },
  button: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleBtn: {
    height: 48,
    width: '100%',
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  buttonIcon: { marginRight: 0 },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  primaryGlow: {
    shadowColor: '#ef4444',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 2,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  dividerText: {
    color: '#7d7d83',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(20,20,22,0.6)',
    paddingHorizontal: 14,
  },
  emailIcon: { marginRight: 10 },
  email: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    color: '#f4f4f5',
    fontWeight: '500',
  },
  notice: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  error: {
    color: '#fb7185',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  footnote: {
    marginTop: 'auto',
    marginBottom: 24,
    color: '#7d7d83',
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 16,
  },
});
