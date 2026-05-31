// Audit log helper — every authoritative mutation calls this.
// Best-effort: a failed audit insert is logged to stderr but does NOT
// roll back the underlying action. Audit gaps must be caught by the
// admin console's audit dashboard, not by 500-ing the user.

import { admin } from './supabase';

export async function audit(input: {
  campusId: string;
  actorUserId: string;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await admin.from('audit_events').insert({
      campus_id: input.campusId,
      actor_user_id: input.actorUserId,
      action: input.action,
      target: input.target ?? null,
      metadata: input.metadata ?? null,
    });
    if (error) {
      process.stderr.write(`[audit] insert failed (${input.action}): ${error.message}\n`);
    }
  } catch (err) {
    process.stderr.write(`[audit] threw (${input.action}): ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
