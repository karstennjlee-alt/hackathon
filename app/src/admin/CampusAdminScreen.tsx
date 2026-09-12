// @ts-nocheck — same React 19 + RN 0.81 class-component type drift as the rest of the UI.
//
// CampusAdminScreen — what a school office needs on day one, in the app:
//   Students  add students (name + student ID) → PIN to hand out; reset PINs;
//             issue a parent code for a student
//   Staff     issue staff / admin join codes
//   Campus    name + campus code students type at sign-in
//
// Reads go straight to Supabase (RLS: staff can read the roster, the
// credential list minus pin_hash, and join codes). Writes go through the
// server. Admin-only actions are hidden for plain staff.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { X, GraduationCap, Users, School, KeyRound, Share2, RefreshCcw, UserPlus, Link2 } from 'lucide-react-native';
import { supabase } from '../supabase';
import { issueJoinCode, provisionStudents, rotateStudentPin, describeJoinError } from '../auth/join';

type Tab = 'students' | 'staff' | 'campus';

interface StudentRow {
  uid: string;
  studentId: string;
  displayName: string;
  createdAt: string;
  guardians: number;
}

interface Reveal {
  title: string;
  value: string;
  sub: string;
}

export function CampusAdminScreen({
  campusId,
  campusName,
  campusCode,
  isAdmin,
  onClose,
}: {
  campusId: string;
  campusName: string;
  campusCode?: string;
  isAdmin: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('students');
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [filter, setFilter] = useState('');

  const [newName, setNewName] = useState('');
  const [newId, setNewId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: users }, { data: creds }, { data: links }] = await Promise.all([
        supabase.from('users').select('id, display_name, role, created_at').eq('campus_id', campusId).eq('role', 'student'),
        supabase.from('student_credentials').select('auth_user_id, student_id').eq('campus_id', campusId),
        supabase.from('guardian_links').select('student_user_id').eq('campus_id', campusId).eq('verified', true),
      ]);
      const sid = new Map((creds ?? []).map((c) => [c.auth_user_id as string, c.student_id as string]));
      const gcount = new Map<string, number>();
      for (const l of links ?? []) gcount.set(l.student_user_id, (gcount.get(l.student_user_id) ?? 0) + 1);
      const rows: StudentRow[] = (users ?? [])
        .map((u) => ({
          uid: u.id as string,
          studentId: sid.get(u.id as string) ?? '—',
          displayName: u.display_name as string,
          createdAt: u.created_at as string,
          guardians: gcount.get(u.id as string) ?? 0,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      setStudents(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [campusId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.displayName.toLowerCase().includes(q) || s.studentId.toLowerCase().includes(q));
  }, [students, filter]);

  async function run(key: string, fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(describeJoinError(err));
    } finally {
      setBusy(null);
    }
  }

  const addStudent = () =>
    run('add', async () => {
      if (!newName.trim() || !newId.trim()) {
        setError('Enter the student’s name and school ID.');
        return;
      }
      const { results } = await provisionStudents([{ studentId: newId, displayName: newName }]);
      const r = results[0];
      if (r.status === 'error') throw new Error(r.error ?? 'could not add student');
      if (r.status === 'exists') {
        setError(`${r.studentId} is already on the roster. Use “Reset PIN” to issue a new PIN.`);
        return;
      }
      setReveal({
        title: `${newName.trim()} — PIN`,
        value: r.pin ?? '',
        sub: `Student ID ${r.studentId} · campus code ${campusCode ?? ''}. Write this down for the student; it isn’t shown again.`,
      });
      setNewName('');
      setNewId('');
      await load();
    });

  const resetPin = (s: StudentRow) =>
    run(`pin:${s.uid}`, async () => {
      const r = await rotateStudentPin(s.studentId);
      setReveal({
        title: `${s.displayName} — new PIN`,
        value: r.pin ?? '',
        sub: 'The old PIN stops working now. Hand this one to the student.',
      });
    });

  const parentCode = (s: StudentRow) =>
    run(`parent:${s.uid}`, async () => {
      const r = await issueJoinCode('parent', { studentUserId: s.uid, expiresInHours: 168 });
      setReveal({
        title: `Parent code for ${s.displayName}`,
        value: r.code,
        sub: 'Give this to a parent or guardian. They sign in with email (Staff & family) and enter it. Valid 7 days, one use.',
      });
      await load();
    });

  const staffCode = (role: 'staff' | 'admin') =>
    run(`code:${role}`, async () => {
      const r = await issueJoinCode(role, { expiresInHours: 72 });
      setReveal({
        title: role === 'admin' ? 'Admin join code' : 'Staff join code',
        value: r.code,
        sub: 'They sign in with email (Staff & family) and enter it. Valid 3 days, one use.',
      });
    });

  const share = (text: string) => {
    void Share.share({ message: text }).catch(() => undefined);
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>MANAGE CAMPUS</Text>
            <Text style={styles.title} numberOfLines={1}>{campusName}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.closeBtn}>
            <X color="#f4f4f5" size={20} />
          </Pressable>
        </View>

        <View style={styles.segment} accessibilityRole="tablist">
          <Seg icon={GraduationCap} label="Students" active={tab === 'students'} onPress={() => setTab('students')} />
          <Seg icon={Users} label="Staff" active={tab === 'staff'} onPress={() => setTab('staff')} />
          <Seg icon={School} label="Campus" active={tab === 'campus'} onPress={() => setTab('campus')} />
        </View>

        {reveal ? (
          <BlurView intensity={28} tint="dark" style={[styles.panel, styles.revealPanel]}>
            <View style={styles.panelInner}>
              <Text style={styles.revealTitle}>{reveal.title}</Text>
              <Text style={styles.revealValue} selectable accessibilityLabel={`${reveal.title}: ${reveal.value.split('').join(' ')}`}>
                {reveal.value}
              </Text>
              <Text style={styles.revealSub}>{reveal.sub}</Text>
              <View style={styles.row}>
                <SmallButton icon={Share2} label="Share" onPress={() => share(`${reveal.title}: ${reveal.value}`)} />
                <SmallButton label="Done" onPress={() => setReveal(null)} primary />
              </View>
            </View>
          </BlurView>
        ) : null}

        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text>
        ) : null}

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {tab === 'students' ? (
            <>
              {isAdmin ? (
                <BlurView intensity={28} tint="dark" style={styles.panel}>
                  <View style={styles.panelInner}>
                    <Text style={styles.panelHeading}>Add a student</Text>
                    <Field label="Name" value={newName} onChangeText={setNewName} placeholder="e.g. Jordan Reyes" autoCapitalize="words" />
                    <Field label="Student ID" value={newId} onChangeText={setNewId} placeholder="the school’s ID number" autoCapitalize="characters" autoCorrect={false} />
                    <SmallButton icon={UserPlus} label="Add & get PIN" onPress={addStudent} busy={busy === 'add'} primary wide />
                  </View>
                </BlurView>
              ) : (
                <Text style={styles.hint}>Only admins add students. You can reset PINs and issue parent codes.</Text>
              )}

              <View style={styles.listHeader}>
                <Text style={styles.panelHeading}>Roster · {students.length}</Text>
                <Pressable onPress={() => void load()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Refresh roster">
                  <RefreshCcw color="#a1a1aa" size={16} />
                </Pressable>
              </View>
              <TextInput
                style={styles.search}
                placeholder="Search name or ID"
                placeholderTextColor="#7d7d83"
                value={filter}
                onChangeText={setFilter}
                autoCorrect={false}
                accessibilityLabel="Search roster"
              />
              {loading ? <ActivityIndicator color="#ef4444" style={{ marginTop: 20 }} /> : null}
              {!loading && visible.length === 0 ? <Text style={styles.hint}>No students yet.</Text> : null}
              {visible.map((s) => (
                <View key={s.uid} style={styles.studentRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.studentName}>{s.displayName}</Text>
                    <Text style={styles.studentMeta}>
                      ID {s.studentId} · {s.guardians} guardian{s.guardians === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <SmallButton icon={KeyRound} label="Reset PIN" onPress={() => resetPin(s)} busy={busy === `pin:${s.uid}`} />
                  <SmallButton icon={Link2} label="Parent code" onPress={() => parentCode(s)} busy={busy === `parent:${s.uid}`} />
                </View>
              ))}
            </>
          ) : null}

          {tab === 'staff' ? (
            <BlurView intensity={28} tint="dark" style={styles.panel}>
              <View style={styles.panelInner}>
                <Text style={styles.panelHeading}>Invite staff</Text>
                <Text style={styles.hint}>
                  Codes are one-use and expire in 3 days. Staff can activate a beacon, see the fleet map, verify
                  incidents, message families, declare and clear campus threats.
                </Text>
                <SmallButton icon={Users} label="New staff code" onPress={() => staffCode('staff')} busy={busy === 'code:staff'} primary wide />
                {isAdmin ? (
                  <SmallButton icon={Users} label="New admin code" onPress={() => staffCode('admin')} busy={busy === 'code:admin'} wide />
                ) : null}
              </View>
            </BlurView>
          ) : null}

          {tab === 'campus' ? (
            <BlurView intensity={28} tint="dark" style={styles.panel}>
              <View style={styles.panelInner}>
                <Text style={styles.panelHeading}>{campusName}</Text>
                <Text style={styles.hint}>Students sign in with this campus code, their student ID and their PIN.</Text>
                <Text style={styles.revealValue} selectable>{campusCode ?? '—'}</Text>
                <SmallButton icon={Share2} label="Share campus code" onPress={() => share(`Beacon5 campus code for ${campusName}: ${campusCode}`)} wide />
                <Text style={styles.hint}>
                  Beacon5 is a coordination tool. It is not a replacement for 911 or your school’s crisis plan.
                </Text>
              </View>
            </BlurView>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Seg({ icon: Icon, label, active, onPress }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.segBtn, active && styles.segBtnActive, { opacity: pressed ? 0.85 : 1 }]}
    >
      <Icon size={15} color={active ? '#0a0a0b' : '#a1a1aa'} strokeWidth={2.5} />
      <Text style={[styles.segLabel, active && styles.segLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, ...input }): React.JSX.Element {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput {...input} accessibilityLabel={label} placeholderTextColor="#7d7d83" style={styles.input} />
    </View>
  );
}

function SmallButton({ icon: Icon, label, onPress, busy, primary, wide }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy, disabled: !!busy }}
      disabled={!!busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.smallBtn,
        primary && styles.smallBtnPrimary,
        wide && { alignSelf: 'stretch', justifyContent: 'center', height: 48 },
        { opacity: pressed || busy ? 0.8 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? '#fff' : '#f4f4f5'} size="small" />
      ) : (
        <>
          {Icon ? <Icon size={14} color={primary ? '#fff' : '#f4f4f5'} strokeWidth={2.5} /> : null}
          <Text style={[styles.smallBtnLabel, primary && { color: '#fff' }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0b' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 64, paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  eyebrow: { color: '#ef4444', fontSize: 11, fontWeight: '900', letterSpacing: 2.5 },
  title: { color: '#f4f4f5', fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  closeBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  segment: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 12, padding: 4, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(76,69,70,0.54)', backgroundColor: 'rgba(20,20,22,0.6)', gap: 4 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: 12 },
  segBtnActive: { backgroundColor: '#f4f4f5' },
  segLabel: { color: '#a1a1aa', fontSize: 13, fontWeight: '700' },
  segLabelActive: { color: '#0a0a0b' },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  panel: { borderRadius: 20, borderWidth: 1, borderColor: 'rgba(76,69,70,0.54)', overflow: 'hidden', backgroundColor: 'rgba(20,20,22,0.6)' },
  revealPanel: { marginHorizontal: 20, marginBottom: 12, borderColor: '#22c55e' },
  panelInner: { padding: 18, gap: 12 },
  panelHeading: { color: '#f4f4f5', fontSize: 16, fontWeight: '700' },
  hint: { color: '#a1a1aa', fontSize: 13, lineHeight: 18 },
  error: { color: '#fb7185', fontSize: 13, fontWeight: '600', marginHorizontal: 20, marginBottom: 8 },
  revealTitle: { color: '#a1a1aa', fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  revealValue: { color: '#f4f4f5', fontSize: 34, fontWeight: '800', letterSpacing: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  revealSub: { color: '#a1a1aa', fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  fieldLabel: { color: '#a1a1aa', fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  input: { height: 46, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(20,20,22,0.6)', paddingHorizontal: 14, fontSize: 16, color: '#f4f4f5', fontWeight: '500' },
  search: { height: 42, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(20,20,22,0.6)', paddingHorizontal: 12, fontSize: 14, color: '#f4f4f5' },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  studentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
  studentName: { color: '#f4f4f5', fontSize: 15, fontWeight: '700' },
  studentMeta: { color: '#a1a1aa', fontSize: 12, marginTop: 2 },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 36, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(20,20,22,0.6)' },
  smallBtnPrimary: { backgroundColor: '#ef4444', borderColor: '#ef4444' },
  smallBtnLabel: { color: '#f4f4f5', fontSize: 13, fontWeight: '700' },
});
