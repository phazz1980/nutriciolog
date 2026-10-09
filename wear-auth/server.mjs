import { createServer } from 'node:http';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createPairingService } from './pairing.mjs';
import { firestoreStore } from './firestore-store.mjs';
import { createHandler } from './handler.mjs';

const projectId = process.env.FIREBASE_PROJECT_ID;
const webAppUrl = process.env.WEB_APP_URL;
const originList = process.env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean);
if (!projectId || !webAppUrl || !originList?.length) throw new Error('Configure FIREBASE_PROJECT_ID, WEB_APP_URL and ALLOWED_ORIGINS');
const origins = new Set(originList);
if (!origins.has(new URL(webAppUrl).origin) || [...origins].some(value => new URL(value).protocol !== 'https:')) throw new Error('Use exact HTTPS origins');
const app = initializeApp({ credential: applicationDefault(), projectId, ...(process.env.FIREBASE_SIGNER_EMAIL ? { serviceAccountId: process.env.FIREBASE_SIGNER_EMAIL } : {}) });
const auth = getAuth(app);
const handler = createHandler(createPairingService({
  store: firestoreStore(getFirestore(app, process.env.FIRESTORE_DATABASE_ID || '(default)')),
  verifyIdToken: token => auth.verifyIdToken(token, true),
  mintToken: uid => auth.createCustomToken(uid), webAppUrl,
}), origins);
createServer(async (req, res) => {
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) { res.writeHead(413, { 'Cache-Control': 'no-store' }); res.end(); return; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
    const response = await handler(new Request(`https://wear-auth.invalid${req.url}`, {
      method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch { res.writeHead(503, { 'Cache-Control': 'no-store' }); res.end(); }
}).listen(Number(process.env.PORT || 8080));
