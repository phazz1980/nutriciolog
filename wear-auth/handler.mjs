import { PairingError } from './pairing.mjs';

export function createHandler(service, origins) {
  return async request => {
    const origin = request.headers.get('origin');
    const headers = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff',
      ...(origins.has(origin) ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      } : {}),
    };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !origins.has(origin)) return reply({ error: 'origin_denied' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    const action = new URL(request.url).pathname.split('/').pop();
    if (!['start', 'inspect', 'approve', 'poll', 'cancel'].includes(action)) return reply({ error: 'not_found' }, 404);
    try {
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new PairingError('invalid_json');
      const text = await request.text();
      if (Buffer.byteLength(text) > 4096) throw new PairingError('body_too_large', 413);
      let payload;
      try { payload = JSON.parse(text); } catch { throw new PairingError('invalid_json'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new PairingError('invalid_json');
      const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
      return reply(await service[action](payload, token));
    } catch (error) {
      // Never include SDK messages, credentials, request bodies or tokens in responses/logs.
      return reply({ error: error instanceof PairingError ? error.code : 'service_unavailable' }, error instanceof PairingError ? error.status : 503);
    }
  };
}
