// Firebase Admin SDK initialization.
// Reads creds from either FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON
// (see KEYS.md §1). Exported singletons are used everywhere else in the server.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { env } from './env';

function loadServiceAccount(): object {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  const p = env.FIREBASE_SERVICE_ACCOUNT_PATH!;
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `Firebase service account not found at ${abs}. ` +
        `Generate one at: Firebase console → Project settings → Service accounts. ` +
        `See KEYS.md §1.`,
    );
  }
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

const serviceAccount = loadServiceAccount();

export const adminApp: App = initializeApp({
  credential: cert(serviceAccount as never),
  projectId: env.FIREBASE_PROJECT_ID,
  databaseURL: `https://${env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`,
});

export const auth = getAuth(adminApp);
export const db = getFirestore(adminApp);
export const rtdb = getDatabase(adminApp);

export { FieldValue, Timestamp };
