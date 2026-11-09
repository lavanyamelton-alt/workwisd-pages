import { handler } from './src/app.mjs';

export default {
  async fetch(request, env, ctx) {
    if (env.API_URL) process.env.API_URL = env.API_URL;
    if (env.API_KEY) process.env.API_KEY = env.API_KEY;
    if (env.BRAND_NAME) process.env.BRAND_NAME = env.BRAND_NAME;
    if (env.SITE_URL) process.env.SITE_URL = env.SITE_URL;
    return handler(request, { site: { url: new URL(request.url).origin } });
  }
};
