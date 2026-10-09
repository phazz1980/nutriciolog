import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const hash = value => createHash('sha256').update(value).digest('hex');
const lifetime = 5 * 60_000;
export class PairingError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function normalizeCode(value) {
  if (typeof value !== 'string' || value.length > 20) throw new PairingError('invalid_code');
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  // Accept old, unexpired sessions during the client rollout; new codes are digits only.
  if (!/^\d{8}$/.test(code) && (code.length !== 10 || [...code].some(char => !alphabet.includes(char)))) throw new PairingError('invalid_code');
  return code;
}
function validSecret(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new PairingError('invalid_session', 404);
  return value;
}
function active(record, now) {
  if (!record) throw new PairingError('invalid_session', 404);
  if (record.expiresAt <= now) throw new PairingError('expired', 410);
  if (['consumed', 'cancelled'].includes(record.status)) throw new PairingError('closed', 410);
}

// All mutations are transactions in the supplied store. Only secret hashes are persisted.
export function createPairingService({ store, verifyIdToken, mintToken, webAppUrl, now = Date.now }) {
  async function owner(token) {
    if (typeof token !== 'string' || token.length > 8192) throw new PairingError('unauthorized', 401);
    try {
      const claims = await verifyIdToken(token);
      if (!claims.uid) throw new Error();
      return claims.uid;
    } catch { throw new PairingError('unauthorized', 401); }
  }
  return {
    async start() {
      const time = now();
      // Distributed global cap prevents anonymous session creation from growing unchecked.
      await store.limit('start', 120, time, 60_000);
      const code = String(randomInt(100_000_000)).padStart(8, '0');
      const deviceSecret = randomBytes(32).toString('hex');
      const expiresAt = time + lifetime;
      await store.create(hash(code), { secretHash: hash(deviceSecret), status: 'pending', expiresAt, uid: null, nextPollAt: 0 });
      const url = new URL(webAppUrl);
      url.hash = `connect-watch=${code}`;
      return { code, deviceSecret, expiresAt, verificationUrl: url.href, pollIntervalMs: 3000 };
    },
    async inspect(payload, token) {
      const uid = await owner(token);
      await store.limit(`inspect:${hash(uid)}`, 30, now(), 60_000);
      const code = normalizeCode(payload.code);
      const record = await store.read(hash(code));
      active(record, now());
      if (record.status !== 'pending') throw new PairingError('already_approved', 409);
      return { code, status: 'pending', expiresAt: record.expiresAt };
    },
    async approve(payload, token) {
      const uid = await owner(token);
      await store.limit(`approve:${hash(uid)}`, 30, now(), 60_000);
      const code = normalizeCode(payload.code);
      await store.update(hash(code), record => {
        active(record, now());
        if (record.status !== 'pending') throw new PairingError('already_approved', 409);
        return { ...record, status: 'approved', uid };
      });
      return { status: 'approved' };
    },
    async poll(payload) {
      const id = hash(normalizeCode(payload.code));
      const secretHash = hash(validSecret(payload.deviceSecret));
      let authorized;
      await store.update(id, record => {
        if (!record || !timingSafeEqual(Buffer.from(record.secretHash, 'hex'), Buffer.from(secretHash, 'hex'))) throw new PairingError('invalid_session', 404);
        active(record, now());
        if (record.nextPollAt > now()) throw new PairingError('slow_down', 429);
        authorized = record;
        return { ...record, nextPollAt: now() + 3000 };
      });
      if (authorized.status === 'pending') return { status: 'pending' };
      // Sign first; a signer failure leaves the approval usable. Only the transaction
      // winner returns the token; concurrent polls/cancellation cannot both succeed.
      const customToken = await mintToken(authorized.uid);
      await store.update(id, record => {
        active(record, now());
        if (record.status !== 'approved' || record.uid !== authorized.uid) throw new PairingError('closed', 410);
        return { ...record, status: 'consumed', uid: null };
      });
      return { status: 'approved', customToken };
    },
    async cancel(payload) {
      const id = hash(normalizeCode(payload.code));
      const secretHash = hash(validSecret(payload.deviceSecret));
      await store.update(id, record => {
        if (!record || !timingSafeEqual(Buffer.from(record.secretHash, 'hex'), Buffer.from(secretHash, 'hex'))) throw new PairingError('invalid_session', 404);
        active(record, now());
        return { ...record, status: 'cancelled', uid: null };
      });
      return { status: 'cancelled' };
    },
  };
}
