// PRD §8.2.2 permission matrix encoded in code.
// The DB security rules enforce reads + writes at the data layer; this
// matrix is the application-layer counterpart used to gate HTTP routes
// (defense in depth — both must pass).

import type { Role } from '@beacon5/shared';

export type Permission =
  | 'beacon:activate'
  | 'beacon:reset'
  | 'incident:view-own'
  | 'incident:view-linked-child'
  | 'incident:view-campus'
  | 'incident:verify'
  | 'chat:send'
  | 'broadcast:send-staff-scoped'
  | 'broadcast:send-everyone'
  | 'threat:declare'
  | 'threat:clear'
  | 'allclear:send'
  | 'roster:manage'
  | 'joincode:issue'
  | 'audit:view';

const MATRIX: Record<Role, Permission[]> = {
  student: ['beacon:activate', 'beacon:reset', 'incident:view-own', 'chat:send'],
  parent: ['incident:view-linked-child', 'chat:send'],
  staff: [
    'beacon:activate',
    'beacon:reset',
    'incident:view-own',
    'incident:view-campus',
    'incident:verify',
    'chat:send',
    'broadcast:send-staff-scoped',
    // 'threat:declare' is governed by Campus.policy.whoCanDeclareThreat
    'threat:clear',
    'allclear:send',
    'joincode:issue',
  ],
  admin: [
    'beacon:activate',
    'beacon:reset',
    'incident:view-own',
    'incident:view-campus',
    'incident:verify',
    'chat:send',
    'broadcast:send-staff-scoped',
    'broadcast:send-everyone',
    'threat:declare',
    'threat:clear',
    'allclear:send',
    'roster:manage',
    'joincode:issue',
    'audit:view',
  ],
};

export function rolePermissions(role: Role): readonly Permission[] {
  return MATRIX[role] ?? [];
}

export function hasPermission(role: Role, perm: Permission): boolean {
  return MATRIX[role]?.includes(perm) ?? false;
}

// Step-up auth required for high-risk actions (R8.2.3).
// The server should re-verify recent auth or MFA before allowing these.
export const STEP_UP_PERMISSIONS: readonly Permission[] = [
  'threat:declare',
  'threat:clear',
  'broadcast:send-everyone',
  'roster:manage',
];

export function requiresStepUp(perm: Permission): boolean {
  return STEP_UP_PERMISSIONS.includes(perm);
}
