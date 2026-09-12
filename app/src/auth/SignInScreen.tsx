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
import { ShieldAlert, Mail, KeyRound, GraduationCap, Users, Hash, School } from 'lucide-react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { sendEmailMagicLink, signInWithApple, signInWithGoogle, signInWithPassword, signInAsStudent, SignInError } from './signIn';

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

type Who = 'student' | 'adult';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; provider: 'apple' | 'google' | 'email' | 'student' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };

export function SignInScreen({ campusName }: { campusName?: string }): React.JSX.Element {
  // Students (minors, mostly no email) sign in with campus code + student
  // ID + PIN. Everyone else uses an identity provider or email.
  const [who, setWho] = useState<Who>('student');
  const [campusCode, setCampusCode] = useState('');
  const [studentId, setStudentId] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function studentSubmit(): Promise<void> {
    setStatus({ kind: 'busy', provider: 'student' });
    try {
      await signInAsStudent(campusCode, studentId, pin);
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'error', message: describeStudentError(err) });
    }
  }

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
      if (usePassword) {
        await signInWithPassword(email, password);
        setStatus({ kind: 'idle' });
        return;
      }
      await sendEmailMagicLink(email);
      setStatus({ kind: 'sent', email });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const busy = status.kind === 'busy';
  const busyProvider = status.kind === 'busy' ? status.provider : null;
  const studentReady = campusCode.replace(/[\s-]/g, '').length >= 3 && studentId.trim().length > 0 && /^\d{4,8}$/.test(pin);

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

        <View style={styles.segment} accessibilityRole="tablist">
          <SegmentButton
            icon={<GraduationCap size={16} color={who === 'student' ? '#0a0a0b' : '#a1a1aa'} strokeWidth={2.5} />}
            label="Student"
            active={who === 'student'}
            onPress={() => { setWho('student'); setStatus({ kind: 'idle' }); }}
          />
          <SegmentButton
            icon={<Users size={16} color={who === 'adult' ? '#0a0a0b' : '#a1a1aa'} strokeWidth={2.5} />}
            label="Staff & family"
            active={who === 'adult'}
            onPress={() => { setWho('adult'); setStatus({ kind: 'idle' }); }}
          />
        </View>

        {who === 'student' ? (
          <BlurView intensity={28} tint="dark" style={styles.panel}>
            <View style={styles.panelInner}>
              <Text style={styles.panelHint}>Use the campus code and PIN your school gave you.</Text>
              <View style={styles.emailRow}>
                <School size={18} color="#7d7d83" strokeWidth={2.5} style={styles.emailIcon} />
                <TextInput
                  style={[styles.email, styles.mono]}
                  placeholder="Campus code"
                  placeholderTextColor="#7d7d83"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  accessibilityLabel="Campus code"
                  value={campusCode}
                  onChangeText={(t) => setCampusCode(t.toUpperCase())}
                  editable={!busy}
                  returnKeyType="next"
                />
              </View>
              <View style={styles.emailRow}>
                <Hash size={18} color="#7d7d83" strokeWidth={2.5} style={styles.emailIcon} />
                <TextInput
                  style={styles.email}
                  placeholder="Student ID"
                  placeholderTextColor="#7d7d83"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  accessibilityLabel="Student ID"
                  value={studentId}
                  onChangeText={setStudentId}
                  editable={!busy}
                  returnKeyType="next"
                />
              </View>
              <View style={styles.emailRow}>
                <KeyRound size={18} color="#7d7d83" strokeWidth={2.5} style={styles.emailIcon} />
                <TextInput
                  style={[styles.email, styles.mono]}
                  placeholder="PIN"
                  placeholderTextColor="#7d7d83"
                  secureTextEntry
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={8}
                  accessibilityLabel="PIN"
                  value={pin}
                  onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
                  editable={!busy}
                  returnKeyType="go"
                  onSubmitEditing={() => { if (studentReady) void studentSubmit(); }}
                />
              </View>
              <ProviderButton
                label="Sign in"
                onPress={() => void studentSubmit()}
                disabled={busy || !studentReady}
                busy={busyProvider === 'student'}
                accessibilityLabel="Sign in as a student"
                variant="primary"
              />
              {status.kind === 'error' ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {status.message}
                </Text>
              ) : null}
              <Text style={styles.panelFoot}>Forgot your PIN? A teacher or the office can reset it.</Text>
            </View>
          </BlurView>
        ) : (
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
                  returnKeyType={usePassword ? 'next' : 'send'}
                  onSubmitEditing={() => (usePassword ? undefined : void emailSubmit())}
                />
              </View>
              {usePassword ? (
                <View style={styles.emailRow}>
                  <KeyRound size={18} color="#7d7d83" strokeWidth={2.5} style={styles.emailIcon} />
                  <TextInput
                    style={styles.email}
                    placeholder="Password"
                    placeholderTextColor="#7d7d83"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    accessibilityLabel="Password"
                    value={password}
                    onChangeText={setPassword}
                    editable={!busy}
                    returnKeyType="go"
                    onSubmitEditing={() => void emailSubmit()}
                  />
                </View>
              ) : null}
              <ProviderButton
                label={usePassword ? 'Sign in' : 'Send magic link'}
                onPress={() => void emailSubmit()}
                disabled={busy || !email.includes('@') || status.kind === 'sent' || (usePassword && !password)}
                busy={busyProvider === 'email'}
                accessibilityLabel={usePassword ? 'Sign in with email and password' : 'Send magic link to email'}
                variant="primary"
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setUsePassword((v) => !v);
                  setStatus({ kind: 'idle' });
                }}
                disabled={busy}
                style={({ pressed }) => ({ alignSelf: 'center', paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={styles.dividerText}>
                  {usePassword ? 'USE A MAGIC LINK INSTEAD' : 'USE A PASSWORD INSTEAD'}
                </Text>
              </Pressable>

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
        )}

        <Text style={styles.footnote}>
          Beacon5 supports — never replaces — 911 and your school's crisis plan.
        </Text>
      </KeyboardAvoidingView>
    </View>
  );
}

function SegmentButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.segmentBtn,
        active && styles.segmentBtnActive,
        { opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {icon}
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
    </Pressable>
  );
}

// Server error codes → kid-readable copy.
function describeStudentError(err: unknown): string {
  if (!(err instanceof SignInError)) return err instanceof Error ? err.message : 'Something went wrong';
  switch (err.code) {
    case 'STUDENT_LOGIN_FAILED':
    case 'STUDENT_LOCKED':
    case 'RATE_LIMITED':
    case 'VALIDATION':
      return err.message;
    case 'HTTP_0':
    case 'TypeError':
      return "Can't reach the Beacon5 server. Check your connection.";
    default:
      return `${err.message} (${err.code})`;
  }
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
  segment: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(76,69,70,0.54)',
    backgroundColor: 'rgba(20,20,22,0.6)',
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
  },
  segmentBtnActive: { backgroundColor: '#f4f4f5' },
  segmentLabel: { color: '#a1a1aa', fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  segmentLabelActive: { color: '#0a0a0b' },
  panelHint: { color: '#a1a1aa', fontSize: 13, lineHeight: 18, marginBottom: 2 },
  panelFoot: { color: '#7d7d83', fontSize: 12, lineHeight: 16, marginTop: 2 },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
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
