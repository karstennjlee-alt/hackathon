// @ts-nocheck — see SignInScreen.tsx for the React 19 + RN 0.81 type-def drift.
//
// AppRoot — auth gate around the v1 monolith.
//   loading → spinner
//   demo    → monolith with its own local roster picker (EXPO_PUBLIC_DEMO only)
//   no user → SignInScreen
//   no campus → JoinCampusScreen (join code / create campus)
//   member  → monolith driven by the real identity (no roster picker)

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, View, StyleSheet } from 'react-native';
import { CampusAdminScreen } from './src/admin/CampusAdminScreen';
import { AuthProvider, useAuth, type BeaconSession } from './src/auth/AuthContext';
import { SignInScreen } from './src/auth/SignInScreen';
import { JoinCampusScreen } from './src/auth/JoinCampusScreen';
import { signOut } from './src/auth/signIn';
import { lookupUserName } from './src/data/users';
import App, { type AppIdentity } from './App';

// Map the v2 session onto the monolith's Profile shape. Parents need the
// linked student's display name, which lives in public.users — resolved
// async below and re-rendered when it lands.
function buildIdentity(
  b: BeaconSession,
  linkedStudentName: string | null,
  openCampusAdmin: () => void,
): AppIdentity | null {
  if (!b.campusId || !b.role) return null;
  const campusName = b.campusName ?? 'Campus';
  const name = b.displayName ?? 'Campus member';
  const staffOnly = b.role === 'staff' || b.role === 'admin' ? { openCampusAdmin } : {};
  const base = { campusName, campusCode: b.campusCode ?? undefined, signOut: () => void signOut(), ...staffOnly };
  switch (b.role) {
    case 'student':
      return { ...base, profile: { role: 'student', studentId: b.uid, studentName: name } };
    case 'staff':
      return { ...base, profile: { role: 'staff', staffId: b.uid, staffName: name, staffTitle: 'Staff', isAdmin: false } };
    case 'admin':
      return { ...base, profile: { role: 'staff', staffId: b.uid, staffName: name, staffTitle: 'Administrator', isAdmin: true } };
    case 'parent': {
      const linkedStudentId = b.linkedStudents?.[0] ?? '';
      return {
        ...base,
        profile: {
          role: 'parent',
          linkedStudentId,
          linkedStudentName: linkedStudentName ?? (linkedStudentId ? 'your student' : 'no linked student'),
        },
      };
    }
    default:
      return null;
  }
}

function Gate(): React.JSX.Element {
  const { loading, session, beacon, demoMode } = useAuth();
  const [linkedStudentName, setLinkedStudentName] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);

  const linkedStudentId = beacon?.role === 'parent' ? beacon.linkedStudents?.[0] ?? null : null;
  useEffect(() => {
    let cancelled = false;
    setLinkedStudentName(null);
    if (!linkedStudentId) return;
    lookupUserName(linkedStudentId).then((n) => {
      if (!cancelled) setLinkedStudentName(n);
    });
    return () => {
      cancelled = true;
    };
  }, [linkedStudentId]);

  const identity = useMemo(
    () => (beacon ? buildIdentity(beacon, linkedStudentName, () => setAdminOpen(true)) : null),
    [beacon, linkedStudentName],
  );

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#ef4444" />
      </View>
    );
  }

  if (demoMode) return <App />;
  if (!session) return <SignInScreen />;
  if (identity) {
    return (
      <>
        <App identity={identity} />
        {beacon?.campusId && identity.openCampusAdmin ? (
          <Modal visible={adminOpen} animationType="slide" onRequestClose={() => setAdminOpen(false)}>
            <CampusAdminScreen
              campusId={beacon.campusId}
              campusName={identity.campusName}
              campusCode={identity.campusCode}
              isAdmin={beacon.role === 'admin'}
              onClose={() => setAdminOpen(false)}
            />
          </Modal>
        ) : null}
      </>
    );
  }
  return <JoinCampusScreen />;
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
});
