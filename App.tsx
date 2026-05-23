import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApps } from 'firebase/app';
import {
  getDatabase,
  ref as dbRef,
  onValue,
  push as dbPush,
  set as dbSet,
  serverTimestamp,
} from 'firebase/database';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import Svg, { Circle } from 'react-native-svg';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Cross,
  Eye,
  EyeOff,
  Filter,
  Flame,
  GraduationCap,
  HeartPulse,
  Home,
  Lock,
  LogOut,
  MapPin,
  Megaphone,
  Radio,
  RefreshCcw,
  Shield,
  ShieldCheck,
  Siren,
  Sparkles,
  User,
  UsersRound,
  Wifi,
  X,
  Zap,
} from 'lucide-react-native';

type Mode = 'student' | 'staff' | 'parent';
type StatusKey = 'safe' | 'barricade' | 'medical' | 'threat';
type VerificationState = 'pending' | 'forming' | 'verified' | 'staff_confirmed';
type LocationToken = 'dormant' | 'active';

type Zone = {
  key: string;
  title: string;
  detail: string;
  room: string;
  x: number;
  y: number;
};

type Report = {
  id: string;
  zoneKey: string;
  zoneTitle: string;
  room: string;
  status: StatusKey;
  context: string;
  createdAt: number;
  x: number;
  y: number;
  studentLinked?: boolean;
};

type Coords = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

type GpsStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'error';

type Incident = {
  id: string;
  zone: Zone;
  activatedAt: number;
  threatNote?: string;
  medicalNote?: string;
  coords?: Coords;
  gpsStatus: GpsStatus;
  gpsError?: string;
  zoneDescription?: string;
};

type StatusMeta = {
  label: string;
  short: string;
  color: string;
  tint: string;
  glow: string;
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
};

type VerificationMeta = {
  label: string;
  short: string;
  color: string;
  tint: string;
  glow: string;
  description: string;
};

const statusMeta: Record<StatusKey, StatusMeta> = {
  safe: {
    label: 'Safe & Hidden',
    short: 'Safe',
    color: '#22c55e',
    tint: 'rgba(34, 197, 94, 0.13)',
    glow: 'rgba(34, 197, 94, 0.32)',
    icon: ShieldCheck,
  },
  barricade: {
    label: 'Barricade Secure',
    short: 'Barricade',
    color: '#a855f7',
    tint: 'rgba(168, 85, 247, 0.13)',
    glow: 'rgba(168, 85, 247, 0.3)',
    icon: Lock,
  },
  medical: {
    label: 'Medical Urgent',
    short: 'Medical',
    color: '#3b82f6',
    tint: 'rgba(59, 130, 246, 0.13)',
    glow: 'rgba(59, 130, 246, 0.32)',
    icon: HeartPulse,
  },
  threat: {
    label: 'Threat Sighted',
    short: 'Threat',
    color: '#ef4444',
    tint: 'rgba(239, 68, 68, 0.13)',
    glow: 'rgba(239, 68, 68, 0.36)',
    icon: Eye,
  },
};

const verificationMeta: Record<VerificationState, VerificationMeta> = {
  pending: {
    label: 'Pending Anomaly',
    short: 'Pending',
    color: '#fbbf24',
    tint: 'rgba(251, 191, 36, 0.13)',
    glow: 'rgba(251, 191, 36, 0.32)',
    description: 'Single report received. Awaiting corroboration.',
  },
  forming: {
    label: 'Cluster Forming',
    short: 'Forming',
    color: '#fb923c',
    tint: 'rgba(251, 146, 60, 0.13)',
    glow: 'rgba(251, 146, 60, 0.32)',
    description: 'Two reports in the same zone within 60 seconds. Recommend verification.',
  },
  verified: {
    label: 'Verified Campus Alert',
    short: 'Verified',
    color: '#ef4444',
    tint: 'rgba(239, 68, 68, 0.15)',
    glow: 'rgba(239, 68, 68, 0.4)',
    description: 'Three or more reports clustered. Human review required.',
  },
  staff_confirmed: {
    label: 'Staff Confirmed',
    short: 'Confirmed',
    color: '#38bdf8',
    tint: 'rgba(56, 189, 248, 0.15)',
    glow: 'rgba(56, 189, 248, 0.4)',
    description: 'Verified by on-site staff. Coordinated response in motion.',
  },
};

const zones: Zone[] = [
  { key: 'west_wing', title: 'West Wing', detail: 'Building A', room: 'Room 204', x: 42, y: 42 },
  { key: 'cafeteria', title: 'Cafeteria', detail: 'Central Hub', room: 'Cafeteria', x: 68, y: 58 },
  { key: 'gym', title: 'Gym', detail: 'North Field', room: 'Gym', x: 30, y: 70 },
  { key: 'office', title: 'Main Office', detail: 'Entrance', room: 'Office', x: 55, y: 28 },
];

const zoneByKey = (key: string): Zone => zones.find((z) => z.key === key) ?? zones[0];

const seedReports: Report[] = [
  {
    id: 'seed-threat',
    zoneKey: 'west_wing',
    zoneTitle: 'West Wing',
    room: 'Room 104',
    status: 'threat',
    context: 'Hallway B - West Wing zone',
    createdAt: Date.now() - 12_000,
    x: 40,
    y: 36,
  },
  {
    id: 'seed-medical',
    zoneKey: 'cafeteria',
    zoneTitle: 'Cafeteria',
    room: 'Room 212',
    status: 'medical',
    context: 'Cafeteria zone - trauma reported',
    createdAt: Date.now() - 37_000,
    x: 58,
    y: 65,
  },
  {
    id: 'seed-barricade',
    zoneKey: 'office',
    zoneTitle: 'Main Office',
    room: 'Room 305',
    status: 'barricade',
    context: 'Main Office zone - room buttoned down',
    createdAt: Date.now() - 60_000,
    x: 72,
    y: 34,
  },
  {
    id: 'seed-safe',
    zoneKey: 'gym',
    zoneTitle: 'Gym',
    room: 'Room 118',
    status: 'safe',
    context: 'Gym zone - sheltered and silent',
    createdAt: Date.now() - 120_000,
    x: 27,
    y: 52,
  },
];

const formatRelativeTime = (createdAt: number, now: number) => {
  const diff = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (diff < 5) return 'now';
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  return `${m}m ago`;
};

const CLUSTER_WINDOW_MS = 60_000;

type StudentRosterEntry = { id: string; name: string; grade: string };
type StaffRosterEntry = { id: string; name: string; title: string };

const studentRoster: StudentRosterEntry[] = [
  { id: 'stu-alex', name: 'Alex Chen', grade: '10th' },
  { id: 'stu-jordan', name: 'Jordan Reyes', grade: '11th' },
  { id: 'stu-sam', name: 'Sam Park', grade: '9th' },
  { id: 'stu-riley', name: 'Riley Nguyen', grade: '12th' },
  { id: 'stu-casey', name: 'Casey Morgan', grade: '10th' },
  { id: 'stu-drew', name: 'Drew Patel', grade: '11th' },
];

const staffRoster: StaffRosterEntry[] = [
  { id: 'staff-hart', name: 'Ms. J. Hart', title: 'School Nurse' },
  { id: 'staff-davis', name: 'Coach K. Davis', title: 'PE / Athletics' },
  { id: 'staff-whitman', name: 'Mr. R. Whitman', title: 'Principal' },
  { id: 'staff-lopez', name: 'Ms. A. Lopez', title: 'Counselor' },
  { id: 'staff-okafor', name: 'Mr. D. Okafor', title: 'Security Lead' },
];

type Profile =
  | { role: 'student'; studentId: string; studentName: string }
  | { role: 'staff'; staffId: string; staffName: string; staffTitle: string }
  | { role: 'parent'; linkedStudentId: string; linkedStudentName: string };

const PROFILE_STORAGE_KEY = 'beacon5.profile.v1';

async function loadProfile(): Promise<Profile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

async function saveProfile(profile: Profile): Promise<void> {
  await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

async function clearProfile(): Promise<void> {
  await AsyncStorage.removeItem(PROFILE_STORAGE_KEY);
}

// ============================================================================
// SHARED EVENT STORE (cross-profile demo via AsyncStorage)
// ============================================================================
type BeaconEvent =
  | {
      type: 'BEACON_ACTIVATED';
      id: string;
      studentId: string;
      studentName: string;
      coords: Coords | null;
      zoneDescription?: string;
      at: number;
    }
  | {
      type: 'BEACON_RESET';
      id: string;
      studentId: string;
      at: number;
    }
  | {
      type: 'STAFF_BROADCAST';
      id: string;
      studentId: string;
      message: string;
      kind: 'all_clear' | 'update';
      at: number;
    }
  | {
      type: 'INCIDENT_NOTE';
      id: string;
      studentId: string;
      studentName: string;
      kind: 'threat' | 'medical';
      rawNote: string;
      polishedNote: string;
      at: number;
    }
  | {
      type: 'LOCATION_UPDATE';
      id: string;
      studentId: string;
      incidentId: string;
      coords: Coords;
      at: number;
    }
  | {
      type: 'CHAT_MESSAGE';
      id: string;
      sender: 'staff' | 'parent';
      senderName: string;
      studentId: string;
      message: string;
      at: number;
    }
  | {
      type: 'MASS_BROADCAST';
      id: string;
      senderId: string;
      senderName: string;
      audience: 'students' | 'parents' | 'teachers' | 'everyone' | 'both';
      message: string;
      at: number;
    };

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const firebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const database = getDatabase(firebaseApp);
const EVENTS_PATH = 'beacon5/events';

function subscribeToEvents(onEvents: (events: BeaconEvent[]) => void): () => void {
  const eventsRef = dbRef(database, EVENTS_PATH);
  const unsubscribe = onValue(
    eventsRef,
    (snapshot) => {
      const val = snapshot.val();
      if (!val || typeof val !== 'object') {
        onEvents([]);
        return;
      }
      const list = Object.values(val) as Array<BeaconEvent & { serverAt?: number }>;
      list.sort((a, b) => {
        const aTs = typeof a.serverAt === 'number' ? a.serverAt : a.at;
        const bTs = typeof b.serverAt === 'number' ? b.serverAt : b.at;
        return aTs - bTs;
      });
      onEvents(list);
    },
    (error) => {
      console.warn('Firebase events subscription error:', error.message);
      onEvents([]);
    },
  );
  return () => unsubscribe();
}

const PENDING_EVENTS_KEY = 'beacon5.pendingEvents.v1';

async function loadPendingEvents(): Promise<BeaconEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_EVENTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BeaconEvent[];
  } catch {
    return [];
  }
}

async function savePendingEvents(events: BeaconEvent[]): Promise<void> {
  try {
    if (events.length === 0) {
      await AsyncStorage.removeItem(PENDING_EVENTS_KEY);
    } else {
      await AsyncStorage.setItem(PENDING_EVENTS_KEY, JSON.stringify(events.slice(-50)));
    }
  } catch {
    // best effort
  }
}

async function pushEventToFirebase(event: BeaconEvent): Promise<void> {
  const eventsRef = dbRef(database, EVENTS_PATH);
  await dbPush(eventsRef, { ...event, serverAt: serverTimestamp() });
}

let flushingQueue = false;
async function flushPendingEvents(): Promise<void> {
  if (flushingQueue) return;
  flushingQueue = true;
  try {
    let pending = await loadPendingEvents();
    while (pending.length > 0) {
      const next = pending[0];
      try {
        await pushEventToFirebase(next);
        pending = pending.slice(1);
        await savePendingEvents(pending);
      } catch {
        // network still bad, stop trying for now
        break;
      }
    }
  } finally {
    flushingQueue = false;
  }
}

async function appendEvent(event: BeaconEvent): Promise<void> {
  try {
    await pushEventToFirebase(event);
    flushPendingEvents().catch(() => undefined);
  } catch (err) {
    console.warn('Firebase appendEvent queued for retry:', err);
    const pending = await loadPendingEvents();
    await savePendingEvents([...pending, event]);
  }
}

async function clearEvents(): Promise<void> {
  try {
    await dbSet(dbRef(database, EVENTS_PATH), null);
    await savePendingEvents([]);
  } catch (err) {
    console.warn('Firebase clearEvents failed:', err);
  }
}

// ============================================================================
// BACKGROUND LOCATION TRACKING (requires EAS dev build — no-op in Expo Go)
// ============================================================================
const BG_LOCATION_TASK = 'beacon5-background-location';
const BG_TASK_STATE_KEY = 'beacon5.bgTask.v1';

type BgTaskState = {
  studentId: string;
  studentName: string;
  incidentId: string;
  lastAccuracy: number | null;
};

async function saveBgTaskState(state: BgTaskState | null): Promise<void> {
  try {
    if (state) await AsyncStorage.setItem(BG_TASK_STATE_KEY, JSON.stringify(state));
    else await AsyncStorage.removeItem(BG_TASK_STATE_KEY);
  } catch {
    // best effort
  }
}

async function loadBgTaskState(): Promise<BgTaskState | null> {
  try {
    const raw = await AsyncStorage.getItem(BG_TASK_STATE_KEY);
    return raw ? (JSON.parse(raw) as BgTaskState) : null;
  } catch {
    return null;
  }
}

function shouldAcceptFix(accuracy: number | null, lastAccuracy: number | null): boolean {
  if (accuracy == null) return true; // unknown accuracy — accept
  if (accuracy > 200) return false; // very loose ceiling so indoor fixes survive
  if (lastAccuracy != null && accuracy > Math.max(lastAccuracy * 4, lastAccuracy + 80)) return false;
  return true;
}

TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('BG location task error:', error);
    return;
  }
  const payload = data as { locations?: Location.LocationObject[] } | undefined;
  if (!payload?.locations || payload.locations.length === 0) return;
  const state = await loadBgTaskState();
  if (!state) return;
  let lastAccuracy = state.lastAccuracy;
  for (const loc of payload.locations) {
    const accuracy = loc.coords.accuracy ?? null;
    if (!shouldAcceptFix(accuracy, lastAccuracy)) continue;
    lastAccuracy = accuracy;
    const coords: Coords = {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy,
    };
    await appendEvent({
      type: 'LOCATION_UPDATE',
      id: `loc-bg-${loc.timestamp}-${Math.floor(Math.random() * 1000)}`,
      studentId: state.studentId,
      incidentId: state.incidentId,
      coords,
      at: loc.timestamp,
    });
  }
  await saveBgTaskState({ ...state, lastAccuracy });
});

async function startBackgroundLocation(state: BgTaskState): Promise<boolean> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') return false;
    let bgStatus = await Location.getBackgroundPermissionsAsync();
    if (bgStatus.status !== 'granted' && bgStatus.canAskAgain) {
      bgStatus = await Location.requestBackgroundPermissionsAsync();
    }
    if (bgStatus.status !== 'granted') return false;
    await saveBgTaskState(state);
    const running = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(
      () => false,
    );
    if (running) {
      await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK).catch(() => undefined);
    }
    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 3000,
      distanceInterval: 1,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'Beacon5 emergency tracking',
        notificationBody: 'Sharing your location with staff and your guardian.',
        notificationColor: '#ef4444',
      },
      activityType: Location.ActivityType.OtherNavigation,
    });
    return true;
  } catch (err) {
    // Most common cause: Expo Go (background updates unsupported). Falls back to foreground watcher.
    console.warn('Background tracking unavailable:', err);
    return false;
  }
}

async function stopBackgroundLocation(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK).catch(
      () => false,
    );
    if (running) await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
  } catch {
    // best effort
  }
  await saveBgTaskState(null);
}

function deriveActiveIncidents(events: BeaconEvent[]): Array<
  Extract<BeaconEvent, { type: 'BEACON_ACTIVATED' }>
> {
  const open = new Map<string, Extract<BeaconEvent, { type: 'BEACON_ACTIVATED' }>>();
  for (const ev of events) {
    if (ev.type === 'BEACON_ACTIVATED') open.set(ev.studentId, ev);
    else if (ev.type === 'BEACON_RESET') open.delete(ev.studentId);
    else if (ev.type === 'STAFF_BROADCAST' && ev.kind === 'all_clear') open.delete(ev.studentId);
  }
  return Array.from(open.values());
}

function latestBroadcastForStudent(
  events: BeaconEvent[],
  studentId: string,
): Extract<BeaconEvent, { type: 'STAFF_BROADCAST' }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'STAFF_BROADCAST' && ev.studentId === studentId) return ev;
  }
  return null;
}

function messagesForStudent(
  events: BeaconEvent[],
  studentId: string,
): Array<Extract<BeaconEvent, { type: 'CHAT_MESSAGE' }>> {
  return events.filter(
    (e): e is Extract<BeaconEvent, { type: 'CHAT_MESSAGE' }> =>
      e.type === 'CHAT_MESSAGE' && e.studentId === studentId,
  );
}

function notesForStudent(
  events: BeaconEvent[],
  studentId: string,
  sinceAt: number = 0,
): Array<Extract<BeaconEvent, { type: 'INCIDENT_NOTE' }>> {
  return events.filter(
    (e): e is Extract<BeaconEvent, { type: 'INCIDENT_NOTE' }> =>
      e.type === 'INCIDENT_NOTE' && e.studentId === studentId && e.at >= sinceAt,
  );
}

async function sendChatMessage(
  sender: 'staff' | 'parent',
  senderName: string,
  studentId: string,
  message: string,
): Promise<void> {
  const text = message.trim();
  if (!text) return;
  await appendEvent({
    type: 'CHAT_MESSAGE',
    id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    sender,
    senderName,
    studentId,
    message: text,
    at: Date.now(),
  });
}

const ADMIN_STAFF_ID = 'staff-whitman';

function isAdminProfile(profile: Profile | null): boolean {
  return profile?.role === 'staff' && profile.staffId === ADMIN_STAFF_ID;
}

function massBroadcastsFor(
  events: BeaconEvent[],
  role: 'student' | 'parent' | 'staff',
): Array<Extract<BeaconEvent, { type: 'MASS_BROADCAST' }>> {
  return events.filter(
    (e): e is Extract<BeaconEvent, { type: 'MASS_BROADCAST' }> => {
      if (e.type !== 'MASS_BROADCAST') return false;
      if (role === 'staff') return true; // staff always sees the full log
      const all = e.audience === 'everyone' || e.audience === 'both';
      if (role === 'student') return e.audience === 'students' || all;
      return e.audience === 'parents' || all;
    },
  );
}

function massBroadcastIsForRole(
  e: Extract<BeaconEvent, { type: 'MASS_BROADCAST' }>,
  role: 'student' | 'parent' | 'staff',
): boolean {
  const all = e.audience === 'everyone' || e.audience === 'both';
  if (all) return true;
  if (role === 'student') return e.audience === 'students';
  if (role === 'parent') return e.audience === 'parents';
  return e.audience === 'teachers';
}

async function sendMassBroadcast(
  senderId: string,
  senderName: string,
  audience: 'students' | 'parents' | 'teachers' | 'everyone',
  message: string,
): Promise<void> {
  const text = message.trim();
  if (!text) return;
  await appendEvent({
    type: 'MASS_BROADCAST',
    id: `mass-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    senderId,
    senderName,
    audience,
    message: text,
    at: Date.now(),
  });
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return true;
    if (!settings.canAskAgain) return false;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

async function fireLocalNotification(
  title: string,
  body: string,
  options?: { subtitle?: string; critical?: boolean },
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        ...(options?.subtitle ? { subtitle: options.subtitle } : {}),
        body,
        sound: 'default',
        ...(options?.critical
          ? { interruptionLevel: 'timeSensitive' as const, priority: 'max' as const }
          : {}),
      },
      trigger: null,
    });
  } catch {
    // best effort
  }
}

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function callGemini(prompt: string, signal?: AbortSignal): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 256 },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === 'string' ? text.trim() : null;
  } catch {
    return null;
  }
}

function haversineMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pathForStudentIncident(
  events: BeaconEvent[],
  studentId: string,
  incidentId: string,
): Coords[] {
  const raw: Coords[] = [];
  let started = false;
  for (const ev of events) {
    if (ev.type === 'BEACON_ACTIVATED' && ev.id === incidentId && ev.coords) {
      raw.push(ev.coords);
      started = true;
    } else if (
      started &&
      ev.type === 'LOCATION_UPDATE' &&
      ev.studentId === studentId &&
      ev.incidentId === incidentId
    ) {
      raw.push(ev.coords);
    } else if (
      started &&
      (ev.type === 'BEACON_RESET' || ev.type === 'STAFF_BROADCAST') &&
      ev.studentId === studentId
    ) {
      break;
    }
  }
  if (raw.length < 3) return raw;
  const smoothed: Coords[] = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    const a = raw[i - 1];
    const b = raw[i];
    const c = raw[i + 1];
    smoothed.push({
      latitude: (a.latitude + b.latitude + c.latitude) / 3,
      longitude: (a.longitude + b.longitude + c.longitude) / 3,
      accuracy: b.accuracy,
    });
  }
  smoothed.push(raw[raw.length - 1]);
  return smoothed;
}

function totalDistanceMeters(path: Coords[]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i++) sum += haversineMeters(path[i - 1], path[i]);
  return sum;
}

async function polishIncidentNote(
  kind: 'threat' | 'medical',
  rawNote: string,
  studentName: string,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = rawNote.trim();
  const first = studentName.split(' ')[0];
  if (!trimmed) {
    return kind === 'threat'
      ? `${first} reports a threat. No details.`
      : `${first} reports a medical need. No details.`;
  }
  const prompt = `You are a campus safety push notification writer. A student named ${studentName} just flagged a ${kind === 'threat' ? 'THREAT SIGHTING' : 'MEDICAL NEED'}.

Compress their raw input into ONE alert that fits a phone lock-screen banner. STRICT requirements:
- HARD MAX 12 words. Count them.
- Lead with the student's first name.
- Keep concrete details (weapons, body parts, locations, symptoms) - never invent any.
- Drop filler words. No preamble, no quotes.
- No police/911/EMS mention.

Raw input: "${trimmed}"

Output ONLY the alert text.`;
  const result = await callGemini(prompt, signal);
  if (result) {
    // Hard cap as safety net in case Gemini over-runs.
    const words = result.split(/\s+/);
    if (words.length > 14) return words.slice(0, 14).join(' ') + '...';
    return result;
  }
  const short = trimmed.length > 60 ? trimmed.slice(0, 60) + '...' : trimmed;
  return `${first} ${kind === 'threat' ? 'threat' : 'medical'}: ${short}`;
}

async function generateAllClearBroadcast(
  studentName: string,
  zone: string,
  coords: Coords | null,
  zoneDescription: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const locationLine = coords
    ? `GPS ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)} (~${Math.round(coords.accuracy ?? 0)}m). ${zoneDescription ?? ''}`.trim()
    : 'GPS not available.';
  const prompt = `You are the calm official voice of campus safety staff at a high school. A student named ${studentName} just had an active beacon in ${zone}. ${locationLine}

A school staff member has now marked the situation ALL CLEAR after on-site verification.

Write the broadcast that goes to ${studentName} and their guardian. Requirements:
- 2 short sentences, max 35 words total.
- Calm, official, reassuring.
- Confirm the all-clear, mention the student by first name, give one clear next step (e.g. "stay seated, you'll be released to your guardian shortly").
- Do NOT mention police, EMS, or 911.
- Do NOT use the word "AI".

Output ONLY the broadcast text. No preamble.`;
  const result = await callGemini(prompt, signal);
  if (result) return result;
  const first = studentName.split(' ')[0];
  return `All clear, ${first}. Staff have verified the area and you are safe. Please stay in place until a staff member or your guardian arrives.`;
}

async function reverseGeocodeWithGemini(coords: Coords, signal?: AbortSignal): Promise<string | null> {
  const prompt = `You are a campus safety assistant. A student just activated an emergency beacon at these GPS coordinates: latitude ${coords.latitude.toFixed(6)}, longitude ${coords.longitude.toFixed(6)} (accuracy ~${coords.accuracy ?? 'unknown'}m).

In ONE short sentence (max 18 words), describe the most likely physical area or landmark this corresponds to. Be concrete (e.g. "near the cafeteria entrance" or "on the north sidewalk along Main Street"). If you cannot determine specifics, say "Approximate area only - awaiting staff verification."`;
  return callGemini(prompt, signal);
}

const computeZoneVerifications = (
  reports: Report[],
  staffConfirmedZones: Set<string>,
  now: number,
) => {
  const map = new Map<string, VerificationState>();
  for (const zone of zones) {
    const inZone = reports.filter((r) => r.zoneKey === zone.key);
    if (inZone.length === 0) continue;
    const latest = inZone.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    const recent = inZone.filter((r) => latest.createdAt - r.createdAt <= CLUSTER_WINDOW_MS);
    let state: VerificationState;
    if (recent.length >= 3) state = 'verified';
    else if (recent.length >= 2) state = 'forming';
    else state = 'pending';
    if (staffConfirmedZones.has(zone.key) && state === 'verified') state = 'staff_confirmed';
    // also allow staff_confirmed when verified earlier in time
    map.set(zone.key, state);
  }
  return map;
};

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [reports, setReports] = useState<Report[]>(seedReports);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [escalationSheet, setEscalationSheet] = useState<'threat' | 'medical' | null>(null);
  const [staffConfirmed, setStaffConfirmed] = useState<Set<string>>(new Set());
  const [now, setNow] = useState<number>(Date.now());
  const [events, setEvents] = useState<BeaconEvent[]>([]);
  const [notifPermitted, setNotifPermitted] = useState(false);
  const [generatingBroadcast, setGeneratingBroadcast] = useState(false);
  const lastNotifiedBroadcastRef = useRef<string | null>(null);
  const lastNotifiedIncidentRef = useRef<string | null>(null);
  const lastNotifiedNoteRef = useRef<string | null>(null);
  const lastNotifiedChatRef = useRef<string | null>(null);
  const lastNotifiedMassRef = useRef<string | null>(null);
  const watchSubscriptionRef = useRef<Location.LocationSubscription | null>(null);

  const mode: Mode = profile?.role ?? 'student';

  useEffect(() => {
    loadProfile().then((p) => {
      setProfile(p);
      setProfileLoaded(true);
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToEvents(setEvents);
    flushPendingEvents().catch(() => undefined);
    const retryId = setInterval(() => {
      flushPendingEvents().catch(() => undefined);
    }, 8000);
    return () => {
      unsubscribe();
      clearInterval(retryId);
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    ensureNotificationPermission().then(setNotifPermitted);
    if (profile.role === 'student') {
      Location.requestForegroundPermissionsAsync().catch(() => undefined);
    }
  }, [profile]);

  useEffect(() => {
    if (!profile || profile.role !== 'student' || !incident) return;
    const broadcast = latestBroadcastForStudent(events, profile.studentId);
    if (broadcast && broadcast.kind === 'all_clear' && broadcast.at > incident.activatedAt) {
      if (watchSubscriptionRef.current) {
        watchSubscriptionRef.current.remove();
        watchSubscriptionRef.current = null;
      }
      stopBackgroundLocation().catch(() => undefined);
      setIncident(null);
      setReports((current) => current.filter((r) => !r.studentLinked));
    }
  }, [events, profile, incident]);

  const activeIncidents = useMemo(() => deriveActiveIncidents(events), [events]);

  useEffect(() => {
    if (!profile) return;
    if (profile.role === 'parent') {
      const mine = activeIncidents.find((i) => i.studentId === profile.linkedStudentId);
      if (mine && lastNotifiedIncidentRef.current !== mine.id) {
        lastNotifiedIncidentRef.current = mine.id;
        fireLocalNotification(
          `${mine.studentName.split(' ')[0]} activated a beacon`,
          mine.zoneDescription ?? 'Approximate location shared with staff.',
        );
      }
      const broadcast = latestBroadcastForStudent(events, profile.linkedStudentId);
      if (broadcast && lastNotifiedBroadcastRef.current !== broadcast.id) {
        lastNotifiedBroadcastRef.current = broadcast.id;
        fireLocalNotification('Beacon5 update from staff', broadcast.message);
      }
      const latestNote = events
        .filter(
          (e): e is Extract<BeaconEvent, { type: 'INCIDENT_NOTE' }> =>
            e.type === 'INCIDENT_NOTE' && e.studentId === profile.linkedStudentId,
        )
        .slice(-1)[0];
      if (latestNote && lastNotifiedNoteRef.current !== latestNote.id) {
        lastNotifiedNoteRef.current = latestNote.id;
        const first = latestNote.studentName.split(' ')[0];
        fireLocalNotification(
          latestNote.kind === 'threat' ? `⚠️ ${first} flagged a threat` : `${first} needs medical`,
          latestNote.polishedNote,
          {
            subtitle: latestNote.kind === 'threat' ? 'Threat sighting' : 'Medical need',
            critical: true,
          },
        );
      }
    } else if (profile.role === 'student') {
      const broadcast = latestBroadcastForStudent(events, profile.studentId);
      if (broadcast && lastNotifiedBroadcastRef.current !== broadcast.id) {
        lastNotifiedBroadcastRef.current = broadcast.id;
        fireLocalNotification('Update from staff', broadcast.message);
      }
    } else if (profile.role === 'staff') {
      const last = activeIncidents[activeIncidents.length - 1];
      if (last && lastNotifiedIncidentRef.current !== last.id) {
        lastNotifiedIncidentRef.current = last.id;
        fireLocalNotification(
          `Beacon: ${last.studentName}`,
          last.zoneDescription ?? 'Active beacon on campus.',
        );
      }
    }

    // Mass broadcast notifications: fire only when the broadcast targets my role
    // and I'm not the one who sent it.
    const massRole: 'student' | 'parent' | 'staff' = profile.role;
    const senderIdForMe =
      profile.role === 'staff' ? profile.staffId : null;
    const latestMass = events
      .filter(
        (e): e is Extract<BeaconEvent, { type: 'MASS_BROADCAST' }> =>
          e.type === 'MASS_BROADCAST' &&
          massBroadcastIsForRole(e, massRole) &&
          e.senderId !== senderIdForMe,
      )
      .slice(-1)[0];
    if (latestMass && lastNotifiedMassRef.current !== latestMass.id) {
      lastNotifiedMassRef.current = latestMass.id;
      const audienceLabel =
        latestMass.audience === 'students'
          ? 'Students'
          : latestMass.audience === 'parents'
            ? 'Parents'
            : latestMass.audience === 'teachers'
              ? 'Teachers'
              : 'Everyone';
      fireLocalNotification(`${latestMass.senderName} (${audienceLabel})`, latestMass.message);
    }

    // Cross-role chat notifications: notify when the *other* side sends a message.
    const myRole: 'staff' | 'parent' | null =
      profile.role === 'staff' ? 'staff' : profile.role === 'parent' ? 'parent' : null;
    if (myRole) {
      const studentId =
        profile.role === 'parent' ? profile.linkedStudentId : null;
      const latestMessage = events
        .filter((e): e is Extract<BeaconEvent, { type: 'CHAT_MESSAGE' }> => {
          if (e.type !== 'CHAT_MESSAGE') return false;
          if (studentId && e.studentId !== studentId) return false;
          return e.sender !== myRole;
        })
        .slice(-1)[0];
      if (latestMessage && lastNotifiedChatRef.current !== latestMessage.id) {
        lastNotifiedChatRef.current = latestMessage.id;
        fireLocalNotification(latestMessage.senderName, latestMessage.message);
      }
    }
  }, [activeIncidents, events, profile]);

  const onSelectProfile = (next: Profile) => {
    setProfile(next);
    saveProfile(next).catch(() => undefined);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  };

  const onResetProfile = () => {
    setProfile(null);
    setIncident(null);
    setReports(seedReports);
    setStaffConfirmed(new Set());
    lastNotifiedBroadcastRef.current = null;
    lastNotifiedIncidentRef.current = null;
    clearProfile().catch(() => undefined);
  };

  const onWipeEvents = () => {
    setEvents([]);
    clearEvents().catch(() => undefined);
    lastNotifiedBroadcastRef.current = null;
    lastNotifiedIncidentRef.current = null;
  };

  const onAllClear = async (incidentEv: Extract<BeaconEvent, { type: 'BEACON_ACTIVATED' }>) => {
    setGeneratingBroadcast(true);
    try {
      const message = await generateAllClearBroadcast(
        incidentEv.studentName,
        zoneByKey(zones[0].key).title,
        incidentEv.coords,
        incidentEv.zoneDescription,
      );
      const broadcast: BeaconEvent = {
        type: 'STAFF_BROADCAST',
        id: `bcast-${Date.now()}`,
        studentId: incidentEv.studentId,
        message,
        kind: 'all_clear',
        at: Date.now(),
      };
      await appendEvent(broadcast);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } finally {
      setGeneratingBroadcast(false);
    }
  };

  const locationToken: LocationToken = incident ? 'active' : 'dormant';

  const verifications = useMemo(
    () => computeZoneVerifications(reports, staffConfirmed, now),
    [reports, staffConfirmed, now],
  );

  const activatePanic = async () => {
    if (!profile || profile.role !== 'student') return;
    const studentId = profile.studentId;
    const studentName = profile.studentName;

    const zone = zones[0];
    const id = `incident-${Date.now()}`;
    const newIncident: Incident = {
      id,
      zone,
      activatedAt: Date.now(),
      gpsStatus: 'requesting',
    };
    setIncident(newIncident);

    const report: Report = {
      id: `student-${Date.now()}`,
      zoneKey: zone.key,
      zoneTitle: zone.title,
      room: zone.room,
      status: 'safe',
      context: `${studentName} - beacon hold`,
      createdAt: Date.now(),
      x: zone.x,
      y: zone.y,
      studentLinked: true,
    };
    setReports((current) => [report, ...current.filter((r) => !r.studentLinked)]);

    let coords: Coords | null = null;
    let zoneDescription: string | undefined;
    let lastAcceptedAccuracy: number | null = null;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setIncident((cur) =>
          cur && cur.id === id ? { ...cur, gpsStatus: 'denied' } : cur,
        );
      } else {
        // Try last-known fix immediately so the map always shows SOMETHING.
        try {
          const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
          if (last) {
            coords = {
              latitude: last.coords.latitude,
              longitude: last.coords.longitude,
              accuracy: last.coords.accuracy ?? null,
            };
            lastAcceptedAccuracy = coords.accuracy;
            setIncident((cur) =>
              cur && cur.id === id ? { ...cur, coords: coords ?? undefined, gpsStatus: 'granted' } : cur,
            );
          }
        } catch {
          // ignore - we'll try a fresh fix
        }

        // Race a fresh fix against an 8s timeout. If timeout wins, we keep the last-known fix.
        const freshFix = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        if (freshFix) {
          const fresh: Coords = {
            latitude: freshFix.coords.latitude,
            longitude: freshFix.coords.longitude,
            accuracy: freshFix.coords.accuracy ?? null,
          };
          if (shouldAcceptFix(fresh.accuracy, lastAcceptedAccuracy)) {
            coords = fresh;
            lastAcceptedAccuracy = fresh.accuracy;
            setIncident((cur) =>
              cur && cur.id === id ? { ...cur, coords: fresh, gpsStatus: 'granted' } : cur,
            );
          }
        } else if (!coords) {
          // No last-known and fresh timed out — keep status as requesting; watcher below may still recover.
        }

        if (watchSubscriptionRef.current) {
          watchSubscriptionRef.current.remove();
          watchSubscriptionRef.current = null;
        }
        try {
          watchSubscriptionRef.current = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              timeInterval: 2500,
              distanceInterval: 1,
              mayShowUserSettingsDialog: true,
            },
            (update) => {
              const accuracy = update.coords.accuracy ?? null;
              if (!shouldAcceptFix(accuracy, lastAcceptedAccuracy)) return;
              lastAcceptedAccuracy = accuracy;
              const next: Coords = {
                latitude: update.coords.latitude,
                longitude: update.coords.longitude,
                accuracy,
              };
              setIncident((cur) =>
                cur && cur.id === id ? { ...cur, coords: next, gpsStatus: 'granted' } : cur,
              );
              appendEvent({
                type: 'LOCATION_UPDATE',
                id: `loc-${update.timestamp}-${Math.floor(Math.random() * 1000)}`,
                studentId,
                incidentId: id,
                coords: next,
                at: update.timestamp,
              });
            },
          );
        } catch {
          // continuous tracking failed, single fix remains
        }

        // Best-effort background tracking. No-op in Expo Go; works in EAS dev builds.
        startBackgroundLocation({
          studentId,
          studentName,
          incidentId: id,
          lastAccuracy: lastAcceptedAccuracy,
        }).catch(() => undefined);

        if (coords) {
          const description = await reverseGeocodeWithGemini(coords);
          if (description) {
            zoneDescription = description;
            setIncident((cur) =>
              cur && cur.id === id ? { ...cur, zoneDescription: description } : cur,
            );
          }
        }
      }
    } catch (err) {
      setIncident((cur) =>
        cur && cur.id === id
          ? { ...cur, gpsStatus: 'error', gpsError: String(err) }
          : cur,
      );
    }

    const beaconEvent: BeaconEvent = {
      type: 'BEACON_ACTIVATED',
      id,
      studentId,
      studentName,
      coords,
      zoneDescription,
      at: Date.now(),
    };
    await appendEvent(beaconEvent);
  };

  const resetBeacon = async () => {
    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.remove();
      watchSubscriptionRef.current = null;
    }
    stopBackgroundLocation().catch(() => undefined);
    setIncident(null);
    setReports((current) => current.filter((r) => !r.studentLinked));
    setEscalationSheet(null);
    if (profile?.role === 'student') {
      await appendEvent({
        type: 'BEACON_RESET',
        id: `reset-${Date.now()}`,
        studentId: profile.studentId,
        at: Date.now(),
      });
    }
  };

  const submitEscalation = async (kind: 'threat' | 'medical', note: string) => {
    if (!profile || profile.role !== 'student') return;
    const studentId = profile.studentId;
    const studentName = profile.studentName;

    setEscalationSheet(null);

    if (incident) {
      setIncident({
        ...incident,
        threatNote: kind === 'threat' ? note : incident.threatNote,
        medicalNote: kind === 'medical' ? note : incident.medicalNote,
      });
      const zone = incident.zone;
      const newReport: Report = {
        id: `escal-${kind}-${Date.now()}`,
        zoneKey: zone.key,
        zoneTitle: zone.title,
        room: zone.room,
        status: kind,
        context: note || (kind === 'threat' ? 'Threat sighting flagged' : 'Medical need flagged'),
        createdAt: Date.now(),
        x: zone.x + (Math.random() * 6 - 3),
        y: zone.y + (Math.random() * 6 - 3),
      };
      setReports((current) => [newReport, ...current]);
    }

    const polished = await polishIncidentNote(kind, note, studentName);
    await appendEvent({
      type: 'INCIDENT_NOTE',
      id: `note-${Date.now()}`,
      studentId,
      studentName,
      kind,
      rawNote: note,
      polishedNote: polished,
      at: Date.now(),
    });
  };

  const simulateNearbyReport = () => {
    const zoneKey = incident?.zone.key ?? 'west_wing';
    const zone = zoneByKey(zoneKey);
    const candidates: StatusKey[] = ['threat', 'medical', 'barricade'];
    const status = candidates[Math.floor(Math.random() * candidates.length)];
    const report: Report = {
      id: `sim-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      zoneKey: zone.key,
      zoneTitle: zone.title,
      room: zone.room,
      status,
      context: `${zone.title} zone - nearby ${statusMeta[status].short.toLowerCase()} signal`,
      createdAt: Date.now(),
      x: zone.x + (Math.random() * 8 - 4),
      y: zone.y + (Math.random() * 8 - 4),
    };
    setReports((current) => [report, ...current]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  };

  const markStaffConfirmed = (zoneKey: string) => {
    setStaffConfirmed((prev) => {
      const next = new Set(prev);
      next.add(zoneKey);
      return next;
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  };

  const metrics = useMemo(() => {
    return reports.reduce(
      (acc, report) => {
        acc[report.status] += 1;
        return acc;
      },
      { safe: 0, barricade: 0, medical: 0, threat: 0 } as Record<StatusKey, number>,
    );
  }, [reports]);

  if (!profileLoaded) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <LinearGradient colors={['#141414', '#050505', '#000000']} style={styles.root} />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <LinearGradient colors={['#141414', '#050505', '#000000']} style={styles.root}>
          <Onboarding onSelect={onSelectProfile} />
        </LinearGradient>
      </SafeAreaView>
    );
  }

  const studentLatestBroadcast =
    profile.role === 'student' ? latestBroadcastForStudent(events, profile.studentId) : null;
  const parentLatestBroadcast =
    profile.role === 'parent' ? latestBroadcastForStudent(events, profile.linkedStudentId) : null;
  const parentActiveIncident =
    profile.role === 'parent'
      ? activeIncidents.find((i) => i.studentId === profile.linkedStudentId) ?? null
      : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <LinearGradient colors={['#141414', '#050505', '#000000']} style={styles.root}>
        <Header
          mode={mode}
          locationToken={mode === 'parent' && parentActiveIncident ? 'active' : locationToken}
          profile={profile}
          onSignOut={onResetProfile}
          notifPermitted={notifPermitted}
        />
        {mode === 'student' ? (
          <StudentMode
            profile={profile as Extract<Profile, { role: 'student' }>}
            incident={incident}
            locationToken={locationToken}
            broadcast={studentLatestBroadcast}
            events={events}
            now={now}
            onActivate={activatePanic}
            onReset={resetBeacon}
            onOpenEscalation={setEscalationSheet}
          />
        ) : null}
        {mode === 'staff' ? (
          <StaffMode
            profile={profile as Extract<Profile, { role: 'staff' }>}
            metrics={metrics}
            reports={reports}
            verifications={verifications}
            incident={incident}
            now={now}
            activeIncidents={activeIncidents}
            events={events}
            generatingBroadcast={generatingBroadcast}
            onSimulate={simulateNearbyReport}
            onMarkConfirmed={markStaffConfirmed}
            onAllClear={onAllClear}
            onWipeEvents={onWipeEvents}
          />
        ) : null}
        {mode === 'parent' ? (
          <ParentMode
            profile={profile as Extract<Profile, { role: 'parent' }>}
            verifications={verifications}
            now={now}
            activeIncident={parentActiveIncident}
            broadcast={parentLatestBroadcast}
            events={events}
            activeIncidents={activeIncidents}
          />
        ) : null}
      </LinearGradient>
      <EscalationSheet
        kind={escalationSheet}
        visible={escalationSheet !== null}
        onClose={() => setEscalationSheet(null)}
        onSubmit={submitEscalation}
      />
    </SafeAreaView>
  );
}

function Onboarding({ onSelect }: { onSelect: (p: Profile) => void }) {
  const [step, setStep] = useState<'role' | 'student' | 'staff' | 'parent'>('role');

  if (step === 'role') {
    return (
      <ScrollView contentContainerStyle={styles.onboardScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.onboardHero}>
          <View style={styles.onboardBadge}>
            <Shield size={28} color="#f3f4f6" strokeWidth={2.4} />
          </View>
          <Text style={styles.onboardEyebrow}>BEACON5</Text>
          <Text style={styles.onboardTitle}>Welcome. Who are you?</Text>
          <Text style={styles.onboardCopy}>
            Beacon5 unlocks different tools depending on your role on campus. This choice stays on
            this device and can be changed anytime by tapping the sign-out icon in the header.
          </Text>
        </View>

        <RoleCard
          icon={GraduationCap}
          color="#fb7185"
          title="I'm a Student"
          subtitle="Hold the beacon during an emergency. Stay hidden, stay tracked, stay safe."
          onPress={() => setStep('student')}
        />
        <RoleCard
          icon={BookOpen}
          color="#fbbf24"
          title="I'm a Teacher / Staff"
          subtitle="Open Mission Control. Verify clusters, confirm zones, coordinate response."
          onPress={() => setStep('staff')}
        />
        <RoleCard
          icon={UsersRound}
          color="#7dd3fc"
          title="I'm a Parent / Guardian"
          subtitle="Link to your student. Receive verified updates during incidents only."
          onPress={() => setStep('parent')}
        />

        <Text style={styles.onboardFootnote}>
          Beacon5 only shares your location when you hold the beacon. No continuous tracking.
        </Text>
      </ScrollView>
    );
  }

  if (step === 'student') {
    return (
      <RosterPicker
        title="Choose your student profile"
        subtitle="Tap your name to sign in as that student."
        onBack={() => setStep('role')}
        items={studentRoster.map((s) => ({
          id: s.id,
          primary: s.name,
          secondary: `Grade ${s.grade}`,
          icon: User,
        }))}
        onPick={(id) => {
          const s = studentRoster.find((x) => x.id === id);
          if (s) onSelect({ role: 'student', studentId: s.id, studentName: s.name });
        }}
      />
    );
  }

  if (step === 'staff') {
    return (
      <RosterPicker
        title="Choose your staff profile"
        subtitle="Tap your role to sign in to Mission Control."
        onBack={() => setStep('role')}
        items={staffRoster.map((s) => ({
          id: s.id,
          primary: s.name,
          secondary: s.title,
          icon: BookOpen,
        }))}
        onPick={(id) => {
          const s = staffRoster.find((x) => x.id === id);
          if (s) onSelect({ role: 'staff', staffId: s.id, staffName: s.name, staffTitle: s.title });
        }}
      />
    );
  }

  return (
    <RosterPicker
      title="Link to your student"
      subtitle="Pick the student you are the guardian for. You will only see their alerts."
      onBack={() => setStep('role')}
      items={studentRoster.map((s) => ({
        id: s.id,
        primary: s.name,
        secondary: `Grade ${s.grade}`,
        icon: GraduationCap,
      }))}
      onPick={(id) => {
        const s = studentRoster.find((x) => x.id === id);
        if (s) onSelect({ role: 'parent', linkedStudentId: s.id, linkedStudentName: s.name });
      }}
    />
  );
}

function RoleCard({
  icon: Icon,
  color,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  color: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.roleCard,
        { borderColor: `${color}66` },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.roleCardIcon, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
        <Icon color={color} size={24} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.roleCardTitle}>{title}</Text>
        <Text style={styles.roleCardSubtitle}>{subtitle}</Text>
      </View>
      <ChevronRight color="#9ca3af" size={20} />
    </Pressable>
  );
}

function RosterPicker({
  title,
  subtitle,
  items,
  onBack,
  onPick,
}: {
  title: string;
  subtitle: string;
  items: Array<{
    id: string;
    primary: string;
    secondary: string;
    icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  }>;
  onBack: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.onboardScroll} showsVerticalScrollIndicator={false}>
      <Pressable onPress={onBack} style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}>
        <ChevronRight color="#9ca3af" size={16} style={{ transform: [{ rotate: '180deg' }] }} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <View style={styles.onboardHero}>
        <Text style={styles.onboardTitle}>{title}</Text>
        <Text style={styles.onboardCopy}>{subtitle}</Text>
      </View>

      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Pressable
            key={item.id}
            onPress={() => onPick(item.id)}
            style={({ pressed }) => [styles.rosterRow, pressed && styles.pressed]}
          >
            <View style={styles.rosterIcon}>
              <Icon color="#e5e5ea" size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rosterPrimary}>{item.primary}</Text>
              <Text style={styles.rosterSecondary}>{item.secondary}</Text>
            </View>
            <ChevronRight color="#9ca3af" size={20} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Header({
  mode,
  locationToken,
  profile,
  onSignOut,
  notifPermitted,
}: {
  mode: Mode;
  locationToken: LocationToken;
  profile: Profile;
  onSignOut: () => void;
  notifPermitted?: boolean;
}) {
  const identity =
    profile.role === 'student'
      ? profile.studentName
      : profile.role === 'staff'
        ? `${profile.staffName} - ${profile.staffTitle}`
        : `Guardian of ${profile.linkedStudentName}`;
  const subtitle =
    mode === 'student'
      ? 'Campus Grid - San Jose High'
      : mode === 'staff'
        ? 'Mission Control - Live'
        : 'Parent Verification Secure';

  const tokenColor = locationToken === 'active' ? '#fb7185' : '#8ee7ff';

  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <View style={styles.brandIcon}>
          <Shield size={19} color="#f3f4f6" strokeWidth={2.4} />
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.brandText}>BEACON5</Text>
          <Text style={styles.brandSub} numberOfLines={1}>
            {identity}
          </Text>
          <Text style={[styles.brandSub, { color: '#7d7d83' }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={onSignOut} style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}>
          <LogOut color="#cfc4c5" size={14} />
        </Pressable>
        <LinearGradient colors={['#08313a', '#1f2937']} style={[styles.avatar, { borderColor: tokenColor }]}>
          <Radio size={16} color={tokenColor} />
        </LinearGradient>
      </View>
    </View>
  );
}

// =====================================================================
// STUDENT MODE
// =====================================================================
function StudentMode({
  profile,
  incident,
  broadcast,
  events,
  now,
  onActivate,
  onReset,
  onOpenEscalation,
}: {
  profile: Extract<Profile, { role: 'student' }>;
  incident: Incident | null;
  locationToken: LocationToken;
  broadcast: Extract<BeaconEvent, { type: 'STAFF_BROADCAST' }> | null;
  events: BeaconEvent[];
  now: number;
  onActivate: () => void;
  onReset: () => void;
  onOpenEscalation: (k: 'threat' | 'medical') => void;
}) {
  if (incident) {
    return (
      <SurvivalAnchor
        profile={profile}
        incident={incident}
        broadcast={broadcast}
        events={events}
        now={now}
        onReset={onReset}
        onOpenEscalation={onOpenEscalation}
      />
    );
  }
  return <StudentDormant events={events} now={now} onActivate={onActivate} />;
}

function StudentDormant({
  events,
  now,
  onActivate,
}: {
  events: BeaconEvent[];
  now: number;
  onActivate: () => void;
}) {
  const [massCollapsed, setMassCollapsed] = useState(false);
  const broadcasts = massBroadcastsFor(events, 'student');
  return (
    <ScrollView
      contentContainerStyle={styles.studentDormantScroll}
      showsVerticalScrollIndicator={false}
    >
      {broadcasts.length > 0 ? (
        <View style={{ width: '100%' }}>
          <MassBroadcastList
            broadcasts={broadcasts}
            now={now}
            collapsed={massCollapsed}
            onToggle={() => setMassCollapsed((c) => !c)}
          />
        </View>
      ) : null}
      <View style={styles.studentDormantCenter}>
        <HoldToActivate onComplete={onActivate} />
        <Text style={styles.holdHintTight}>Hold 1 second to alert staff & your guardian</Text>
      </View>
    </ScrollView>
  );
}

function HoldToActivate({ onComplete }: { onComplete: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);
  const [holding, setHolding] = useState(false);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const sub = progress.addListener(({ value }) => setPct(value));
    return () => progress.removeListener(sub);
  }, [progress]);

  const stopTicks = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const startHold = () => {
    completedRef.current = false;
    setHolding(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    progress.setValue(0);
    animationRef.current = Animated.timing(progress, {
      toValue: 1,
      duration: 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    animationRef.current.start(({ finished }) => {
      if (finished && !completedRef.current) {
        completedRef.current = true;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => undefined,
        );
        stopTicks();
        setHolding(false);
        onComplete();
      }
    });
    stopTicks();
    tickRef.current = setInterval(() => {
      Haptics.selectionAsync().catch(() => undefined);
    }, 280);
  };

  const cancelHold = () => {
    if (completedRef.current) return;
    setHolding(false);
    if (animationRef.current) animationRef.current.stop();
    stopTicks();
    Animated.timing(progress, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  };

  useEffect(() => {
    return () => {
      stopTicks();
      if (animationRef.current) animationRef.current.stop();
    };
  }, []);

  const radius = 118;
  const stroke = 10;
  const size = (radius + stroke) * 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });
  const AnimatedCircle = Animated.createAnimatedComponent(Circle);

  const ringColor = holding ? '#ef4444' : '#fb7185';
  const innerColor = holding ? 'rgba(239, 68, 68, 0.18)' : 'rgba(239, 68, 68, 0.08)';

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(239, 68, 68, 0.18)"
          strokeWidth={stroke}
          fill="transparent"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ringColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          fill="transparent"
          rotation={-90}
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
      <Pressable
        onPressIn={startHold}
        onPressOut={cancelHold}
        style={({ pressed }) => [
          styles.holdButton,
          {
            backgroundColor: innerColor,
            borderColor: ringColor,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          },
        ]}
      >
        <View style={styles.holdInnerHalo}>
          <Siren color="#fecaca" size={42} strokeWidth={2.1} />
        </View>
        <Text style={styles.holdTitle}>HOLD TO ACTIVATE</Text>
        <Text style={styles.holdSubtitle}>BEACON</Text>
        <Text style={styles.holdProgressLabel}>
          {holding ? `${Math.round(pct * 100)}%` : '1 second hold'}
        </Text>
      </Pressable>
    </View>
  );
}

function SurvivalAnchor({
  profile,
  incident,
  broadcast,
  events,
  now,
  onReset,
  onOpenEscalation,
}: {
  profile: Extract<Profile, { role: 'student' }>;
  incident: Incident;
  broadcast: Extract<BeaconEvent, { type: 'STAFF_BROADCAST' }> | null;
  events: BeaconEvent[];
  now: number;
  onReset: () => void;
  onOpenEscalation: (k: 'threat' | 'medical') => void;
}) {
  const first = profile.studentName.split(' ')[0];
  const path = pathForStudentIncident(events, profile.studentId, incident.id);
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      style={{ flex: 1 }}
    >
    <ScrollView
      contentContainerStyle={styles.simpleContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View style={styles.studentHero}>
        <View style={styles.studentHeroHalo}>
          <Siren color="#ef4444" size={48} strokeWidth={2.4} />
        </View>
        <Text style={styles.studentHeroTitle}>Help is coming, {first}.</Text>
        <Text style={styles.studentHeroSub}>
          Staff and your guardian received your signal. Stay low and quiet.
        </Text>
      </View>

      {broadcast ? <BroadcastCard broadcast={broadcast} /> : null}

      {massBroadcastsFor(events, 'student').length > 0 ? (
        <MassBroadcastList
          broadcasts={massBroadcastsFor(events, 'student')}
          now={now}
          collapsed={false}
          onToggle={() => undefined}
        />
      ) : null}

      <MiniMap coords={incident.coords ?? null} label="You" path={path} />
      <TrackingStats path={path} startedAt={incident.activatedAt} now={now} />

      <View style={styles.tipsRow}>
        <Tip num="1" text="Get low. Stay away from doors and windows." />
        <Tip num="2" text="Silence your phone." />
        <Tip num="3" text="Wait for staff. Do not move." />
      </View>

      <View style={styles.escalRow}>
        <EscalationChip
          label="I see threat"
          icon={Eye}
          accent="#ef4444"
          flagged={Boolean(incident.threatNote)}
          onPress={() => onOpenEscalation('threat')}
        />
        <EscalationChip
          label="Medical"
          icon={HeartPulse}
          accent="#3b82f6"
          flagged={Boolean(incident.medicalNote)}
          onPress={() => onOpenEscalation('medical')}
        />
      </View>

      <Pressable style={styles.resetGhost} onPress={onReset}>
        <Text style={styles.resetGhostText}>All clear - reset beacon</Text>
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Tip({ num, text }: { num: string; text: string }) {
  return (
    <View style={styles.tipCard}>
      <View style={styles.tipNum}>
        <Text style={styles.tipNumText}>{num}</Text>
      </View>
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

function BroadcastCard({
  broadcast,
}: {
  broadcast: Extract<BeaconEvent, { type: 'STAFF_BROADCAST' }>;
}) {
  const accent = broadcast.kind === 'all_clear' ? '#22c55e' : '#7dd3fc';
  return (
    <View style={[styles.broadcastCard, { borderColor: `${accent}66`, backgroundColor: `${accent}14` }]}>
      <View style={[styles.broadcastBadge, { backgroundColor: `${accent}33`, borderColor: `${accent}88` }]}>
        <Sparkles color={accent} size={18} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.broadcastLabel, { color: accent }]}>
          {broadcast.kind === 'all_clear' ? 'ALL CLEAR - STAFF UPDATE' : 'STAFF UPDATE'}
        </Text>
        <Text style={styles.broadcastMessage}>{broadcast.message}</Text>
      </View>
    </View>
  );
}

function MiniMap({
  coords,
  label,
  height,
  path,
}: {
  coords: Coords | null;
  label: string;
  height?: number;
  path?: Coords[];
}) {
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.miniMapWeb, { height: height ?? 200 }]}>
        <MapPin color="#7dd3fc" size={22} />
        <Text style={styles.miniMapWebTitle}>Map renders on phone</Text>
        {coords ? (
          <Text style={styles.miniMapWebCoords}>
            {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
          </Text>
        ) : null}
        {path && path.length > 1 ? (
          <Text style={styles.miniMapWebCoords}>
            {path.length} GPS steps, {Math.round(totalDistanceMeters(path))}m moved
          </Text>
        ) : null}
      </View>
    );
  }
  if (!coords) {
    return (
      <View style={[styles.miniMapEmpty, { height: height ?? 180 }]}>
        <Radio color="#7dd3fc" size={22} />
        <Text style={styles.miniMapEmptyText}>Waiting for GPS...</Text>
      </View>
    );
  }
  const polyPath = path && path.length > 1 ? path : null;
  const start = polyPath?.[0];
  return (
    <View style={[styles.miniMapWrap, { height: height ?? 220 }]}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: coords.latitude,
          longitude: coords.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
      >
        {polyPath ? (
          <Polyline
            coordinates={polyPath.map((c) => ({ latitude: c.latitude, longitude: c.longitude }))}
            strokeColor="#fb7185"
            strokeWidth={4}
          />
        ) : null}
        {start ? (
          <Marker
            coordinate={{ latitude: start.latitude, longitude: start.longitude }}
            title="Beacon start"
            pinColor="#fbbf24"
          />
        ) : null}
        <Marker
          coordinate={{ latitude: coords.latitude, longitude: coords.longitude }}
          title={label}
          description="Live position"
          pinColor="#ef4444"
        />
      </MapView>
      <View style={styles.miniMapPill}>
        <MapPin color="#fff" size={11} />
        <Text style={styles.miniMapPillText}>{label}</Text>
      </View>
    </View>
  );
}

type FleetBeacon = {
  studentId: string;
  studentName: string;
  coords: Coords;
  isThreat: boolean;
  isMedical: boolean;
  path: Coords[];
};

function FleetMap({
  beacons,
  height,
  focusStudentId,
}: {
  beacons: FleetBeacon[];
  height?: number;
  focusStudentId?: string | null;
}) {
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.miniMapWeb, { height: height ?? 220 }]}>
        <MapPin color="#7dd3fc" size={22} />
        <Text style={styles.miniMapWebTitle}>Live fleet map renders on phone</Text>
        <Text style={styles.miniMapWebCoords}>{beacons.length} active beacon{beacons.length === 1 ? '' : 's'}</Text>
      </View>
    );
  }
  if (beacons.length === 0) {
    return (
      <View style={[styles.miniMapEmpty, { height: height ?? 200 }]}>
        <ShieldCheck color="#86efac" size={24} />
        <Text style={styles.miniMapEmptyText}>No active beacons on campus.</Text>
      </View>
    );
  }
  const focal =
    (focusStudentId && beacons.find((b) => b.studentId === focusStudentId)) ||
    beacons.find((b) => b.isThreat) ||
    beacons[beacons.length - 1];

  return (
    <View style={[styles.miniMapWrap, { height: height ?? 280 }]}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: focal.coords.latitude,
          longitude: focal.coords.longitude,
          latitudeDelta: 0.006,
          longitudeDelta: 0.006,
        }}
      >
        {beacons.map((b) => (
          <Fragment key={b.studentId}>
            {b.path.length > 1 ? (
              <Polyline
                coordinates={b.path.map((c) => ({ latitude: c.latitude, longitude: c.longitude }))}
                strokeColor={b.isThreat ? '#fbbf24' : '#fb7185'}
                strokeWidth={4}
              />
            ) : null}
            <Marker
              coordinate={{ latitude: b.coords.latitude, longitude: b.coords.longitude }}
              title={b.studentName}
              description={
                b.isThreat
                  ? 'Threat flagged - hazard nearby'
                  : b.isMedical
                    ? 'Medical need flagged'
                    : 'Live beacon'
              }
              tracksViewChanges={false}
            >
              <View
                style={[
                  styles.fleetMarker,
                  b.isThreat
                    ? { backgroundColor: '#fbbf24', borderColor: '#92400e' }
                    : b.isMedical
                      ? { backgroundColor: '#3b82f6', borderColor: '#1e40af' }
                      : { backgroundColor: '#ef4444', borderColor: '#7f1d1d' },
                ]}
              >
                {b.isThreat ? (
                  <AlertTriangle color="#1f1300" size={16} strokeWidth={3} />
                ) : b.isMedical ? (
                  <HeartPulse color="#dbeafe" size={16} strokeWidth={3} />
                ) : (
                  <Siren color="#fff" size={14} strokeWidth={3} />
                )}
              </View>
            </Marker>
          </Fragment>
        ))}
      </MapView>
      <View style={styles.miniMapPill}>
        <MapPin color="#fff" size={11} />
        <Text style={styles.miniMapPillText}>
          {beacons.length} active{beacons.some((b) => b.isThreat) ? ' - threat focal' : ''}
        </Text>
      </View>
    </View>
  );
}

function buildFleetBeacons(
  events: BeaconEvent[],
  activeIncidents: Array<Extract<BeaconEvent, { type: 'BEACON_ACTIVATED' }>>,
): FleetBeacon[] {
  return activeIncidents
    .filter((i): i is Extract<BeaconEvent, { type: 'BEACON_ACTIVATED' }> & { coords: Coords } =>
      Boolean(i.coords),
    )
    .map((i) => {
      const notes = notesForStudent(events, i.studentId, i.at);
      return {
        studentId: i.studentId,
        studentName: i.studentName,
        coords: i.coords!,
        isThreat: notes.some((n) => n.kind === 'threat'),
        isMedical: notes.some((n) => n.kind === 'medical'),
        path: pathForStudentIncident(events, i.studentId, i.id),
      };
    });
}

function ChatPanel({
  messages,
  meSender,
  meName,
  studentId,
  peerLabel,
  now,
  collapsed,
  onToggle,
}: {
  messages: Array<Extract<BeaconEvent, { type: 'CHAT_MESSAGE' }>>;
  meSender: 'staff' | 'parent';
  meName: string;
  studentId: string;
  peerLabel: string;
  now: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [draft, setDraft] = useState('');
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    Keyboard.dismiss();
    Haptics.selectionAsync().catch(() => undefined);
    await sendChatMessage(meSender, meName, studentId, text);
  };
  return (
    <View style={styles.chatPanel}>
      <Pressable onPress={onToggle} style={styles.chatHeader}>
        <Text style={styles.chatHeaderTitle}>{peerLabel}</Text>
        <Text style={styles.chatHeaderToggle}>{collapsed ? 'SHOW' : 'HIDE'}</Text>
      </Pressable>
      {collapsed ? null : (
        <View style={styles.chatBody}>
          {messages.length === 0 ? (
            <Text style={styles.chatEmpty}>No messages yet. Say hi - they'll get it instantly.</Text>
          ) : (
            messages.slice(-6).map((m) => {
              const mine = m.sender === meSender;
              return (
                <View
                  key={m.id}
                  style={[
                    styles.chatBubble,
                    mine ? styles.chatBubbleMe : styles.chatBubbleThem,
                  ]}
                >
                  {!mine ? (
                    <Text style={styles.chatSender}>{m.senderName}</Text>
                  ) : null}
                  <Text style={mine ? styles.chatTextMe : styles.chatTextThem}>{m.message}</Text>
                  <Text style={mine ? styles.chatTimeMe : styles.chatTimeThem}>
                    {formatRelativeTime(m.at, now)}
                  </Text>
                </View>
              );
            })
          )}
          <View style={styles.chatInputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={`Message ${peerLabel.toLowerCase()}...`}
              placeholderTextColor="#71717a"
              style={styles.chatInput}
              multiline
              maxLength={400}
            />
            <Pressable
              onPress={send}
              disabled={!draft.trim()}
              style={({ pressed }) => [
                styles.chatSendButton,
                { opacity: draft.trim() ? 1 : 0.4 },
                pressed && draft.trim() && styles.pressed,
              ]}
            >
              <Text style={styles.chatSendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function MassComposer({
  senderId,
  senderName,
}: {
  senderId: string;
  senderName: string;
}) {
  const [audience, setAudience] = useState<
    'students' | 'parents' | 'teachers' | 'everyone'
  >('everyone');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    Keyboard.dismiss();
    try {
      await sendMassBroadcast(senderId, senderName, audience, draft);
      setDraft('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } finally {
      setSending(false);
    }
  };

  const audiences: Array<{
    key: 'students' | 'parents' | 'teachers' | 'everyone';
    label: string;
  }> = [
    { key: 'students', label: 'Students' },
    { key: 'parents', label: 'Parents' },
    { key: 'teachers', label: 'Teachers' },
    { key: 'everyone', label: 'Everyone' },
  ];

  return (
    <View style={styles.massComposer}>
      <View style={styles.massComposerHeader}>
        <View style={styles.massComposerBadge}>
          <Megaphone color="#fde68a" size={16} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.massComposerTitle}>ADMIN MASS BROADCAST</Text>
          <Text style={styles.massComposerSub}>Live to whoever you pick. Use sparingly.</Text>
        </View>
      </View>

      <View style={styles.massAudienceRow}>
        {audiences.map((a) => {
          const on = audience === a.key;
          return (
            <Pressable
              key={a.key}
              onPress={() => {
                setAudience(a.key);
                Haptics.selectionAsync().catch(() => undefined);
              }}
              style={({ pressed }) => [
                styles.massAudienceChip,
                on
                  ? { borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.18)' }
                  : { borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(20,20,22,0.6)' },
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.massAudienceText,
                  { color: on ? '#fde68a' : '#a1a1aa' },
                ]}
              >
                {a.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.chatInputRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Type your campus-wide update..."
          placeholderTextColor="#71717a"
          style={styles.chatInput}
          multiline
          maxLength={400}
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim() || sending}
          style={({ pressed }) => [
            styles.chatSendButton,
            { backgroundColor: '#fbbf24', opacity: draft.trim() && !sending ? 1 : 0.4 },
            pressed && draft.trim() && !sending && styles.pressed,
          ]}
        >
          <Text style={[styles.chatSendText, { color: '#1f1300' }]}>
            {sending ? '...' : 'Send'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function MassBroadcastList({
  broadcasts,
  now,
  collapsed,
  onToggle,
}: {
  broadcasts: Array<Extract<BeaconEvent, { type: 'MASS_BROADCAST' }>>;
  now: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const recent = broadcasts.slice().reverse().slice(0, 5);
  return (
    <View style={styles.massListPanel}>
      <Pressable onPress={onToggle} style={styles.chatHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Megaphone color="#fde68a" size={14} />
          <Text style={styles.chatHeaderTitle}>Mass updates from admin ({broadcasts.length})</Text>
        </View>
        <Text style={[styles.chatHeaderToggle, { color: '#fde68a' }]}>
          {collapsed ? 'SHOW' : 'HIDE'}
        </Text>
      </Pressable>
      {collapsed ? null : (
        <View style={styles.massListBody}>
          {recent.length === 0 ? (
            <Text style={styles.chatEmpty}>No admin broadcasts yet.</Text>
          ) : (
            recent.map((b) => (
              <View key={b.id} style={styles.massListRow}>
                <View style={styles.massAudienceTag}>
                  <Text style={styles.massAudienceTagText}>
                    {b.audience === 'both' ? 'EVERYONE' : b.audience.toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={styles.massListSender}>{b.senderName}</Text>
                    <Text style={styles.feedTime}>{formatRelativeTime(b.at, now)}</Text>
                  </View>
                  <Text style={styles.massListMessage}>{b.message}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

function ThreatsList({
  events,
  activeIncidents,
  now,
  collapsed,
  onToggle,
}: {
  events: BeaconEvent[];
  activeIncidents: Array<Extract<BeaconEvent, { type: 'BEACON_ACTIVATED' }>>;
  now: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const notes = events.filter(
    (e): e is Extract<BeaconEvent, { type: 'INCIDENT_NOTE' }> => e.type === 'INCIDENT_NOTE',
  );
  const activeIds = new Set(activeIncidents.map((i) => i.studentId));
  const relevant = notes.filter((n) => activeIds.has(n.studentId)).slice().reverse();
  const threatCount = relevant.filter((n) => n.kind === 'threat').length;
  const medicalCount = relevant.filter((n) => n.kind === 'medical').length;
  return (
    <View style={styles.threatsPanel}>
      <Pressable onPress={onToggle} style={styles.threatsHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <AlertTriangle color="#fbbf24" size={16} />
          <Text style={styles.threatsTitle}>All threats & medical ({relevant.length})</Text>
        </View>
        <Text style={styles.chatHeaderToggle}>{collapsed ? 'SHOW' : 'HIDE'}</Text>
      </Pressable>
      {collapsed ? (
        <View style={styles.threatsSummaryRow}>
          <Text style={[styles.threatsSummaryItem, { color: '#fbbf24' }]}>
            {threatCount} threat{threatCount === 1 ? '' : 's'}
          </Text>
          <Text style={[styles.threatsSummaryItem, { color: '#7dd3fc' }]}>
            {medicalCount} medical
          </Text>
        </View>
      ) : (
        <View style={styles.threatsBody}>
          {relevant.length === 0 ? (
            <Text style={styles.chatEmpty}>No threats or medical notes reported yet.</Text>
          ) : (
            relevant.map((n) => {
              const accent = n.kind === 'threat' ? '#fbbf24' : '#7dd3fc';
              const Icon = n.kind === 'threat' ? AlertTriangle : HeartPulse;
              return (
                <View
                  key={n.id}
                  style={[
                    styles.threatRow,
                    { borderLeftColor: accent },
                  ]}
                >
                  <View style={[styles.threatIcon, { backgroundColor: `${accent}22`, borderColor: `${accent}66` }]}>
                    <Icon color={accent} size={14} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.threatRowName}>{n.studentName}</Text>
                      <Text style={styles.feedTime}>{formatRelativeTime(n.at, now)}</Text>
                    </View>
                    <Text style={styles.threatRowText}>{n.polishedNote}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

function TrackingStats({
  path,
  startedAt,
  now,
}: {
  path: Coords[];
  startedAt: number;
  now: number;
}) {
  if (path.length < 1) return null;
  const distance = Math.round(totalDistanceMeters(path));
  const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const last = path[path.length - 1];
  const sinceLast = path.length > 1
    ? Math.round(haversineMeters(path[path.length - 2], last))
    : 0;
  return (
    <View style={styles.trackStatRow}>
      <View style={styles.trackStat}>
        <Text style={styles.trackStatLabel}>STEPS</Text>
        <Text style={styles.trackStatValue}>{path.length}</Text>
        <Text style={styles.trackStatSub}>GPS pings</Text>
      </View>
      <View style={styles.trackStat}>
        <Text style={styles.trackStatLabel}>DISTANCE</Text>
        <Text style={styles.trackStatValue}>{distance}m</Text>
        <Text style={styles.trackStatSub}>+{sinceLast}m last</Text>
      </View>
      <View style={styles.trackStat}>
        <Text style={styles.trackStatLabel}>ELAPSED</Text>
        <Text style={styles.trackStatValue}>
          {elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`}
        </Text>
        <Text style={styles.trackStatSub}>since beacon</Text>
      </View>
    </View>
  );
}

function EscalationChip({
  label,
  icon: Icon,
  accent,
  flagged,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  accent: string;
  flagged: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.escalChip,
        {
          borderColor: flagged ? accent : 'rgba(255,255,255,0.16)',
          backgroundColor: flagged ? `${accent}22` : 'rgba(20,20,22,0.74)',
        },
        pressed && styles.pressed,
      ]}
    >
      <Icon color={flagged ? accent : '#e5e5ea'} size={22} />
      <Text style={[styles.escalChipText, flagged && { color: accent }]}>{label}</Text>
      {flagged ? <CheckCircle2 color={accent} size={16} /> : null}
    </Pressable>
  );
}

function NoteCard({ label, text, accent }: { label: string; text: string; accent: string }) {
  return (
    <GlassPanel style={[styles.noteCard, { borderLeftColor: accent }]}>
      <Text style={[styles.noteLabel, { color: accent }]}>{label}</Text>
      <Text style={styles.noteText}>{text}</Text>
    </GlassPanel>
  );
}

// =====================================================================
// STAFF MODE
// =====================================================================
function StaffMode({
  profile,
  now,
  activeIncidents,
  events,
  generatingBroadcast,
  onAllClear,
  onWipeEvents,
}: {
  profile: Extract<Profile, { role: 'staff' }>;
  metrics: Record<StatusKey, number>;
  reports: Report[];
  verifications: Map<string, VerificationState>;
  incident: Incident | null;
  now: number;
  activeIncidents: Array<Extract<BeaconEvent, { type: 'BEACON_ACTIVATED' }>>;
  events: BeaconEvent[];
  generatingBroadcast: boolean;
  onSimulate: () => void;
  onMarkConfirmed: (zoneKey: string) => void;
  onAllClear: (incident: Extract<BeaconEvent, { type: 'BEACON_ACTIVATED' }>) => Promise<void>;
  onWipeEvents: () => void;
}) {
  const top = activeIncidents[activeIncidents.length - 1] ?? null;
  const [geminiText, setGeminiText] = useState<string | null>(null);
  const [threatsCollapsed, setThreatsCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [massCollapsed, setMassCollapsed] = useState(true);
  const staffMassBroadcasts = massBroadcastsFor(events, 'staff');

  useEffect(() => {
    const controller = new AbortController();
    if (!top) {
      setGeminiText(null);
      return () => controller.abort();
    }
    const prompt = `You are the calm campus safety commander brief. ONE sentence (max 22 words). State who activated a beacon, where, and the single next operational step staff should take. Do NOT mention 911/police/EMS.

Student: ${top.studentName}
GPS: ${top.coords ? `${top.coords.latitude.toFixed(5)}, ${top.coords.longitude.toFixed(5)}` : 'unavailable'}
Area: ${top.zoneDescription ?? 'unknown'}

Output ONLY the brief sentence.`;
    const timer = setTimeout(() => {
      callGemini(prompt, controller.signal).then((text) => {
        if (!controller.signal.aborted) setGeminiText(text);
      });
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [top?.id, top?.zoneDescription, top?.coords?.latitude, top?.coords?.longitude]);

  const lastName = profile.staffName.split(' ').slice(-1)[0];
  const broadcastsForTop =
    top ? events.filter((e) => e.type === 'STAFF_BROADCAST' && e.studentId === top.studentId).length : 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      style={{ flex: 1 }}
    >
    <ScrollView
      contentContainerStyle={styles.simpleContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {top ? (
        <View style={styles.staffActiveCard}>
          <View style={styles.staffActiveAvatar}>
            <Siren color="#fecaca" size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.staffActiveName}>{top.studentName}</Text>
            <Text style={styles.staffActiveSub}>
              {top.zoneDescription ?? 'Beacon active - GPS pending'}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.staffEmptyCard}>
          <ShieldCheck color="#86efac" size={24} />
          <View style={{ flex: 1 }}>
            <Text style={styles.staffEmptyTitle}>Campus calm</Text>
            <Text style={styles.staffEmptySub}>No active beacons. Cmdr {lastName} on watch.</Text>
          </View>
        </View>
      )}

      <FleetMap
        beacons={buildFleetBeacons(events, activeIncidents)}
        height={280}
        focusStudentId={top?.studentId ?? null}
      />
      {top ? (
        <TrackingStats
          path={pathForStudentIncident(events, top.studentId, top.id)}
          startedAt={top.at}
          now={now}
        />
      ) : null}

      {top ? (
        <View style={styles.staffAiCard}>
          <Text style={styles.staffAiLabel}>GEMINI BRIEF</Text>
          <Text style={styles.staffAiText}>
            {geminiText ??
              `${top.studentName} activated a beacon. Verify on-site before any broadcast.`}
          </Text>
        </View>
      ) : null}

      <ThreatsList
        events={events}
        activeIncidents={activeIncidents}
        now={now}
        collapsed={threatsCollapsed}
        onToggle={() => setThreatsCollapsed((c) => !c)}
      />

      <MassComposer senderId={profile.staffId} senderName={profile.staffName} />

      <MassBroadcastList
        broadcasts={staffMassBroadcasts}
        now={now}
        collapsed={massCollapsed}
        onToggle={() => setMassCollapsed((c) => !c)}
      />

      {top ? (
        <Pressable
          onPress={() => onAllClear(top)}
          disabled={generatingBroadcast}
          style={({ pressed }) => [
            styles.allClearButton,
            generatingBroadcast && styles.allClearDisabled,
            pressed && styles.pressed,
          ]}
        >
          <ShieldCheck color="#03210d" size={22} />
          <Text style={styles.allClearText}>
            {generatingBroadcast ? 'Generating broadcast...' : 'ALL CLEAR'}
          </Text>
        </Pressable>
      ) : null}

      {top ? (
        <ChatPanel
          messages={messagesForStudent(events, top.studentId)}
          meSender="staff"
          meName={profile.staffName}
          studentId={top.studentId}
          peerLabel={`Message ${top.studentName.split(' ')[0]}'s guardian`}
          now={now}
          collapsed={chatCollapsed}
          onToggle={() => setChatCollapsed((c) => !c)}
        />
      ) : null}

      {top && broadcastsForTop > 0 ? (
        <Text style={styles.miniMapEmptyText}>
          {broadcastsForTop} broadcast{broadcastsForTop > 1 ? 's' : ''} sent for this incident.
        </Text>
      ) : null}

      <Pressable onPress={onWipeEvents} style={({ pressed }) => [styles.wipeButton, pressed && styles.pressed]}>
        <RefreshCcw color="#a1a1aa" size={12} />
        <Text style={styles.wipeText}>Reset demo events</Text>
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ZoneVerificationPanel({ verifications }: { verifications: Map<string, VerificationState> }) {
  return (
    <GlassPanel style={styles.zonePanel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>Zone Verification</Text>
        <Text style={styles.liveChip}>HUMAN REVIEW REQUIRED</Text>
      </View>
      {zones.map((zone) => {
        const state = verifications.get(zone.key);
        if (!state) {
          return (
            <View key={zone.key} style={styles.zoneRow}>
              <Text style={styles.zoneRowTitle}>{zone.title}</Text>
              <View style={[styles.verifyPill, { borderColor: 'rgba(255,255,255,0.1)' }]}>
                <Text style={styles.verifyPillText}>No signal</Text>
              </View>
            </View>
          );
        }
        const meta = verificationMeta[state];
        return (
          <View key={zone.key} style={styles.zoneRow}>
            <View style={styles.flexOne}>
              <Text style={styles.zoneRowTitle}>{zone.title}</Text>
              <Text style={styles.zoneRowDetail}>{meta.description}</Text>
            </View>
            <View
              style={[
                styles.verifyPill,
                { borderColor: meta.glow, backgroundColor: meta.tint },
              ]}
            >
              <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
              <Text style={[styles.verifyPillText, { color: meta.color }]}>{meta.short}</Text>
            </View>
          </View>
        );
      })}
    </GlassPanel>
  );
}

// =====================================================================
// PARENT MODE
// =====================================================================
function ParentMode({
  profile,
  activeIncident,
  broadcast,
  events,
  activeIncidents,
  now,
}: {
  profile: Extract<Profile, { role: 'parent' }>;
  verifications: Map<string, VerificationState>;
  now: number;
  activeIncident: Extract<BeaconEvent, { type: 'BEACON_ACTIVATED' }> | null;
  broadcast: Extract<BeaconEvent, { type: 'STAFF_BROADCAST' }> | null;
  events: BeaconEvent[];
  activeIncidents: Array<Extract<BeaconEvent, { type: 'BEACON_ACTIVATED' }>>;
}) {
  const first = profile.linkedStudentName.split(' ')[0];
  const isAlert = Boolean(activeIncident);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [threatsCollapsed, setThreatsCollapsed] = useState(true);
  const [massCollapsed, setMassCollapsed] = useState(false);
  const parentMassBroadcasts = massBroadcastsFor(events, 'parent');

  const studentEvents = events.filter((e) => {
    if (e.type === 'BEACON_ACTIVATED' || e.type === 'INCIDENT_NOTE' || e.type === 'STAFF_BROADCAST' || e.type === 'BEACON_RESET') {
      return e.studentId === profile.linkedStudentId;
    }
    return false;
  });
  const recentNotes = studentEvents
    .filter((e): e is Extract<BeaconEvent, { type: 'INCIDENT_NOTE' }> => e.type === 'INCIDENT_NOTE')
    .filter((e) => !activeIncident || e.at >= activeIncident.at);
  const hasThreatNote = recentNotes.some((n) => n.kind === 'threat');
  const hasMedicalNote = recentNotes.some((n) => n.kind === 'medical');

  const feedItems = studentEvents
    .filter((e) => !activeIncident || e.at >= activeIncident.at)
    .slice()
    .reverse()
    .slice(0, 8);

  const fleetBeacons = buildFleetBeacons(events, activeIncidents);
  const myPath = activeIncident
    ? pathForStudentIncident(events, profile.linkedStudentId, activeIncident.id)
    : [];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      style={{ flex: 1 }}
    >
    <ScrollView
      contentContainerStyle={styles.simpleContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View
        style={[
          styles.parentBigCard,
          isAlert
            ? { borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)' }
            : { borderColor: 'rgba(34,197,94,0.4)', backgroundColor: 'rgba(34,197,94,0.08)' },
        ]}
      >
        <View
          style={[
            styles.parentBigBadge,
            { backgroundColor: isAlert ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.2)' },
          ]}
        >
          {isAlert ? (
            <Siren color="#ef4444" size={28} />
          ) : (
            <ShieldCheck color="#22c55e" size={28} />
          )}
        </View>
        <Text style={styles.parentBigTitle}>
          {isAlert ? `${first} activated the beacon` : `${first} is safe`}
        </Text>
        <Text style={styles.parentBigSub}>
          {isAlert
            ? `Signal received ${formatRelativeTime(activeIncident!.at, now)}. Staff have ${first}'s live GPS.`
            : 'No active signal. Beacon5 is not tracking during normal school hours.'}
        </Text>
      </View>

      {broadcast ? <BroadcastCard broadcast={broadcast} /> : null}

      <MassBroadcastList
        broadcasts={parentMassBroadcasts}
        now={now}
        collapsed={massCollapsed}
        onToggle={() => setMassCollapsed((c) => !c)}
      />

      <FleetMap
        beacons={fleetBeacons}
        height={isAlert ? 280 : 220}
        focusStudentId={profile.linkedStudentId}
      />
      {isAlert ? (
        <TrackingStats path={myPath} startedAt={activeIncident!.at} now={now} />
      ) : null}

      {isAlert ? (
        <ChatPanel
          messages={messagesForStudent(events, profile.linkedStudentId)}
          meSender="parent"
          meName={`Guardian of ${first}`}
          studentId={profile.linkedStudentId}
          peerLabel="Message school staff"
          now={now}
          collapsed={chatCollapsed}
          onToggle={() => setChatCollapsed((c) => !c)}
        />
      ) : null}

      <ThreatsList
        events={events}
        activeIncidents={activeIncidents}
        now={now}
        collapsed={threatsCollapsed}
        onToggle={() => setThreatsCollapsed((c) => !c)}
      />

      <View style={styles.feedSection}>
        <Text style={styles.feedLabel}>LIVE UPDATES FROM SCHOOL</Text>
        {feedItems.length === 0 ? (
          <View style={styles.feedEmpty}>
            <Text style={styles.feedEmptyText}>No updates yet. You'll see them here in real time.</Text>
          </View>
        ) : (
          feedItems.map((ev) => <FeedRow key={ev.id} ev={ev} first={first} now={now} />)
        )}
      </View>

      <View style={styles.parentChipsRow}>
        <ParentStatusChip
          icon={Eye}
          accent="#ef4444"
          label="Threat flagged"
          state={hasThreatNote ? 'FLAGGED' : 'CLEAR'}
          on={hasThreatNote}
        />
        <ParentStatusChip
          icon={HeartPulse}
          accent="#3b82f6"
          label="Medical flagged"
          state={hasMedicalNote ? 'FLAGGED' : 'CLEAR'}
          on={hasMedicalNote}
        />
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ParentStatusChip({
  icon: Icon,
  accent,
  label,
  state,
  on,
}: {
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  accent: string;
  label: string;
  state: string;
  on: boolean;
}) {
  return (
    <View
      style={[
        styles.parentChip,
        {
          borderColor: on ? accent : 'rgba(255,255,255,0.12)',
          backgroundColor: on ? `${accent}1a` : 'rgba(20,20,22,0.6)',
        },
      ]}
    >
      <Icon color={on ? accent : '#71717a'} size={20} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.parentChipText, { color: on ? '#f4f4f5' : '#a1a1aa' }]}>{label}</Text>
        <Text style={[styles.parentChipState, { color: on ? accent : '#52525b' }]}>{state}</Text>
      </View>
    </View>
  );
}

function FeedRow({
  ev,
  first,
  now,
}: {
  ev: BeaconEvent;
  first: string;
  now: number;
}) {
  let title = '';
  let body = '';
  let icon = <Radio color="#7dd3fc" size={16} />;
  let borderColor = 'rgba(125,211,252,0.4)';
  let bg = 'rgba(125,211,252,0.1)';

  if (ev.type === 'BEACON_ACTIVATED') {
    title = `${first} activated the beacon`;
    body = ev.zoneDescription ?? 'Live GPS shared with staff.';
    icon = <Siren color="#fb7185" size={16} />;
    borderColor = 'rgba(239,68,68,0.5)';
    bg = 'rgba(239,68,68,0.12)';
  } else if (ev.type === 'INCIDENT_NOTE') {
    title = ev.kind === 'threat' ? `${first} flagged a threat` : `${first} flagged a medical need`;
    body = ev.polishedNote;
    icon = ev.kind === 'threat' ? <Eye color="#fb7185" size={16} /> : <HeartPulse color="#7dd3fc" size={16} />;
    borderColor = ev.kind === 'threat' ? 'rgba(239,68,68,0.45)' : 'rgba(59,130,246,0.45)';
    bg = ev.kind === 'threat' ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.1)';
  } else if (ev.type === 'STAFF_BROADCAST') {
    title = ev.kind === 'all_clear' ? 'All clear - staff update' : 'Staff update';
    body = ev.message;
    icon = <Sparkles color="#86efac" size={16} />;
    borderColor = 'rgba(34,197,94,0.45)';
    bg = 'rgba(34,197,94,0.1)';
  } else if (ev.type === 'BEACON_RESET') {
    title = `${first} reset the beacon`;
    body = 'Student marked all-clear.';
    icon = <ShieldCheck color="#86efac" size={16} />;
    borderColor = 'rgba(34,197,94,0.4)';
    bg = 'rgba(34,197,94,0.08)';
  }
  return (
    <View style={styles.feedRow}>
      <View style={[styles.feedIcon, { borderColor, backgroundColor: bg }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.feedTitle}>{title}</Text>
          <Text style={styles.feedTime}>{formatRelativeTime(ev.at, now)}</Text>
        </View>
        {body ? <Text style={styles.feedBody}>{body}</Text> : null}
      </View>
    </View>
  );
}

// =====================================================================
// PRIVACY + LOCATION TOKEN
// =====================================================================
function LocationTokenBanner({ token }: { token: LocationToken }) {
  const active = token === 'active';
  const color = active ? '#fb7185' : '#7dd3fc';
  const bg = active ? 'rgba(239,68,68,0.12)' : 'rgba(125,211,252,0.08)';
  const Icon = active ? Zap : EyeOff;
  return (
    <View style={[styles.tokenBanner, { borderColor: color, backgroundColor: bg }]}>
      <View style={[styles.tokenIcon, { backgroundColor: `${color}22` }]}>
        <Icon color={color} size={18} />
      </View>
      <View style={styles.flexOne}>
        <Text style={[styles.tokenLabel, { color }]}>
          {active ? 'EMERGENCY LOCATION TOKEN ACTIVE' : 'LOCATION DORMANT'}
        </Text>
        <Text style={styles.tokenSub}>
          {active
            ? 'A temporary, scoped token shares your approximate zone until you reset the beacon.'
            : 'Beacon5 is not tracking your location during normal school hours.'}
        </Text>
      </View>
    </View>
  );
}

function PrivacyCard({ mode }: { mode: Mode }) {
  const copy =
    mode === 'student'
      ? 'Beacon5 does not track you during normal school hours. When you hold the beacon, your one-time GPS location is captured and shared with verified staff and your guardian. The beacon stops sharing as soon as you reset it.'
      : mode === 'staff'
        ? 'Staff sees campus zones plus a single GPS fix shared at the moment a student activates a beacon. Beacon5 does not surface continuous student coordinates - only the one-time fix per incident.'
        : 'You will only see your student\'s location during a verified incident or a beacon hold from your student. GPS is captured once at activation, not continuously.';

  return (
    <GlassPanel style={styles.privacyCard}>
      <View style={styles.privacyHeader}>
        <View style={styles.privacyIcon}>
          <ShieldCheck color="#7dd3fc" size={18} />
        </View>
        <Text style={styles.privacyTitle}>Privacy Layer</Text>
        <Text style={styles.privacyTag}>EMERGENCY-ONLY</Text>
      </View>
      <Text style={styles.privacyCopy}>{copy}</Text>
      <View style={styles.privacyRow}>
        <Wifi color="#9ca3af" size={14} />
        <Text style={styles.privacyMicro}>
          One-time GPS fix on beacon activation. No continuous telemetry. No third-party sharing beyond Gemini for area description.
        </Text>
      </View>
    </GlassPanel>
  );
}

// =====================================================================
// SHARED COMPONENTS
// =====================================================================
function MetricCard({ status, count }: { status: StatusKey; count: number }) {
  const meta = statusMeta[status];
  const Icon = meta.icon;
  return (
    <GlassPanel style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: meta.tint }]}>
        <Icon color={meta.color} size={19} />
      </View>
      <Text style={styles.metricCount}>{count}</Text>
      <Text style={styles.metricLabel}>{meta.short}</Text>
    </GlassPanel>
  );
}

function ReportRow({
  report,
  verification,
  now,
}: {
  report: Report;
  verification: VerificationState;
  now: number;
}) {
  const meta = verificationMeta[verification];
  return (
    <View style={[styles.reportRow, report.studentLinked && styles.reportRowHot]}>
      <View style={{ width: 96 }}>
        <Text style={styles.reportRoom}>{report.zoneTitle}</Text>
        <Text style={styles.reportSubtle}>{formatRelativeTime(report.createdAt, now)}</Text>
      </View>
      <View style={styles.reportStatusCell}>
        <StatusPill status={report.status} />
      </View>
      <View style={styles.flexOne}>
        <View
          style={[
            styles.verifyPill,
            { borderColor: meta.glow, backgroundColor: meta.tint, alignSelf: 'flex-start' },
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
          <Text style={[styles.verifyPillText, { color: meta.color }]}>{meta.short}</Text>
        </View>
        <Text style={styles.reportContext}>{report.context}</Text>
      </View>
    </View>
  );
}

function StatusPill({ status }: { status: StatusKey }) {
  const meta = statusMeta[status];
  return (
    <View style={[styles.statusPill, { backgroundColor: meta.tint, borderColor: meta.glow }]}>
      <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
      <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

function InsightCard({ title, text, tone }: { title: string; text: string; tone: 'threat' | 'medical' }) {
  const color = tone === 'threat' ? '#ffb4ab' : '#c7d2fe';
  return (
    <GlassPanel style={[styles.insightCard, { borderLeftColor: color }]}>
      <View style={styles.panelHeader}>
        <Text style={[styles.insightTitle, { color }]}>{title}</Text>
        {tone === 'threat' ? <AlertTriangle color={color} size={18} /> : <Cross color={color} size={18} />}
      </View>
      <Text style={styles.insightText}>{text}</Text>
    </GlassPanel>
  );
}

function CampusMap({ incident }: { incident: Incident | null }) {
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.mapSurface, styles.mapPlaceholder]}>
        <MapPin color="#7dd3fc" size={28} />
        <Text style={styles.mapPlaceholderTitle}>Map preview is mobile-only</Text>
        <Text style={styles.mapPlaceholderText}>
          Open Beacon5 in Expo Go on iOS or Android to see the live GPS map.
        </Text>
        {incident?.coords ? (
          <Text style={styles.mapPlaceholderCoords}>
            {incident.coords.latitude.toFixed(5)}, {incident.coords.longitude.toFixed(5)}
          </Text>
        ) : null}
      </View>
    );
  }

  if (!incident?.coords) {
    return (
      <View style={[styles.mapSurface, styles.mapPlaceholder]}>
        <Radio color="#7dd3fc" size={28} />
        <Text style={styles.mapPlaceholderTitle}>
          {incident ? 'Waiting on GPS fix...' : 'No active beacon'}
        </Text>
        <Text style={styles.mapPlaceholderText}>
          {incident
            ? 'Once the student grants location permission, their position will appear here.'
            : 'When a student activates the beacon, their live GPS pin appears here on the real map.'}
        </Text>
      </View>
    );
  }

  const { latitude, longitude, accuracy } = incident.coords;

  return (
    <View style={styles.mapSurface}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude,
          longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass
      >
        <Marker
          coordinate={{ latitude, longitude }}
          title="Student beacon"
          description={incident.zoneDescription ?? `${incident.zone.title} zone`}
          pinColor="#ef4444"
        />
      </MapView>
      <View style={styles.mapBadge}>
        <Text style={styles.mapBadgeText}>
          {latitude.toFixed(5)}, {longitude.toFixed(5)}
          {accuracy ? ` (~${Math.round(accuracy)}m)` : ''}
        </Text>
      </View>
    </View>
  );
}

function UpdateCard({
  time,
  title,
  text,
  active,
}: {
  time: string;
  title: string;
  text: string;
  active?: boolean;
}) {
  return (
    <GlassPanel style={[styles.updateCard, active && styles.updateActive]}>
      <View style={styles.updateTop}>
        <Text style={styles.updateTime}>{time}</Text>
        <Shield color="rgba(226,226,226,0.45)" size={17} />
      </View>
      <Text style={[styles.updateTitle, !active && styles.mutedText]}>{title}</Text>
      <Text style={styles.updateText}>{text}</Text>
    </GlassPanel>
  );
}

function ParentTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  label: string;
  value: string;
}) {
  return (
    <GlassPanel style={styles.parentTile}>
      <Icon color="#c6c6c6" size={27} />
      <View>
        <Text style={styles.parentTileLabel}>{label}</Text>
        <Text style={styles.parentTileValue}>{value}</Text>
      </View>
    </GlassPanel>
  );
}

function ModeNav({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const items: Array<{ mode: Mode; label: string; icon: typeof Home }> = [
    { mode: 'student', label: 'Student', icon: Home },
    { mode: 'staff', label: 'Staff', icon: Activity },
    { mode: 'parent', label: 'Parent', icon: UsersRound },
  ];
  return (
    <View style={styles.modeNav}>
      {items.map((item) => {
        const active = mode === item.mode;
        const Icon = item.icon;
        return (
          <Pressable key={item.mode} onPress={() => onChange(item.mode)} style={styles.modeItem}>
            <View style={[styles.modeIconShell, active && styles.modeIconActive]}>
              <Icon color={active ? '#ffffff' : '#8f8f93'} size={22} />
            </View>
            <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function GlassPanel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object | object[];
}) {
  return (
    <View style={[styles.glassPanel, style]}>
      <View style={styles.glassHighlight} />
      {children}
    </View>
  );
}

// =====================================================================
// ESCALATION SHEET
// =====================================================================
function EscalationSheet({
  kind,
  visible,
  onClose,
  onSubmit,
}: {
  kind: 'threat' | 'medical' | null;
  visible: boolean;
  onClose: () => void;
  onSubmit: (kind: 'threat' | 'medical', note: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [freeform, setFreeform] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelected([]);
      setFreeform('');
      setSubmitting(false);
    }
  }, [visible]);

  const isThreat = kind === 'threat';
  const accent = isThreat ? '#ef4444' : '#3b82f6';
  const Icon = isThreat ? Eye : HeartPulse;

  const presets = isThreat
    ? [
        'Saw a person with a weapon',
        'Heard loud bangs nearby',
        'Forced entry attempt',
        'Suspicious individual in hallway',
        'Smoke or fire visible',
        'Locked door is being forced',
      ]
    : [
        'Someone is bleeding',
        'Person unconscious',
        'Severe asthma attack',
        'Injury - cannot move',
        'Allergic reaction',
        'Difficulty breathing',
      ];

  const togglePreset = (p: string) => {
    setSelected((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
    Haptics.selectionAsync().catch(() => undefined);
  };

  const combinedNote = [...selected, freeform.trim()].filter(Boolean).join('. ');
  const canSubmit = combinedNote.length > 0 && !submitting;

  const submit = async () => {
    if (!kind || submitting) return;
    setSubmitting(true);
    Keyboard.dismiss();
    await Promise.resolve(onSubmit(kind, combinedNote));
  };

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <SafeAreaView style={[styles.fullSheet, { backgroundColor: '#0a0a0b' }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={styles.fullSheetTopBar}>
            <Pressable
              onPress={onClose}
              hitSlop={16}
              style={({ pressed }) => [styles.fullSheetClose, pressed && styles.pressed]}
            >
              <X color="#f4f4f5" size={22} strokeWidth={2.4} />
            </Pressable>
            <View style={styles.fullSheetTitleRow}>
              <View
                style={[
                  styles.fullSheetIcon,
                  { backgroundColor: `${accent}22`, borderColor: `${accent}66` },
                ]}
              >
                <Icon color={accent} size={20} />
              </View>
              <Text style={styles.fullSheetTitle}>
                {isThreat ? 'I see a threat' : 'Medical needed'}
              </Text>
            </View>
            <View style={{ width: 42 }} />
          </View>

          <ScrollView
            contentContainerStyle={styles.fullSheetScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.fullSheetCopy}>
              Tap any that apply. Add a short note if it's safe. Staff and your guardian will see a
              Gemini-polished alert.
            </Text>

            <View style={styles.presetGrid}>
              {presets.map((p) => {
                const on = selected.includes(p);
                return (
                  <Pressable
                    key={p}
                    onPress={() => togglePreset(p)}
                    style={({ pressed }) => [
                      styles.presetTile,
                      {
                        borderColor: on ? accent : 'rgba(255,255,255,0.12)',
                        backgroundColor: on ? `${accent}1f` : 'rgba(20,20,22,0.74)',
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    {on ? <CheckCircle2 color={accent} size={16} /> : null}
                    <Text style={[styles.presetTileText, on && { color: accent }]}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fullSheetSection}>Add a note (optional)</Text>
            <TextInput
              value={freeform}
              onChangeText={setFreeform}
              placeholder="Anything else staff should know..."
              placeholderTextColor="#71717a"
              style={[styles.fullSheetInput, { borderColor: `${accent}55` }]}
              multiline
              autoCorrect
              returnKeyType="done"
              blurOnSubmit
            />

            {combinedNote ? (
              <View style={[styles.previewBox, { borderColor: `${accent}55` }]}>
                <Text style={[styles.previewLabel, { color: accent }]}>YOU'LL SEND</Text>
                <Text style={styles.previewText}>{combinedNote}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.fullSheetFooter}>
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.fullSheetSubmit,
                { backgroundColor: accent, opacity: canSubmit ? 1 : 0.4 },
                pressed && canSubmit && styles.pressed,
              ]}
            >
              <Text style={styles.fullSheetSubmitText}>
                {submitting ? 'Sending...' : 'Share with staff & guardian'}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// =====================================================================
// AI SUMMARY BUILDER
// =====================================================================
function buildAISummary(
  verifications: Map<string, VerificationState>,
  incident: Incident | null,
  reports: Report[],
): { text: string; chip: string; color: string } {
  const order: VerificationState[] = ['staff_confirmed', 'verified', 'forming', 'pending'];
  let highest: { state: VerificationState; zoneKey: string } | null = null;
  for (const state of order) {
    for (const [zoneKey, s] of verifications.entries()) {
      if (s === state) {
        highest = { state, zoneKey };
        break;
      }
    }
    if (highest) break;
  }

  const incidentLine = incident
    ? `A student beacon hold is active in ${incident.zone.title}. `
    : '';

  if (!highest) {
    return {
      text: `${incidentLine}Campus signal grid is calm. No anomaly clusters detected in the last reporting window.`,
      chip: 'CALM',
      color: '#22c55e',
    };
  }

  const zone = zoneByKey(highest.zoneKey);
  const meta = verificationMeta[highest.state];

  if (highest.state === 'staff_confirmed') {
    return {
      text: `${incidentLine}Staff confirmed an incident in ${zone.title}. Coordinating a verified-zone response. Continue to corroborate before any directed broadcast.`,
      chip: meta.short.toUpperCase(),
      color: meta.color,
    };
  }
  if (highest.state === 'verified') {
    return {
      text: `${incidentLine}Three or more reports cluster in ${zone.title} within 60 seconds. Human review required. Recommend on-site verification before any escalation.`,
      chip: meta.short.toUpperCase(),
      color: meta.color,
    };
  }
  if (highest.state === 'forming') {
    return {
      text: `${incidentLine}A cluster is forming in ${zone.title} - two reports in the same zone within 60 seconds. Recommend verification by an available staff observer.`,
      chip: meta.short.toUpperCase(),
      color: meta.color,
    };
  }
  return {
    text: `${incidentLine}A pending anomaly is open in ${zone.title}. Awaiting corroboration. Do not broadcast until a second independent signal arrives.`,
    chip: meta.short.toUpperCase(),
    color: meta.color,
  };
}

// =====================================================================
// STYLES
// =====================================================================
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000000' },
  root: { flex: 1, backgroundColor: '#000000' },
  header: {
    minHeight: 78,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(76, 69, 70, 0.42)',
    backgroundColor: 'rgba(19, 19, 19, 0.9)',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandIcon: {
    width: 27,
    height: 27,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(226, 226, 226, 0.36)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { color: '#f4f4f5', fontSize: 24, lineHeight: 28, fontWeight: '800' },
  brandSub: { color: '#b5b5bc', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 14, paddingTop: 16, paddingBottom: 120, gap: 14 },
  studentScroll: {
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 120,
    gap: 18,
    alignItems: 'stretch',
  },
  connectionBar: {
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(28,28,30,0.64)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  connectionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  connectionText: { color: '#eeeeef', fontSize: 12, fontWeight: '800' },
  humanLoopNote: {
    color: '#85858a',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.86 },

  // Hold button
  holdWrapper: {
    alignItems: 'center',
    gap: 18,
    paddingVertical: 12,
  },
  holdButton: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    shadowColor: '#ef4444',
    shadowOpacity: 0.4,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
  },
  holdInnerHalo: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  holdTitle: {
    color: '#fef2f2',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  holdSubtitle: {
    color: '#fef2f2',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2.2,
  },
  holdProgressLabel: {
    color: '#fecaca',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 4,
  },
  holdHint: {
    color: '#a1a1aa',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 16,
  },

  // Glass + panels
  glassPanel: {
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(76, 69, 70, 0.54)',
    backgroundColor: 'rgba(12, 12, 13, 0.82)',
  },
  glassHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },

  // Token banner
  tokenBanner: {
    flexDirection: 'row',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  tokenIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  tokenSub: { color: '#c7c7cc', fontSize: 12, lineHeight: 17, marginTop: 4 },

  // Sent / hero
  sentPanel: { padding: 22, alignItems: 'center', gap: 13 },
  sentHalo: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentTitle: {
    color: '#f5f5f5',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    textAlign: 'center',
  },
  sentCopy: { color: '#cfcfd5', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  sentStatusRow: { alignItems: 'center', gap: 8, marginTop: 4 },
  zonePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  zonePillText: { color: '#fecaca', fontSize: 11, fontWeight: '800' },
  locationCopy: { color: '#9f9fa6', fontSize: 12, textAlign: 'center' },

  // Sections
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  sectionTitle: { color: '#dbdbe1', fontSize: 14, fontWeight: '800', textTransform: 'uppercase' },
  liveChip: { color: '#c8c8cb', fontSize: 10, fontWeight: '800' },

  // Anchor checklist
  checkItem: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  anchorNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.5)',
    backgroundColor: 'rgba(34,197,94,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchorNumText: { color: '#86efac', fontSize: 13, fontWeight: '900' },
  checkText: { flex: 1, color: '#ececf0', fontSize: 15, lineHeight: 21 },

  // Escalation chips
  escalRow: { flexDirection: 'row', gap: 10 },
  escalChip: {
    flex: 1,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  escalChipText: { color: '#e5e5ea', fontSize: 14, fontWeight: '700' },

  noteCard: { padding: 14, borderLeftWidth: 4, gap: 6 },
  noteLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  noteText: { color: '#e5e5ea', fontSize: 14, lineHeight: 20 },

  // Buttons
  secondaryButton: {
    height: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(198,198,198,0.34)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  secondaryButtonText: { color: '#f4f4f5', fontSize: 15, fontWeight: '700' },

  // Staff AI banner
  aiBanner: {
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
  },
  warningIcon: {
    width: 48,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexOne: { flex: 1 },
  aiHeaderRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  aiTitle: { color: '#ffccc7', fontSize: 15, fontWeight: '800' },
  criticalChip: {
    overflow: 'hidden',
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 10,
    fontWeight: '900',
  },
  aiCopy: { color: '#f1f1f3', fontSize: 15, lineHeight: 21, fontWeight: '500' },
  gpsBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.32)',
    backgroundColor: 'rgba(125,211,252,0.08)',
  },
  gpsBlockText: { color: '#bae6fd', fontSize: 11, fontWeight: '700', flex: 1, lineHeight: 15 },
  aiFootnote: { color: '#9ca3af', fontSize: 11, marginTop: 8, fontStyle: 'italic' },

  staffActions: { flexDirection: 'row', gap: 10 },
  simButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.55)',
    backgroundColor: 'rgba(251, 146, 60, 0.12)',
  },
  simButtonText: { color: '#fdba74', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  confirmButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.55)',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  confirmButtonText: { color: '#7dd3fc', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },

  // Metrics
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { width: '48.4%', padding: 13, minHeight: 95, justifyContent: 'space-between' },
  metricIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  metricCount: { color: '#f6f6f7', fontSize: 27, fontWeight: '800' },
  metricLabel: { color: '#ababaf', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },

  // Log panel
  logPanel: { paddingBottom: 2 },
  panelHeader: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(76,69,70,0.24)',
  },
  panelTitle: { color: '#f3f3f5', fontSize: 20, lineHeight: 26, fontWeight: '800' },
  headerTools: { flexDirection: 'row', gap: 16 },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(53,53,53,0.35)',
  },
  tableHeadRoom: { width: 96, color: '#d6d6db', fontSize: 11, fontWeight: '900' },
  tableHeadStatus: { width: 122, color: '#d6d6db', fontSize: 11, fontWeight: '900' },
  tableHeadContext: { flex: 1, color: '#d6d6db', fontSize: 11, fontWeight: '900' },
  reportRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(76,69,70,0.18)',
    gap: 8,
  },
  reportRowHot: { backgroundColor: 'rgba(239,68,68,0.06)' },
  reportRoom: { color: '#eeeeef', fontSize: 15, fontWeight: '800' },
  reportSubtle: { color: '#9ca3af', fontSize: 10, marginTop: 2 },
  reportStatusCell: { width: 122 },
  reportContext: { color: '#d2d2d7', fontSize: 12, lineHeight: 17, marginTop: 4 },

  // Pills
  statusPill: {
    minHeight: 32,
    alignSelf: 'flex-start',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusPillText: { fontSize: 10, lineHeight: 13, fontWeight: '900', maxWidth: 82 },

  verifyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  verifyPillText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },

  // Zone panel
  zonePanel: { paddingBottom: 4 },
  zoneRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(76,69,70,0.18)',
  },
  zoneRowTitle: { color: '#f3f3f5', fontSize: 14, fontWeight: '800' },
  zoneRowDetail: { color: '#a1a1aa', fontSize: 11, lineHeight: 15, marginTop: 3 },

  // Insight
  insightCard: { padding: 16, borderLeftWidth: 4 },
  insightTitle: { fontSize: 16, fontWeight: '700' },
  insightText: { color: '#d8d8de', fontSize: 14, lineHeight: 20, marginTop: 11 },

  // Map
  mapPanel: { paddingBottom: 12 },
  floorToggle: { flexDirection: 'row', backgroundColor: '#090909', borderRadius: 7, overflow: 'hidden' },
  floorActive: {
    color: '#161616',
    backgroundColor: '#e2e2e2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 10,
    fontWeight: '900',
  },
  floorInactive: {
    color: '#e2e2e2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 10,
    fontWeight: '900',
  },
  mapSurface: {
    height: 330,
    margin: 13,
    borderRadius: 9,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(76,69,70,0.52)',
    backgroundColor: '#071112',
  },
  mapGridLineOne: {
    position: 'absolute',
    left: -40,
    right: -40,
    top: 76,
    height: 1,
    backgroundColor: 'rgba(61, 228, 222, 0.18)',
    transform: [{ rotate: '-14deg' }],
  },
  mapGridLineTwo: {
    position: 'absolute',
    left: -30,
    right: -30,
    bottom: 78,
    height: 1,
    backgroundColor: 'rgba(61, 228, 222, 0.14)',
    transform: [{ rotate: '-14deg' }],
  },
  mapWingA: {
    position: 'absolute',
    left: '13%',
    top: '30%',
    width: '72%',
    height: '15%',
    borderWidth: 2,
    borderColor: 'rgba(33, 209, 210, 0.33)',
    transform: [{ rotate: '-15deg' }],
    backgroundColor: 'rgba(33,209,210,0.05)',
  },
  mapWingB: {
    position: 'absolute',
    left: '18%',
    top: '46%',
    width: '62%',
    height: '15%',
    borderWidth: 2,
    borderColor: 'rgba(33, 209, 210, 0.28)',
    transform: [{ rotate: '-15deg' }],
    backgroundColor: 'rgba(33,209,210,0.07)',
  },
  mapWingC: {
    position: 'absolute',
    left: '24%',
    top: '56%',
    width: '48%',
    height: '12%',
    borderWidth: 2,
    borderColor: 'rgba(33, 209, 210, 0.23)',
    transform: [{ rotate: '-15deg' }],
  },
  mapCorridor: {
    position: 'absolute',
    left: '22%',
    top: '40%',
    width: '58%',
    height: '8%',
    backgroundColor: 'rgba(61, 228, 222, 0.16)',
    transform: [{ rotate: '-15deg' }],
  },
  mapPin: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#f4f4f5',
    shadowOpacity: 0.95,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  pinLabel: {
    position: 'absolute',
    left: -36,
    top: 16,
    width: 88,
    paddingVertical: 3,
    textAlign: 'center',
    overflow: 'hidden',
    borderRadius: 4,
    color: '#ffffff',
    backgroundColor: 'rgba(4,4,5,0.92)',
    fontSize: 10,
    fontWeight: '900',
  },
  zoneHalo: {
    position: 'absolute',
    width: '16%',
    aspectRatio: 1,
    borderRadius: 100,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  zoneHaloText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  mapZoom: {
    position: 'absolute',
    right: 13,
    bottom: 58,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapZoomBottom: { bottom: 14 },
  mapZoomText: { color: '#f5f5f5', fontSize: 28, lineHeight: 30 },
  mapPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  mapPlaceholderTitle: {
    color: '#f4f4f5',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 6,
  },
  mapPlaceholderText: {
    color: '#a1a1aa',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  mapPlaceholderCoords: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  mapBadge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(4,4,5,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.3)',
  },
  mapBadgeText: { color: '#bae6fd', fontSize: 11, fontWeight: '800' },

  // Parent
  parentHero: {
    padding: 20,
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    minHeight: 138,
  },
  parentIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secureTag: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 7,
  },
  parentTitle: { color: '#f1f1f4', fontSize: 22, lineHeight: 28, fontWeight: '700' },
  parentSub: { color: '#adadb3', marginTop: 6, fontSize: 13, lineHeight: 18 },
  updateCard: { padding: 22, minHeight: 146, justifyContent: 'center' },
  updateActive: { borderLeftWidth: 4, borderLeftColor: 'rgba(198,198,198,0.55)' },
  updateTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 13,
  },
  updateTime: { color: '#d8d8de', fontSize: 18, fontWeight: '800' },
  updateTitle: { color: '#f5f5f6', fontSize: 21, lineHeight: 27, fontWeight: '800' },
  mutedText: { color: '#d3d3d8', fontWeight: '500' },
  updateText: { color: '#c7c7ce', fontSize: 16, lineHeight: 22, marginTop: 9 },
  parentGrid: { flexDirection: 'row', gap: 14 },
  parentTile: { flex: 1, aspectRatio: 1, padding: 18, justifyContent: 'space-between' },
  parentTileLabel: { color: '#c5c5ca', fontSize: 12, fontWeight: '700' },
  parentTileValue: { color: '#eeeeef', fontSize: 22, fontWeight: '300', marginTop: 7 },
  parentWarning: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 180, 171, 0.42)',
    padding: 23,
  },
  parentWarningText: {
    color: '#ffd3cd',
    textAlign: 'center',
    fontSize: 20,
    lineHeight: 27,
    fontWeight: '900',
  },

  // Privacy
  privacyCard: { padding: 16, gap: 10 },
  privacyHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  privacyIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(125,211,252,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyTitle: { color: '#f3f3f5', fontSize: 15, fontWeight: '800', flex: 1 },
  privacyTag: {
    color: '#7dd3fc',
    fontSize: 9,
    fontWeight: '900',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.5)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  privacyCopy: { color: '#d4d4d8', fontSize: 13, lineHeight: 19 },
  privacyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  privacyMicro: { color: '#9ca3af', fontSize: 11, flex: 1, lineHeight: 15 },

  // Modal / sheet
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 32,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    backgroundColor: '#1c1c1f',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 52,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: 22,
  },
  sheetTitle: { color: '#f4f4f5', fontSize: 24, lineHeight: 29, fontWeight: '800' },
  sheetCopy: { color: '#e0e0e2', fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 18 },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  presetChip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  presetText: { color: '#e5e5ea', fontSize: 12, fontWeight: '700' },
  sheetInput: {
    minHeight: 70,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: '#f5f5f5',
    fontSize: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    textAlignVertical: 'top',
  },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelButton: {
    flex: 1,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { color: '#f5f5f5', fontSize: 14, fontWeight: '700' },
  sheetSubmit: {
    flex: 1.4,
    height: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSubmitText: { color: '#0a0a0a', fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },

  // Full-screen escalation sheet
  fullSheet: { flex: 1 },
  fullSheetTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  fullSheetClose: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullSheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fullSheetIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullSheetTitle: { color: '#f4f4f5', fontSize: 17, fontWeight: '800' },
  fullSheetScroll: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 30,
    gap: 14,
  },
  fullSheetCopy: { color: '#c7c7cc', fontSize: 14, lineHeight: 20 },
  fullSheetSection: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 4,
  },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetTile: {
    minWidth: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  presetTileText: { color: '#e5e5ea', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  fullSheetInput: {
    minHeight: 100,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    color: '#f5f5f5',
    fontSize: 15,
    lineHeight: 21,
    backgroundColor: 'rgba(255,255,255,0.03)',
    textAlignVertical: 'top',
  },
  previewBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  previewLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  previewText: { color: '#f4f4f5', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  fullSheetFooter: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#0a0a0b',
  },
  fullSheetSubmit: {
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullSheetSubmitText: { color: '#0a0a0a', fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },

  // Parent live feed + chips
  parentChipsRow: { flexDirection: 'row', gap: 10 },
  parentChip: {
    flex: 1,
    minHeight: 60,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  parentChipText: { fontSize: 12, fontWeight: '800', flexShrink: 1, lineHeight: 16 },
  parentChipState: { fontSize: 9, fontWeight: '900', letterSpacing: 0.7, marginTop: 2 },
  feedSection: { gap: 8, marginTop: 4 },
  feedLabel: { color: '#a1a1aa', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  feedRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(76,69,70,0.42)',
    backgroundColor: 'rgba(12,12,13,0.7)',
  },
  feedIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  feedTitle: { color: '#f4f4f5', fontSize: 13, fontWeight: '800' },
  feedTime: { color: '#71717a', fontSize: 10, fontWeight: '700', marginTop: 1 },
  feedBody: { color: '#d4d4d8', fontSize: 12, lineHeight: 17, marginTop: 4 },
  feedEmpty: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(76,69,70,0.42)',
    backgroundColor: 'rgba(12,12,13,0.5)',
    alignItems: 'center',
  },
  feedEmptyText: { color: '#71717a', fontSize: 12, fontStyle: 'italic' },

  // Fleet map + custom markers
  fleetMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },

  // Chat panel
  chatPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.32)',
    backgroundColor: 'rgba(12,12,13,0.7)',
    overflow: 'hidden',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(76,69,70,0.32)',
  },
  chatHeaderTitle: { color: '#f4f4f5', fontSize: 14, fontWeight: '800' },
  chatHeaderToggle: {
    color: '#7dd3fc',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  chatBody: { padding: 12, gap: 8 },
  chatEmpty: {
    color: '#71717a',
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
  chatBubble: {
    maxWidth: '85%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 2,
  },
  chatBubbleMe: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(125,211,252,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.45)',
  },
  chatBubbleThem: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chatSender: { color: '#a1a1aa', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  chatTextMe: { color: '#f4f4f5', fontSize: 13, lineHeight: 18 },
  chatTextThem: { color: '#e5e5ea', fontSize: 13, lineHeight: 18 },
  chatTimeMe: { color: '#7dd3fc', fontSize: 9, fontWeight: '700', alignSelf: 'flex-end' },
  chatTimeThem: { color: '#71717a', fontSize: 9, fontWeight: '700' },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  chatInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#f4f4f5',
    fontSize: 13,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chatSendButton: {
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#7dd3fc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSendText: { color: '#03263a', fontSize: 13, fontWeight: '900' },

  // Mass broadcast composer + list
  massComposer: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.5)',
    backgroundColor: 'rgba(251,191,36,0.08)',
    padding: 12,
    gap: 10,
  },
  massComposerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  massComposerBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.6)',
    backgroundColor: 'rgba(251,191,36,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  massComposerTitle: {
    color: '#fde68a',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  massComposerSub: {
    color: '#a1a1aa',
    fontSize: 11,
    marginTop: 2,
  },
  massAudienceRow: { flexDirection: 'row', gap: 6 },
  massAudienceChip: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  massAudienceText: { fontSize: 12, fontWeight: '800' },
  massListPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
    backgroundColor: 'rgba(251,191,36,0.06)',
    overflow: 'hidden',
  },
  massListBody: { padding: 10, gap: 8 },
  massListRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderLeftWidth: 3,
    borderLeftColor: '#fbbf24',
  },
  massAudienceTag: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: 'rgba(251,191,36,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.5)',
    alignSelf: 'flex-start',
  },
  massAudienceTagText: {
    color: '#fde68a',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  massListSender: { color: '#f4f4f5', fontSize: 12, fontWeight: '800' },
  massListMessage: { color: '#d4d4d8', fontSize: 13, lineHeight: 18, marginTop: 3 },

  // Threats list
  threatsPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
    backgroundColor: 'rgba(251,191,36,0.06)',
    overflow: 'hidden',
  },
  threatsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(251,191,36,0.2)',
  },
  threatsTitle: { color: '#fde68a', fontSize: 14, fontWeight: '800' },
  threatsSummaryRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  threatsSummaryItem: { fontSize: 12, fontWeight: '800' },
  threatsBody: { padding: 10, gap: 8 },
  threatRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    paddingLeft: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  threatIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  threatRowName: { color: '#f4f4f5', fontSize: 12, fontWeight: '800' },
  threatRowText: { color: '#d4d4d8', fontSize: 12, lineHeight: 17, marginTop: 3 },

  // Live tracking
  trackStatRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: -4,
  },
  trackStat: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.32)',
    backgroundColor: 'rgba(125,211,252,0.08)',
  },
  trackStatLabel: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  trackStatValue: { color: '#f4f4f5', fontSize: 14, fontWeight: '800', marginTop: 2 },
  trackStatSub: { color: '#a1a1aa', fontSize: 10, marginTop: 2 },

  // Simplified student/staff/parent
  simpleContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 32,
    gap: 14,
  },
  studentDormant: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 18,
  },
  studentDormantScroll: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 32,
    gap: 16,
    minHeight: '100%',
  },
  studentDormantCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    minHeight: 360,
  },
  holdHintTight: {
    color: '#d4d4d8',
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'center',
    fontWeight: '600',
  },
  studentHero: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  studentHeroHalo: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.5)',
    marginBottom: 4,
  },
  studentHeroTitle: {
    color: '#f4f4f5',
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    textAlign: 'center',
  },
  studentHeroSub: {
    color: '#c7c7cc',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  broadcastCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  broadcastBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  broadcastLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  broadcastMessage: {
    color: '#f4f4f5',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  miniMapWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(76, 69, 70, 0.54)',
    backgroundColor: '#071112',
  },
  miniMapPill: {
    position: 'absolute',
    left: 12,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: 'rgba(4,4,5,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  miniMapPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  miniMapEmpty: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(76,69,70,0.5)',
    backgroundColor: 'rgba(12,12,13,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  miniMapEmptyText: { color: '#a1a1aa', fontSize: 13, fontWeight: '700' },
  miniMapWeb: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(76,69,70,0.5)',
    backgroundColor: 'rgba(12,12,13,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
  },
  miniMapWebTitle: { color: '#f4f4f5', fontSize: 13, fontWeight: '800' },
  miniMapWebCoords: { color: '#7dd3fc', fontSize: 11, fontWeight: '700' },
  tipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tipCard: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(76,69,70,0.5)',
    backgroundColor: 'rgba(12,12,13,0.82)',
    padding: 10,
    gap: 6,
    minHeight: 92,
  },
  tipNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.5)',
    backgroundColor: 'rgba(34,197,94,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipNumText: { color: '#86efac', fontSize: 11, fontWeight: '900' },
  tipText: { color: '#e5e5ea', fontSize: 12, lineHeight: 16, fontWeight: '600' },
  resetGhost: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  resetGhostText: { color: '#e5e5ea', fontSize: 13, fontWeight: '700' },

  // Parent simple
  parentBigCard: {
    padding: 22,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'flex-start',
    gap: 10,
  },
  parentBigBadge: {
    width: 54,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  parentBigTitle: {
    color: '#f4f4f5',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
  },
  parentBigSub: { color: '#c7c7cc', fontSize: 14, lineHeight: 20 },

  // Staff simple
  staffActiveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.55)',
    backgroundColor: 'rgba(239,68,68,0.1)',
  },
  staffActiveAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(239,68,68,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  staffActiveName: { color: '#f4f4f5', fontSize: 16, fontWeight: '800' },
  staffActiveSub: { color: '#fecaca', fontSize: 12, marginTop: 2, lineHeight: 16 },
  staffEmptyCard: {
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.4)',
    backgroundColor: 'rgba(34,197,94,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  staffEmptyTitle: { color: '#bbf7d0', fontSize: 16, fontWeight: '800' },
  staffEmptySub: { color: '#86efac', fontSize: 12, marginTop: 2 },
  allClearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#22c55e',
  },
  allClearText: { color: '#03210d', fontSize: 17, fontWeight: '900', letterSpacing: 0.6 },
  allClearDisabled: { backgroundColor: 'rgba(34,197,94,0.4)' },
  staffAiCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.42)',
    backgroundColor: 'rgba(125,211,252,0.08)',
    gap: 6,
  },
  staffAiLabel: { color: '#bae6fd', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  staffAiText: { color: '#f4f4f5', fontSize: 14, lineHeight: 20, fontWeight: '500' },
  wipeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  wipeText: { color: '#a1a1aa', fontSize: 11, fontWeight: '700' },

  // Onboarding
  onboardScroll: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 60,
    gap: 14,
  },
  onboardHero: {
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 16,
  },
  onboardBadge: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  onboardEyebrow: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  onboardTitle: {
    color: '#f4f4f5',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  onboardCopy: {
    color: '#a1a1aa',
    fontSize: 14,
    lineHeight: 21,
  },
  onboardFootnote: {
    color: '#71717a',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 18,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(20,20,22,0.74)',
  },
  roleCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleCardTitle: {
    color: '#f4f4f5',
    fontSize: 16,
    fontWeight: '800',
  },
  roleCardSubtitle: {
    color: '#a1a1aa',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginBottom: 4,
  },
  backText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(76, 69, 70, 0.42)',
    backgroundColor: 'rgba(12, 12, 13, 0.82)',
  },
  rosterIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rosterPrimary: { color: '#f4f4f5', fontSize: 15, fontWeight: '800' },
  rosterSecondary: { color: '#a1a1aa', fontSize: 12, marginTop: 2 },

  signOutButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Mode nav
  modeNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 86,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(76,69,70,0.42)',
    backgroundColor: 'rgba(8,8,9,0.96)',
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  modeItem: { width: 88, alignItems: 'center', gap: 4 },
  modeIconShell: { width: 42, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  modeIconActive: { backgroundColor: 'rgba(71, 85, 105, 0.78)' },
  modeLabel: { color: '#9b9ba1', fontSize: 12, fontWeight: '700' },
  modeLabelActive: { color: '#ffffff', fontWeight: '900' },
});
