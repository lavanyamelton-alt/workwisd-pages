import { handler } from './src/app.mjs';

export default {
  async fetch(request, env, ctx) {
    if (env.API_URL) process.env.API_URL = env.API_URL;
    if (env.API_KEY) process.env.API_KEY = env.API_KEY;
    if (env.BRAND_NAME) process.env.BRAND_NAME = env.BRAND_NAME;
    if (env.SITE_URL) process.env.SITE_URL = env.SITE_URL;

    // Debug endpoint: test raw API connectivity
    if (new URL(request.url).pathname === '/test-api') {
      const apiUrl = (env.API_URL || 'http://158.69.49.238:5097') + '/api/jobs?page=1';
      const apiKey = env.API_KEY || '';
      try {
        const r = await fetch(apiUrl, {
          headers: { 'Accept': 'application/json', 'X-Api-Key': apiKey },
          signal: AbortSignal.timeout(8000),
        });
        const text = await r.text();
        return new Response(JSON.stringify({ status: r.status, url: apiUrl, body: text.slice(0, 500) }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message, url: apiUrl }), {
          status: 502, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return handler(request, { site: { url: new URL(request.url).origin } });
  }
};
