import { Timestamp } from 'firebase-admin/firestore';
import { PairingError } from './pairing.mjs';

export function firestoreStore(db) {
  const sessions = db.collection('_wearPairing');
  const limits = db.collection('_wearPairingLimits');
  const document = record => ({ ...record, deleteAt: Timestamp.fromMillis(record.expiresAt + 60_000) });
  return {
    async create(id, record) { await sessions.doc(id).create(document(record)); },
    async read(id) { return (await sessions.doc(id).get()).data(); },
    async update(id, transform) {
      await db.runTransaction(async tx => {
        const ref = sessions.doc(id);
        const snapshot = await tx.get(ref);
        tx.set(ref, document(transform(snapshot.data())));
      });
    },
    async limit(key, max, now, period) {
      const window = Math.floor(now / period);
      const ref = limits.doc(`${key}:${window}`);
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        const count = snapshot.data()?.count || 0;
        if (count >= max) throw new PairingError('rate_limited', 429);
        tx.set(ref, { count: count + 1, deleteAt: Timestamp.fromMillis((window + 2) * period) });
      });
    },
  };
}
