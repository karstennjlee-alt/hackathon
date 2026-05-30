// @ts-nocheck — see SignInScreen.tsx for the React 19 + RN 0.81 type-def drift.
//
// AppRoot — auth gate around the v1 monolith. Dark aesthetic matches v1.

import React from 'react';
import { ActivityIndicator, View, Text, StyleSheet, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { ShieldAlert, Play, LogOut } from 'lucide-react-native';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { SignInScreen } from './src/auth/SignInScreen';
import { signOut } from './src/auth/signIn';
import App from './App';

function Gate(): React.JSX.Element {
  const { loading, session, beacon, demoMode, enterDemo } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#ef4444" />
      </View>
    );
  }

  if (demoMode) return <App />;
  if (!session) return <SignInScreen />;
  if (beacon?.campusId) return <App />;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['rgba(239,68,68,0.18)', 'rgba(10,10,11,0)']}
        style={styles.ambient}
        pointerEvents="none"
      />
      <View style={styles.body}>
        <View style={styles.brandRow}>
          <ShieldAlert size={22} color="#ef4444" strokeWidth={2.5} />
          <Text style={styles.brand}>BEACON5</Text>
        </View>

        <Text style={styles.title}>You're signed in.</Text>
        <Text style={styles.email}>{session.user.email ?? 'user'}</Text>

        <BlurView intensity={28} tint="dark" style={styles.panel}>
          <View style={styles.panelInner}>
            <Text style={styles.panelHeading}>No campus yet</Text>
            <Text style={styles.panelBody}>
              Redeem a join code from your school, or use demo mode to preview the app.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enter demo mode without a campus"
              onPress={enterDemo}
              style={({ pressed }) => [
                styles.demoBtn,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Play size={18} color="#fff" strokeWidth={2.5} fill="#fff" />
              <View style={styles.demoLabels}>
                <Text style={styles.demoLabel}>Enter demo mode</Text>
                <Text style={styles.demoSubLabel}>skip join code · for testing</Text>
              </View>
            </Pressable>
          </View>
        </BlurView>

        <Pressable
          accessibilityRole="button"
          onPress={() => void signOut()}
          style={({ pressed }) => [styles.signOut, { opacity: pressed ? 0.7 : 1 }]}
        >
          <LogOut size={14} color="#a1a1aa" strokeWidth={2.5} />
          <Text style={styles.signOutLabel}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function AppRoot(): React.JSX.Element {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0b',
  },
  root: { flex: 1, backgroundColor: '#0a0a0b' },
  ambient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 280,
  },
  body: {
    flex: 1,
    paddingTop: 96,
    paddingHorizontal: 28,
    paddingBottom: 24,
    gap: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  brand: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
  },
  title: {
    color: '#f4f4f5',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  email: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 12,
  },
  panel: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(76,69,70,0.54)',
    overflow: 'hidden',
    backgroundColor: 'rgba(20,20,22,0.6)',
  },
  panelInner: {
    padding: 20,
    gap: 14,
  },
  panelHeading: {
    color: '#f4f4f5',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  panelBody: {
    color: '#a1a1aa',
    fontSize: 14,
    lineHeight: 20,
  },
  demoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: 64,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: '#ef4444',
    shadowColor: '#ef4444',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  demoLabels: { flex: 1 },
  demoLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  demoSubLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 'auto',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  signOutLabel: { fontSize: 13, fontWeight: '600', color: '#a1a1aa' },
});
