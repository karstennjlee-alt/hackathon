// Beacon5 domain types — derived from PRD §12.
// These are the contract between app/, admin/, and server/.
// Every field maps to a Firestore/RTDB schema, every type is tenant-scoped by campusId.
//
// Phase 0 step 1 fills in the full schema + Firestore security rules.
// For now these are placeholder stubs so the shared/ package compiles.

export type ID = string;
export type Timestamp = number; // ms since epoch; serverAt sentinel applied server-side

export type Role = 'student' | 'parent' | 'staff' | 'admin';

export type CampusThreatStatus = 'active' | 'cleared';

export type IncidentStatus = 'active' | 'cleared' | 'reset';

export type MessageKind = 'chat' | 'broadcast' | 'mass';

export type Audience = 'students' | 'parents' | 'teachers' | 'everyone';

export type VerificationState = 'pending' | 'forming' | 'verified' | 'staff-confirmed';

export type LocationState = 'off' | 'pending' | 'approximate' | 'live' | 'stale';

export type EscalationKind = 'threat' | 'medical' | 'unspecified';

export interface Coords {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface CampusPolicy {
  whoCanDeclareThreat: 'any-staff' | 'admin-only';
  locationPolicy: 'on-activation' | 'on-threat' | 'never';
  defaultAudiences: Audience[];
  retentionDays: number;
  languages: string[];
  allow911Mention: boolean;
  studentProvisioning: 'school' | 'parent';
}

export interface CampusBranding {
  displayName: string;
  logoUrl?: string;
  colors?: {
    brandPrimary?: string;
  };
}

export interface Organization {
  id: ID;
  name: string;
  type: 'school' | 'workplace' | 'hospital' | 'other';
  createdAt: Timestamp;
}

export interface Campus {
  id: ID;
  orgId: ID;
  name: string;
  branding: CampusBranding;
  policy: CampusPolicy;
  createdAt: Timestamp;
}

export interface User {
  id: ID;
  campusId: ID;
  role: Role;
  displayName: string;
  isMinor: boolean;
  authProviderId: string;
  createdAt: Timestamp;
}

export interface GuardianLink {
  id: ID;
  campusId: ID;
  guardianUserId: ID;
  studentUserId: ID;
  verified: boolean;
  createdAt: Timestamp;
}

export interface Zone {
  id: ID;
  campusId: ID;
  title: string;
  building?: string;
  room?: string;
  geo?: { lat: number; lng: number; radius?: number };
}

export interface CampusThreat {
  id: ID;
  campusId: ID;
  status: CampusThreatStatus;
  actorUserId: ID;
  at: Timestamp;
}

export interface Escalation {
  kind: EscalationKind;
  presets: string[];
  rawNote: string;
  clarifiedNote?: string;
}

export interface Incident {
  id: ID;
  campusId: ID;
  studentUserId: ID;
  status: IncidentStatus;
  activatedAt: Timestamp;
  clearedAt?: Timestamp;
  escalation: Escalation;
  lastKnownCoords?: Coords;
  zoneHint?: string;
}

export interface LocationPoint {
  id: ID;
  campusId: ID;
  incidentId: ID;
  studentUserId: ID;
  coords: Coords;
  at: Timestamp;
}

export interface Message {
  id: ID;
  campusId: ID;
  kind: MessageKind;
  senderUserId: ID;
  senderRole: Role;
  audience?: Audience[];
  studentUserId?: ID;
  body: string;
  clarifiedBody?: string;
  at: Timestamp;
}

export interface AuditEvent {
  id: ID;
  campusId: ID;
  actorUserId: ID;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
  at: Timestamp;
}

export interface ConsentRecord {
  id: ID;
  campusId: ID;
  userId: ID;
  type: 'parental' | 'school-official' | 'self';
  scope: string;
  grantedBy: ID;
  at: Timestamp;
}

export interface Device {
  id: ID;
  userId: ID;
  pushToken: string;
  platform: 'ios' | 'android';
  lastSeenAt: Timestamp;
}
