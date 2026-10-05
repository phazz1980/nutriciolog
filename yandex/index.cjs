// Yandex HTTP integration adapter. Never log event: it contains tokens/photos.
const MAX_BODY_BYTES = 1_800_000;
function createHandler(worker, env = process.env) {
  return async event => {
    const headers = new Headers(event.headers || {});
    const method = event.httpMethod || 'POST';
    const body = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');
    // Restore the application token stripped from Authorization by Yandex.
    headers.delete('Authorization');
    const token = headers.get('X-X20-Authorization');
    if (token) headers.set('Authorization', token);
    headers.delete('X-X20-Authorization');
    const path = method === 'GET' ? '/api/health' : '/api/advice';
    const request = new Request(`https://x20.internal${path}`, {
      method, headers,
      ...(!['GET', 'HEAD'].includes(method) ? { body } : {}),
    });
    let response;
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      const preflight = await worker.fetch(new Request('https://x20.internal', { method: 'OPTIONS', headers }), env);
      response = new Response(JSON.stringify({ error: 'Слишком большой запрос. Уменьшите фото.' }), {
        status: 413, headers: { ...Object.fromEntries(preflight.headers), 'Content-Type': 'application/json; charset=utf-8' },
      });
    } else response = await worker.fetch(request, env);
    return {
      statusCode: response.status,
      headers: { ...Object.fromEntries(response.headers), 'Cache-Control': 'no-store' },
      body: await response.text(),
      isBase64Encoded: false,
    };
  };
}
module.exports.createHandler = createHandler;
module.exports.handler = async (event, context) => {
  const { default: worker } = await import('./worker/src/index.js');
  const env = { ...process.env };
  if (env.YDB_DOCAPI_ENDPOINT && context?.token?.access_token) {
    const { createYdbQuotaStore } = await import('./worker/src/quota-ydb.js');
    try {
      env.AI_QUOTA_STORE = createYdbQuotaStore({ endpoint: env.YDB_DOCAPI_ENDPOINT, table: env.YDB_QUOTA_TABLE, token: context.token.access_token });
    } catch { /* Missing/invalid configuration fails closed in the shared gateway. */ }
  }
  return createHandler(worker, env)(event);
};
