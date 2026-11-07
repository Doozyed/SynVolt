export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/v1/scriptblox/')) {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...cors, Allow: 'GET, OPTIONS' } });
      const suffix = url.pathname.slice('/v1/scriptblox/'.length);
      if (!/^(?:fetch|search|[A-Za-z0-9_-]+|raw\/[A-Za-z0-9_-]+)$/.test(suffix) || url.search.length > 2048) {
        return new Response('Invalid script request.', { status: 400, headers: cors });
      }
      const upstream = new URL('https://scriptblox.com/api/script/' + suffix);
      upstream.search = url.search;
      try {
        const result = await fetch(upstream, { redirect: 'manual', headers: { Accept: 'application/json, text/plain' } });
        const headers = new Headers(cors);
        headers.set('Content-Type', result.headers.get('Content-Type') || 'application/json');
        headers.set('Cache-Control', 'public, max-age=30');
        return new Response(result.body, { status: result.status, headers });
      } catch {
        return new Response('ScriptBlox unavailable.', { status: 502, headers: cors });
      }
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler;
