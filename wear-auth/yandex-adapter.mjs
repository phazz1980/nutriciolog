// Direct Functions URLs carry the action in a query parameter. Authorization
// may be consumed by Yandex; the browser supplies a separate application header.
export function yandexAdapter(handler) {
  return async event => {
    try {
      const headers = new Headers(event.headers || {});
      headers.delete('authorization');
      const token = headers.get('X-X20-Authorization');
      if (token) headers.set('authorization', token);
      headers.delete('X-X20-Authorization');
      const method = event.httpMethod || 'POST';
      const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
      const action = event.queryStringParameters?.action || '';
      const response = await handler(new Request(`https://wear-auth.internal/?action=${encodeURIComponent(action)}`, {
        method, headers, ...(['GET', 'HEAD'].includes(method) ? {} : { body }),
      }));
      return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: await response.text(), isBase64Encoded: false };
    } catch {
      return { statusCode: 503, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }, body: '{"error":"service_unavailable"}', isBase64Encoded: false };
    }
  };
}
