// @ts-nocheck — same React 19 + RN 0.81 class-component type drift as SignInScreen.
//
// JoinCampusScreen — shown after sign-in when the account has no campus.
// Two paths:
//   1. Redeem a join code issued by the school (the normal path).
//   2. Create a new campus and become its first admin (self-serve, D1).
// Demo mode is offered only when EXPO_PUBLIC_DEMO=true.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { ShieldAlert, KeyRound, Building2, Play, LogOut, ChevronLeft } from 'lucide-react-native';
import { useAuth } from './AuthContext';
import { signOut } from './signIn';
import { redeemJoinCode, bootstrapCampus, describeJoinError } from './join';

type Step = 'choose' | 'code' | 'create';

export function JoinCampusScreen(): React.JSX.Element {
  const { session, refresh, demoAvailable, enterDemo } = useAuth();
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestedName = session?.user.user_metadata?.full_name ?? session?.user.user_metadata?.name ?? '';
  const [displayName, setDisplayName] = useState<string>(typeof suggestedName === 'string' ? suggestedName : '');
  const [code, setCode] = useState('');
  const [orgName, setOrgName] = useState('');
  const [campusName, setCampusName] = useState('');

  async function submitCode(): Promise<void> {
    if (busy) return;
    setError(null);
    if (!displayName.trim()) return setError('Enter your name so staff know who you are.');
    if (code.replace(/[\s-]/g, '').length < 4) return setError('Enter the join code from your school.');
    setBusy(true);
    try {
      await redeemJoinCode(code, displayName);
      await refresh();
    } catch (err) {
      setError(describeJoinError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate(): Promise<void> {
    if (busy) return;
    setError(null);
    if (!displayName.trim()) return setError('Enter your name.');
    if (!orgName.trim()) return setError('Enter the organization (district) name.');
    if (!campusName.trim()) return setError('Enter the campus name.');
    setBusy(true);
    try {
      await bootstrapCampus({ orgName, campusName, displayName });
      await refresh();
    } catch (err) {
      setError(describeJoinError(err));
    } finally {
      setBusy(false);
    }
  }

  function go(next: Step): void {
    setError(null);
    setStep(next);
  }

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['rgba(239,68,68,0.18)', 'rgba(10,10,11,0)']}
        style={styles.ambient}
        pointerEvents="none"
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <ShieldAlert size={22} color="#ef4444" strokeWidth={2.5} />
              <Text style={styles.brand}>BEACON5</Text>
            </View>
            <Text style={styles.title}>
              {step === 'choose' ? 'Join your campus' : step === 'code' ? 'Enter join code' : 'Create a campus'}
            </Text>
            <Text style={styles.subtitle}>{session?.user.email ?? 'Signed in'}</Text>
          </View>

          <BlurView intensity={28} tint="dark" style={styles.panel}>
            <View style={styles.panelInner}>
              {step === 'choose' ? (
                <>
                  <Text style={styles.panelBody}>
                    Your account isn’t linked to a campus yet. Use the code your school gave you, or set
                    up a new campus if you’re the first admin.
                  </Text>
                  <ChoiceButton
                    icon={<KeyRound size={20} color="#fff" strokeWidth={2.5} />}
                    label="I have a join code"
                    sub="from a teacher or admin"
                    primary
                    onPress={() => go('code')}
                  />
                  <ChoiceButton
                    icon={<Building2 size={20} color="#f4f4f5" strokeWidth={2.5} />}
                    label="Create a new campus"
                    sub="I’m setting Beacon5 up for my school"
                    onPress={() => go('create')}
                  />
                  {demoAvailable ? (
                    <ChoiceButton
                      icon={<Play size={18} color="#f4f4f5" strokeWidth={2.5} fill="#f4f4f5" />}
                      label="Enter demo mode"
                      sub="fake roster · local only"
                      onPress={enterDemo}
                    />
                  ) : null}
                </>
              ) : null}

              {step === 'code' ? (
                <>
                  <Field
                    label="Your name"
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="e.g. Jordan Reyes"
                    autoCapitalize="words"
                    textContentType="name"
                  />
                  <Field
                    label="Join code"
                    value={code}
                    onChangeText={(t) => setCode(t.toUpperCase())}
                    placeholder="ABCD-EF12"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    mono
                    onSubmitEditing={() => void submitCode()}
                  />
                  <SubmitButton label="Join campus" busy={busy} onPress={() => void submitCode()} />
                </>
              ) : null}

              {step === 'create' ? (
                <>
                  <Field
                    label="Your name"
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="e.g. R. Whitman"
                    autoCapitalize="words"
                    textContentType="name"
                  />
                  <Field
                    label="Organization / district"
                    value={orgName}
                    onChangeText={setOrgName}
                    placeholder="e.g. Belmont Unified"
                    autoCapitalize="words"
                  />
                  <Field
                    label="Campus name"
                    value={campusName}
                    onChangeText={setCampusName}
                    placeholder="e.g. Carlmont High School"
                    autoCapitalize="words"
                    onSubmitEditing={() => void submitCreate()}
                  />
                  <Text style={styles.hint}>You’ll become this campus’s first admin and can issue join codes.</Text>
                  <SubmitButton label="Create campus" busy={busy} onPress={() => void submitCreate()} />
                </>
              ) : null}

              {error ? (
                <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {error}
                </Text>
              ) : null}
            </View>
          </BlurView>

          <View style={styles.footerRow}>
            {step !== 'choose' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={() => go('choose')}
                disabled={busy}
                style={({ pressed }) => [styles.ghost, { opacity: pressed ? 0.7 : 1 }]}
              >
                <ChevronLeft size={14} color="#a1a1aa" strokeWidth={2.5} />
                <Text style={styles.ghostLabel}>Back</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              onPress={() => void signOut()}
              disabled={busy}
              style={({ pressed }) => [styles.ghost, { opacity: pressed ? 0.7 : 1 }]}
            >
              <LogOut size={14} color="#a1a1aa" strokeWidth={2.5} />
              <Text style={styles.ghostLabel}>Sign out</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function ChoiceButton({
  icon,
  label,
  sub,
  primary,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  primary?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        primary ? styles.choicePrimary : styles.choiceSecondary,
        { opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {icon}
      <View style={styles.choiceLabels}>
        <Text style={[styles.choiceLabel, !primary && { color: '#f4f4f5' }]}>{label}</Text>
        <Text style={[styles.choiceSub, !primary && { color: '#a1a1aa' }]}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function Field({
  label,
  mono,
  ...input
}: {
  label: string;
  mono?: boolean;
} & React.ComponentProps<typeof TextInput>): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor="#7d7d83"
        style={[styles.input, mono && styles.inputMono]}
      />
    </View>
  );
}

function SubmitButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.submit, { opacity: pressed || busy ? 0.85 : 1 }]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitLabel}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0b' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: 24 },
  ambient: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },
  header: { paddingTop: 96, paddingHorizontal: 28, paddingBottom: 28, gap: 10 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brand: { color: '#ef4444', fontSize: 12, fontWeight: '900', letterSpacing: 3 },
  title: { color: '#f4f4f5', fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: '#a1a1aa', fontSize: 14, fontWeight: '500' },
  panel: {
    marginHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(76,69,70,0.54)',
    overflow: 'hidden',
    backgroundColor: 'rgba(20,20,22,0.6)',
  },
  panelInner: { padding: 20, gap: 12 },
  panelBody: { color: '#a1a1aa', fontSize: 14, lineHeight: 20, marginBottom: 4 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 64,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
  },
  choicePrimary: {
    backgroundColor: '#ef4444',
    shadowColor: '#ef4444',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  choiceSecondary: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(20,20,22,0.6)',
  },
  choiceLabels: { flex: 1 },
  choiceLabel: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  choiceSub: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  field: { gap: 6 },
  fieldLabel: { color: '#a1a1aa', fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  input: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(20,20,22,0.6)',
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#f4f4f5',
    fontWeight: '500',
  },
  inputMono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
    fontSize: 18,
  },
  hint: { color: '#7d7d83', fontSize: 12, lineHeight: 16 },
  submit: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  submitLabel: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  error: { color: '#fb7185', fontSize: 13, fontWeight: '600', marginTop: 4 },
  footerRow: {
    marginTop: 'auto',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  ghost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  ghostLabel: { fontSize: 13, fontWeight: '600', color: '#a1a1aa' },
});
