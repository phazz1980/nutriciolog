import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ydbStore } from './ydb-store.mjs';
import { createPairingService } from './pairing.mjs';
import { createHandler } from './handler.mjs';
import { yandexAdapter } from './yandex-adapter.mjs';

export async function handler(event, context) {
  try {
    const env = process.env;
    const credentials = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
    const project = env.FIREBASE_PROJECT_ID;
    if (!project || credentials.type !== 'service_account' || credentials.project_id !== project || credentials.client_email !== `wear-auth@${project}.iam.gserviceaccount.com`) throw new Error('Invalid signing identity');
    const app = getApps().find(app => app.name === 'wear-auth-yandex') || initializeApp({ credential: cert(credentials), projectId: project }, 'wear-auth-yandex');
    const auth = getAuth(app);
    const origins = new Set((env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
    if (!origins.has(new URL(env.WEB_APP_URL).origin) || [...origins].some(value => new URL(value).origin !== value || !value.startsWith('https://'))) throw new Error('Invalid origins');
    const service = createPairingService({
      store: ydbStore({ endpoint: env.YDB_DOCAPI_ENDPOINT, table: env.YDB_PAIRING_TABLE || 'wear_pairing', token: context?.token?.access_token }),
      verifyIdToken: token => auth.verifyIdToken(token, true), mintToken: uid => auth.createCustomToken(uid), webAppUrl: env.WEB_APP_URL,
    });
    return await yandexAdapter(createHandler(service, origins))(event);
  } catch {
    // Lockbox values and SDK errors must never appear in logs or responses.
    return { statusCode: 503, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }, body: '{"error":"service_unavailable"}', isBase64Encoded: false };
  }
}
