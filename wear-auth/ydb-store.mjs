import { PairingError } from './pairing.mjs';

// IAM token is invocation-scoped; no permanent YDB credentials are stored.
export function ydbStore({ endpoint, token, table = 'wear_pairing', fetcher = fetch }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.hostname !== 'docapi.serverless.yandexcloud.net' || url.username || url.password || url.search || url.hash || !token || !/^[a-zA-Z0-9_-]+$/.test(table)) throw new Error('Invalid YDB configuration');
  async function call(action, payload) {
    const response = await fetcher(url.href, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-amz-json-1.0', 'X-Amz-Target': `DynamoDB_20120810.${action}` },
      body: JSON.stringify({ TableName: table, ...payload }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (String(data.__type || '').split('#').pop() === 'ConditionalCheckFailedException') return null;
      throw new Error('Pairing storage unavailable');
    }
    return data;
  }
  const key = id => ({ id: { S: id } });
  async function readItem(id) {
    const data = await call('GetItem', { Key: key(id), ConsistentRead: true });
    if (!data) throw new Error('Pairing read failed');
    return data.Item;
  }
  const document = (id, record, revision) => ({ ...key(id), record: { S: JSON.stringify(record) }, revision: { N: String(revision) }, deleteAt: { N: String(Math.ceil((record.expiresAt + 60000) / 1000)) } });
  return {
    async create(id, record) {
      const data = await call('PutItem', { Item: document(id, record, 1), ConditionExpression: 'attribute_not_exists(#id)', ExpressionAttributeNames: { '#id': 'id' } });
      if (!data) throw new Error('Pairing creation conflict');
    },
    async read(id) { const item = await readItem(id); return item ? JSON.parse(item.record.S) : undefined; },
    async update(id, transform) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const item = await readItem(id);
        const record = transform(item ? JSON.parse(item.record.S) : undefined);
        if (!item) throw new Error('Pairing record missing');
        const revision = Number(item.revision.N);
        if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid pairing revision');
        const data = await call('PutItem', { Item: document(id, record, revision + 1),
          ConditionExpression: '#revision = :previous', ExpressionAttributeNames: { '#revision': 'revision' }, ExpressionAttributeValues: { ':previous': { N: String(revision) } } });
        if (data) return;
      }
      throw new Error('Pairing contention');
    },
    async limit(name, max, now, period) {
      const window = Math.floor(now / period);
      const data = await call('UpdateItem', {
        Key: key(`limit:${name}:${window}`), UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one, #ttl = :ttl',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :max', ExpressionAttributeNames: { '#count': 'count', '#ttl': 'deleteAt' },
        ExpressionAttributeValues: { ':zero': { N: '0' }, ':one': { N: '1' }, ':max': { N: String(max) }, ':ttl': { N: String(Math.ceil((window + 2) * period / 1000)) } },
      });
      if (!data) throw new PairingError('rate_limited', 429);
    },
  };
}
