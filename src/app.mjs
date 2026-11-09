// WorkWisd — work smarter, find faster (Cloudflare Pages).

import { CSS, CONFIG as cfg } from './assets.gen.mjs';
import { GOOGLE_BOTS } from './bots.mjs';

// ═══ ENGINE ════════════════════════════════════════════════════════════════

// ─── Constants ──────────────────────────────────────────────────────────────
const JOBS_PER_PAGE = 20;
const URLS_PER_SITEMAP = 12500;
const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined) || '';
const API_BASE = (env('API_URL') || env('JOBS_API_URL') || 'https://158api.jobsearchhelp4u.com').replace(/\/+$/, '');
const API_KEY = env('API_TOKEN') || env('API_SECRET') || env('API_KEY') || env('JOBS_API_TOKEN');
const API_TTL_LIST = 1800;   // 30 min — paginated job lists
const API_TTL_JOB = 21600;   // 6 hours — individual job pages
const API_TTL_INFO = 3600;   // 1 hour — total_jobs
const SITEMAP_TTL = 3600;
const API_TIMEOUTS = [5000, 3500];
const SITEMAP_TIMEOUT = 8500;

// Where "Apply" links resolve: the upstream permalink's path on the apply
// domain (APPLY_DOMAIN env overrides the default).
const APPLY_DOMAIN = (env('APPLY_DOMAIN') || 'https://iwfh.currentaffairsadda22.com').replace(/\/+$/, '');
const applyUrl = (permalink) => {
    const path = String(permalink || '').replace(/^https?:\/\/[^/]+/, '');
    return path !== '' ? APPLY_DOMAIN + path : APPLY_DOMAIN;
};

const TTL = { list: 900, field: 1800, job: 21600, sitemap: 3600, robots: 86400, miss: 600 };

// ─── Site Config ────────────────────────────────────────────────────────────
const siteName = env('BRAND_NAME') || cfg.siteName || 'Remote Jobs';
const companyName = env('BRAND_NAME') || cfg.companyName || siteName;
const tagline = cfg.tagline || '';
const heroTitle = cfg.heroTitle || 'Find Remote Work';
const metaDesc = cfg.metaDescription || '';
const metaKeywords = cfg.metaKeywords || '';
const metaAuthor = cfg.metaAuthor || '';
const ogTitle = cfg.ogTitle || '';
const ogDesc = cfg.ogDescription || '';


// ─── Job Categories ─────────────────────────────────────────────────────────
const JOB_CATEGORIES = [
    'customer service', 'data entry', 'virtual assistant', 'software development',
    'web developer', 'content writing', 'digital marketing', 'graphic design',
    'project management', 'sales', 'chat support', 'call center',
    'technical support', 'bookkeeping', 'healthcare', 'insurance',
    'recruiter', 'translation', 'transcription', 'social media',
    'video editing', 'data analyst', 'business analyst', 'finance',
    'marketing', 'design', 'writing', 'engineer',
];

const JOB_COUNTRIES = [
    ['United States', 'US'], ['Japan', 'JP'], ['India', 'IN'], ['United Kingdom', 'GB'],
    ['Brazil', 'BR'], ['Australia', 'AU'], ['Indonesia', 'ID'], ['Germany', 'DE'],
    ['Netherlands', 'NL'], ['Sweden', 'SE'], ['Canada', 'CA'], ['Mexico', 'MX'],
    ['France', 'FR'], ['Spain', 'ES'], ['South Korea', 'KR'], ['South Africa', 'ZA'],
    ['Nigeria', 'NG'],
].map(([name, iso]) => ({ name, iso }));

// ─── Helper Functions ───────────────────────────────────────────────────────

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const ucwords = (s) => String(s).replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
const fmt = (n) => Number(n).toLocaleString('en-US');
const safeSubstr = (s, len) => Array.from(String(s ?? '')).slice(0, len).join('');
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// PHP crc32() (unsigned), so dates/countries/"Also look at" picks match Wizzfor's logic.
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(str) {
    let c = 0xFFFFFFFF;
    for (const b of Buffer.from(String(str), 'utf8')) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (d) => d.toISOString().slice(0, 10);
const mdy = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const daysFromNow = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d; };
const jobDate = (id) => daysFromNow(-(crc32(String(id)) % 3));
const jobCountry = (id) => JOB_COUNTRIES[(parseInt(id, 10) || 0) % JOB_COUNTRIES.length];

// Repairs upstream double-encoded UTF-8 ("Ã¢Â€Â™" style). Only fires when the
// telltale pattern (Â/â/ð followed by a C1 control char) is present.
function repairMojibake(s) {
    if (!s || !/[\u00c2\u00e2\u00f0][\u0080-\u00bf]/.test(s)) return s;
    if (/[^\u0000-\u00ff]/.test(s)) return s;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(s, 'latin1')) || s;
    } catch {
        return s;
    }
}

// Brand names in titles/descriptions → our brand (word-boundary, case-insensitive).
const BRAND_RE = /\b(?:Amazon|Aetna|Delta|CVS)\b/gi;
const brandReplace = (t) => (typeof t === 'string' && t !== '' ? t.replace(BRAND_RE, () => companyName) : t);

const ALLOWED_TAGS = 'p|br|strong|b|em|i|u|ul|ol|li|h1|h2|h3|h4|h5|h6|hr|blockquote|span|div';
const ALLOWED_SET = new Set(ALLOWED_TAGS.split('|'));
function stripTags(s, allowed = new Set()) {
    s = s.replace(/<!--[\s\S]*?(-->|$)/g, '')
        .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (m, t) => (allowed.has(t.toLowerCase()) ? m : ''));
    if (allowed.size) s = s.replace(new RegExp(`<(?!/?(?:${[...allowed].join('|')})\\b)`, 'gi'), '&lt;');
    return s;
}

const HEADINGS = '(Key (?:Details|Requirements|Responsibilities|Benefits|Skills|Qualifications)|Job Summary|Requirements|Responsibilities|Qualifications|Benefits|About (?:Us|the Role|the Company))';
const HEADING_SPLIT_RE = new RegExp(`(?<=[.?!])\\s+${HEADINGS}(?=\\s+[A-Z?])`, 'gu');
const HEADING_EXACT_RE = new RegExp(`^${HEADINGS}[\\s:]*$`, 'u');

function formatJobContent(content) {
    if (!content) return '';
    content = repairMojibake(content);
    content = content.replace(/rjs\.victorytuitions\.in/gi, '').replace(/remotejobs\.trendingnews(?:go)?\.com/gi, '');
    content = content.replace(/\[\/?[a-z0-9_-]+(?:[^\]]*)?\]/gi, '');
    content = content.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1').replace(/\bapply to this job\b/gi, '');
    content = stripTags(content, ALLOWED_SET);
    content = content.replace(/\s*on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/\s*style\s*=\s*("[^"]*"|'[^']*')/gi, '');
    content = content.replace(/\r\n|\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    content = content.replace(/<\/?p\b[^>]*>/gi, '\n\n').trim().replace(/\n{3,}/g, '\n\n');
    let blocks = content.split(/\n\s*\n/);

    const structured = blocks.map((b) => {
        b = b.trim();
        if (b === '' || bytes(b) <= 800 || /<(p|br|div|h[1-6]|ul|ol|li)\b/i.test(b)) return b;
        b = b.replace(HEADING_SPLIT_RE, '\n\n$1\n\n');
        const rebuilt = [];
        for (let sb of b.split(/\n\s*\n/)) {
            sb = sb.trim();
            if (sb === '' || bytes(sb) <= 500) { rebuilt.push(sb); continue; }
            const sentences = sb.split(/(?<=[.!?])\s+(?=[A-Z])/);
            if (sentences.length <= 3) { rebuilt.push(sb); continue; }
            for (let i = 0; i < sentences.length; i += 3) rebuilt.push(sentences.slice(i, i + 3).join(' ').trim());
        }
        return rebuilt.join('\n\n');
    });
    blocks = structured.join('\n\n').split(/\n\s*\n/);

    const out = [];
    for (let b of blocks) {
        b = b.trim();
        if (b === '') continue;
        if (stripTags(b).replace(/<br\s*\/?>|&nbsp;|\s+/gi, '') === '') continue;
        if (/^\s*<(div|h[1-6]|ul|ol|blockquote|hr|table)\b/i.test(b)) out.push(b);
        else if (HEADING_EXACT_RE.test(b)) out.push('<h3>' + e(b) + '</h3>');
        else out.push('<p>' + b.replace(/(\r\n|\n|\r)/g, '<br>$1') + '</p>');
    }
    return out.join('\n');
}

// ─── API Client ─────────────────────────────────────────────────────────────
const memo = new Map();
const MEMO_MAX = 500;

function apiHeaders() {
    const h = { Accept: 'application/json' };
    if (API_KEY) { h['X-Api-Key'] = API_KEY; h.Authorization = 'Bearer ' + API_KEY; }
    return h;
}

async function apiGet(ctx, path, ttl) {
    const hit = memo.get(path);
    if (hit && Date.now() - hit.at < ttl * 1000) return hit.data;

    let data = null;
    for (const ms of API_TIMEOUTS) {
        try {
            const r = await fetch(API_BASE + path, { headers: apiHeaders(), signal: AbortSignal.timeout(ms) });
            if (r.status === 404) { data = { __notfound: true }; break; }
            if (r.status === 200) {
                const j = await r.json();
                if (j !== null) { data = j; break; }
            }
        } catch { /* timeout / network / bad JSON → retry */ }
    }

    if (data === null) {
        ctx.failed = true;
        return hit ? hit.data : null;
    }
    memo.delete(path);
    memo.set(path, { at: Date.now(), data });
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
    return data;
}

const normalizeJob = (j) => (j && typeof j === 'object' && j.ID === undefined && j.id !== undefined ? { ...j, ID: j.id } : j);
const cleanJobs = (jobs) => (Array.isArray(jobs)
    ? jobs.map(normalizeJob).map((j) => (j && j.post_title !== undefined ? { ...j, post_title: brandReplace(j.post_title) } : j))
    : []);

async function getTotalJobs(ctx) {
    const d = await apiGet(ctx, '/api/jobs?page=1', API_TTL_INFO);
    return parseInt(d?.pagination?.totalJobs, 10) || 0;
}

async function getJobsPage(ctx, page) {
    const d = await apiGet(ctx, `/api/jobs?page=${Math.max(1, page | 0)}`, API_TTL_LIST);
    return cleanJobs(d?.jobs);
}

async function searchJobs(ctx, query, page) {
    const d = await apiGet(ctx, `/api/jobs?search=${encodeURIComponent(query)}&page=${Math.max(1, page | 0)}`, API_TTL_LIST);
    return d && Array.isArray(d.jobs) ? { ...d, jobs: cleanJobs(d.jobs) } : d;
}

async function getJobBySlug(ctx, slug) {
    const d = await apiGet(ctx, '/api/jobs/slug/' + encodeURIComponent(slug), API_TTL_JOB);
    if (!d || !d.job) return null;
    const job = normalizeJob(d.job);
    return {
        job: { ...job, post_title: brandReplace(job.post_title) },
        recentJobs: cleanJobs(d.recentJobs),
        randomJobs: cleanJobs(d.randomJobs),
    };
}

// ─── Sitemap Data ───────────────────────────────────────────────────────────
const sitemapCache = new Map();
const sitemapBuilding = new Map();
let sitemapDebug = null;
const SM_ROW = /"slug":("(?:[^"\\]|\\.)*"|null),"post_date":("(?:[^"\\]|\\.)*"|null)/g;

async function buildSitemapChunk(start, end) {
    const r = await fetch(API_BASE + '/api/sitemap-jobs', { headers: apiHeaders(), signal: AbortSignal.timeout(SITEMAP_TIMEOUT) });
    if (r.status !== 200) throw new Error('http ' + r.status);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    const lines = [];
    let buf = '', index = 0, done = false, expected = null;
    try {
        while (!done) {
            const { value, done: eof } = await reader.read();
            if (eof) break;
            buf += dec.decode(value, { stream: true });
            if (expected === null) { const t = /"total_jobs":(\d+)/.exec(buf); if (t) expected = +t[1]; }
            SM_ROW.lastIndex = 0;
            let m, last = 0;
            while ((m = SM_ROW.exec(buf)) !== null) {
                last = SM_ROW.lastIndex;
                if (index >= end) { done = true; break; }
                if (index++ < start) continue;
                const slug = m[1] === 'null' ? '' : JSON.parse(m[1]);
                if (slug === '' || slug.length > 200) continue;
                lines.push([slug, m[2] === 'null' ? '' : JSON.parse(m[2]).slice(0, 10)]);
            }
            buf = buf.slice(last);
        }
    } finally {
        reader.cancel().catch(() => {});
    }
    if (index === 0) throw new Error('extracted 0 rows');
    if (!done && expected !== null && index < Math.min(end, expected) - 10) throw new Error(`stream ended at row ${index} of ${expected}`);
    sitemapDebug = { success: true, error: null, range: [start, end], count: lines.length, expectedTotal: expected, builtAt: new Date().toISOString() };
    return lines;
}

async function getSitemapChunk(ctx, id) {
    const hit = sitemapCache.get(id);
    if (hit && Date.now() - hit.at < SITEMAP_TTL * 1000) return hit.lines;
    if (!sitemapBuilding.has(id)) {
        const p = buildSitemapChunk((id - 1) * URLS_PER_SITEMAP, id * URLS_PER_SITEMAP)
            .then((lines) => { sitemapCache.set(id, { at: Date.now(), lines }); return lines; })
            .finally(() => sitemapBuilding.delete(id));
        sitemapBuilding.set(id, p);
    }
    try {
        return await sitemapBuilding.get(id);
    } catch (err) {
        console.error('[sitemap] build failed:', err.message);
        sitemapDebug = { success: false, error: err.message, builtAt: new Date().toISOString() };
        ctx.failed = true;
        return hit ? hit.lines : [];
    }
}

// ═══ VIEWS ═════════════════════════════════════════════════════════════════
// WorkWisd layout: forest green dark hero, gold accent, system fonts,
// category switcher, speed cards in two columns beside a sticky category rail.
//
// URLs: /listing/<slug>, /lane/<field>[/<n>], /new/<n>, /search?q=,
//       /sitemap.xml -> /sitemap-lanes.xml + /sitemap-listings-<n>.xml

const V = {
    // Absolute origin for canonicals (set per request in handler()).
    origin: '',
    lanePath: (f) => '/lane/' + String(f).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-'),
    listingPath: (slug) => '/listing/' + slug,
};

const LANE_NAMES = { 'software development': 'Software Dev', 'web developer': 'Web Dev', 'content writing': 'Content Writing', 'technical support': 'Tech Support', 'call center': 'Call Center', 'data analyst': 'Data Analyst', 'business analyst': 'Business Analyst' };
const laneName = (f) => LANE_NAMES[f] || ucwords(f);

// The API's real post_date when it has one; otherwise the derived date.
function postedOn(job) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(job?.post_date || ''));
    const d = m ? new Date(m[1] + 'T00:00:00Z') : null;
    return d && !isNaN(d) && d <= new Date() ? d : jobDate(job?.ID);
}
const ago = (d) => {
    const days = Math.floor((Date.now() - d.getTime()) / 864e5);
    return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 30 ? `${days} days ago` : mdy(d);
};
function summary(html, len) {
    const t = repairMojibake(String(html || '')).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (t.length <= len) return t;
    const cut = t.slice(0, len);
    return cut.slice(0, Math.max(cut.lastIndexOf(' '), len - 20)).replace(/[,;:.\s-]+$/, '') + '…';
}
const tidyTitle = (t) => String(t || '').replace(/\u0096/g, '\u2013').replace(/\u0097/g, '\u2014').replace(/[\u0080-\u009f]/g, '').replace(/\s+/g, ' ').trim();
const tidyJobs = (jobs) => (jobs || []).map((j) => ({ ...j, post_title: tidyTitle(j.post_title) }));
const reorder = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ldJson = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const toTitle = (t) => (/\bremote\b/i.test(t) ? t : `${t} (Remote)`);

// Favicon: forest green circle with W letter in gold.
const vFavicon = 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="16" fill="${cfg.faviconBg || '#1A4731'}"/><text x="16" y="23" font-family="system-ui,Arial,sans-serif" font-weight="800" font-size="20" fill="${cfg.faviconFg || '#D4A017'}" text-anchor="middle">W</text></svg>`);
const vMark = '';
const bolt = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor"/></svg>';

function vHead({ title, desc, canonical, robots = 'index, follow, max-image-preview:large', og = {}, ld = '', links = '' }) {
    const url = canonical || V.origin + '/';
    const indexable = !robots.includes('noindex');
    return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e(title)}</title>
<meta name="description" content="${e(desc || metaDesc)}">
<meta name="robots" content="${robots}">
<meta name="googlebot" content="${robots}">
${indexable ? `<link rel="canonical" href="${e(url)}">` : ''}
${links}<meta property="og:site_name" content="${e(companyName)}">
<meta property="og:type" content="${og.type || 'website'}">
<meta property="og:url" content="${e(url)}">
<meta property="og:title" content="${e(og.title || ogTitle || title)}">
<meta property="og:description" content="${e(og.desc || ogDesc || desc || metaDesc)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${e(og.title || ogTitle || title)}">
<meta name="keywords" content="${e(metaKeywords)}">
<link rel="icon" type="image/svg+xml" href="${vFavicon}">
<meta name="theme-color" content="#1A4731">
<style>${CSS}</style>
${ld}</head>`;
}

const vNav = () => `<header class="vn"><div class="vn-in">
    <a class="vn-logo" href="${vMark}"<b>${e(companyName)}</b></a>
    <nav class="vn-links" aria-label="Main"><a href="/new/2">New roles</a><a href="/#lanes">Categories</a><a href="/#fast">One-click apply</a></nav>
    <a class="vn-cta" href="/search">${bolt} Search</a>
</div></header>`;

function vFoot() {
    const lanes = [...JOB_CATEGORIES].sort((a, b) => laneName(a).localeCompare(laneName(b)));
    const third = Math.ceil(lanes.length / 3);
    const col = (arr) => `<ul>${arr.map((f) => `<li><a href="${V.lanePath(f)}">${e(laneName(f))}</a></li>`).join('')}</ul>`;
    return `<section class="vf-cta"><div class="vw"><div><h2>Ready to find your next role?</h2><p>Search every remote role in one box.</p></div><form action="/search" method="GET" class="vf-form" role="search"><label class="vh" for="vq-foot">Job title or skill</label><input id="vq-foot" type="search" name="q" placeholder="Job title or skill"><button type="submit">Go</button></form></div></section>
<footer class="vf"><div class="vw">
    <div class="vf-grid">
        <div class="vf-brand"><a class="vn-logo" href="/">${vMark}<b>${e(companyName)}</b></a><p>${e(tagline)}. Fresh remote roles, newest first &mdash; every one opens with one-click apply.</p></div>
        <div><h3>Categories A&ndash;F</h3>${col(lanes.slice(0, third))}</div>
        <div><h3>Categories G&ndash;S</h3>${col(lanes.slice(third, third * 2))}</div>
        <div><h3>Categories S&ndash;Z</h3>${col(lanes.slice(third * 2))}</div>
    </div>
    <div class="vf-base"><span>&copy; ${new Date().getUTCFullYear()} ${e(companyName)}</span><span><a href="/new/2">New roles</a> &middot; <a href="/search">Search</a> &middot; <a href="/sitemap.xml">Sitemap</a></span></div>
</div></footer>`;
}

const vPage = (headHtml, body) => `${headHtml}\n<body class="v">\n${vNav()}\n<main>${body}</main>\n${vFoot()}\n</body>\n</html>`;

const vSearch = (q = '', id = 'vq', big = false) => `<form action="/search" method="GET" class="vs${big ? ' vs-big' : ''}" role="search">
    <label class="vh" for="${id}">Job title or skill</label>
    <input id="${id}" type="search" name="q" value="${e(q)}" placeholder="${big ? 'What do you want to do next?' : 'Job title or skill'}" autocomplete="off">
    <button type="submit">${big ? 'Find roles' : 'Find'}</button>
</form>`;

const laneSwitch = (lanes, current = '') => `<nav class="lanes-x" aria-label="Categories">${lanes.map((f) => `<a href="${V.lanePath(f)}"${f === current ? ' aria-current="page"' : ''}>${e(laneName(f))}</a>`).join('')}</nav>`;

function speedCard(job) {
    const d = postedOn(job);
    const fresh = Date.now() - d.getTime() < 2 * 864e5;
    return `<a class="sc" href="${V.listingPath(e(job.slug || ''))}">
        <span class="sc-top">${fresh ? `<em>${bolt} New</em>` : ''}<time datetime="${ymd(d)}">${e(ago(d))}</time></span>
        <strong>${e(job.post_title || '')}</strong>
        <span class="sc-meta">Remote &middot; ${e(jobCountry(job.ID).name)}</span>
    </a>`;
}
const speedGrid = (jobs) => `<div class="sg">${jobs.map(speedCard).join('')}</div>`;

const laneRail = (current = '') => `<aside class="rail-v" id="lanes" aria-label="All categories"><h2>Categories</h2><ul>${[...JOB_CATEGORIES].sort((a, b) => laneName(a).localeCompare(laneName(b))).map((f) => `<li><a href="${V.lanePath(f)}"${f === current ? ' aria-current="page"' : ''}>${e(laneName(f))}<span aria-hidden="true">&rsaquo;</span></a></li>`).join('')}</ul></aside>`;

function pager(cur, total, href) {
    if (total <= 1) return '';
    const nums = [...new Set([1, cur - 1, cur, cur + 1, total])].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    let prev = 0, out = '';
    for (const n of nums) {
        if (prev && n > prev + 1) out += '<span class="pg-x">…</span>';
        out += n === cur ? `<span class="pg-on" aria-current="page">${fmt(n)}</span>` : `<a href="${href(n)}">${fmt(n)}</a>`;
        prev = n;
    }
    return `<nav class="pg-v" aria-label="Pagination">${cur > 1 ? `<a class="pg-arrow" href="${href(cur - 1)}">&larr;</a>` : ''}${out}${cur < total ? `<a class="pg-arrow" href="${href(cur + 1)}">&rarr;</a>` : ''}</nav>`;
}

const fastSteps = () => `<section class="fast" id="fast"><div class="vw"><h2>Three steps to your next role</h2><ol>
    <li><b>01</b><h3>Search</h3><p>Type a title or skill, or browse one of ${JOB_CATEGORIES.length} categories.</p></li>
    <li><b>02</b><h3>Read</h3><p>Every listing is the full post, so you know before you click.</p></li>
    <li><b>03</b><h3>Apply</h3><p>One-click apply straight to the listing. No account on ${e(companyName)} needed.</p></li>
</ol></div></section>`;

function vNotice(code, title, h1, text, extra) {
    return vPage(vHead({ title, robots: 'noindex, follow' }), `<section class="v-miss"><div class="vw"><p class="v-code">${code}</p><h1>${h1}</h1><p>${text}</p>${extra}</div></section>`);
}

// ── Home + "new" pages ──────────────────────────────────────────────────────
async function homeView(ctx, want) {
    const total = await getTotalJobs(ctx);
    const pages = Math.max(1, Math.ceil(total / JOBS_PER_PAGE));
    const n = Math.max(1, Math.min(want, pages));
    const jobs = tidyJobs(await getJobsPage(ctx, n));
    const href = (i) => (i === 1 ? '/' : `/new/${i}`);
    let links = '';
    if (n > 1) links += `<link rel="prev" href="${V.origin}${href(n - 1)}">\n`;
    if (n < pages) links += `<link rel="next" href="${V.origin}/new/${n + 1}">\n`;

    if (n === 1) {
        reorder(jobs);
        const ld = ldJson({ '@context': 'https://schema.org', '@type': 'Organization', name: companyName, url: V.origin + '/', slogan: tagline }) + '\n';
        const body = `<section class="launch"><div class="vw">
        <p class="launch-k">${bolt} Remote roles live &middot; newest first</p>
        <h1>${heroTitle}</h1>
        <p class="launch-sub">One search box, ${JOB_CATEGORIES.length} categories, zero sign-ups. Read the full listing and apply in one click.</p>
        ${vSearch('', 'vq-hero', true)}
        ${laneSwitch(JOB_CATEGORIES.slice(0, 10))}
    </div></section>
    <section class="pace"><div class="vw pace-in">
        <div><b>Thousands</b><span>of roles live now</span></div>
        <div><b>${JOB_CATEGORIES.length}</b><span>categories to browse</span></div>
        <div><b>0</b><span>accounts needed</span></div>
    </div></section>
    <div class="vw split">
        <section aria-labelledby="new-h"><div class="sec-v"><h2 id="new-h">New in the last 48 hours</h2><a href="/new/2">All new roles &rarr;</a></div>${speedGrid(jobs)}</section>
        ${laneRail()}
    </div>
    ${fastSteps()}`;
        return { body: vPage(vHead({ title: `${companyName} | ${tagline}`, desc: metaDesc, canonical: V.origin + '/', ld, links }), body), ttl: TTL.list };
    }
    const body = `<section class="band-v"><div class="vw"><p class="crumbs-v"><a href="/">${e(companyName)}</a> &rsaquo; New roles</p><h1>New remote roles <span>page ${fmt(n)}</span></h1><p>Hundreds of pages, newest first</p>${vSearch('', 'vq-new')}</div></section>
    <div class="vw split"><section>${speedGrid(jobs)}${pager(n, pages, href)}</section>${laneRail()}</div>`;
    return {
        body: vPage(vHead({ title: `New Remote Jobs, Page ${fmt(n)} | ${companyName}`, desc: `Page ${fmt(n)} of the newest remote jobs on ${companyName}. Full listings, one-click apply, no account.`, canonical: `${V.origin}/new/${n}`, links }), body),
        ttl: TTL.list,
    };
}

// ── Listing (job) ───────────────────────────────────────────────────────────
async function listingView(ctx, slug) {
    const res = await getJobBySlug(ctx, slug);
    if (!res) {
        if (ctx.failed) return unavailable();
        return { body: vNotice('410', `Role closed — ${companyName}`, 'This role has closed', 'It stopped taking applications. Plenty more are live in these categories.', laneSwitch(JOB_CATEGORIES.slice(0, 8)) + '<p><a class="v-btn" href="/">See live roles</a></p>'), status: 410, ttl: TTL.miss };
    }
    const job = { ...res.job, post_title: tidyTitle(res.job.post_title) };
    const content = brandReplace(job.post_content || '');
    const apply = applyUrl(job.permalink);
    const where = jobCountry(job.ID);
    const d = postedOn(job);
    const url = V.origin + V.listingPath(slug);
    const has = (w) => new RegExp('\\b' + w + '\\b', 'i').test(job.post_title);
    const lane = JOB_CATEGORIES.find((f) => has(f)) || null;
    const next = tidyJobs(reorder([...res.recentJobs, ...res.randomJobs]).slice(0, 6));
    const sum = summary(content, 160);

    const ld = ldJson({
        '@context': 'https://schema.org', '@type': 'JobPosting',
        title: job.post_title, description: safeSubstr(content, 5000), datePosted: ymd(d), validThrough: ymd(daysFromNow(30)),
        employmentType: 'FULL_TIME', jobLocationType: 'TELECOMMUTE',
        applicantLocationRequirements: { '@type': 'Country', name: 'Worldwide' },
        jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: where.iso } },
        hiringOrganization: { '@type': 'Organization', name: companyName, sameAs: V.origin },
        url,
    }) + '\n' + ldJson({
        '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: companyName, item: V.origin + '/' },
            lane ? { '@type': 'ListItem', position: 2, name: `${laneName(lane)} category`, item: V.origin + V.lanePath(lane) } : { '@type': 'ListItem', position: 2, name: 'New roles', item: V.origin + '/new/2' },
            { '@type': 'ListItem', position: 3, name: job.post_title, item: url },
        ],
    }) + '\n';
    const btn = (t, cls = 'v-btn') => `<a class="${cls}" href="${e(apply)}" rel="nofollow noopener" target="_blank">${t} &rarr;</a>`;
    const body = `<section class="lh"><div class="vw">
        <p class="crumbs-v"><a href="/">${e(companyName)}</a> &rsaquo; ${lane ? `<a href="${V.lanePath(lane)}">${e(laneName(lane))}</a>` : '<a href="/new/2">New roles</a>'}</p>
        <h1>${e(job.post_title)}</h1>
        <div class="lh-row">
            <ul class="chips-v"><li>Remote</li><li>${e(where.name)}</li><li>Full-time</li><li><time datetime="${ymd(d)}">${e(ago(d))}</time></li></ul>
            ${btn('One-click apply', 'v-btn v-btn-big')}
        </div>
    </div></section>
    <div class="vw read-v">
        ${sum ? `<p class="tldr"><b>In short:</b> ${e(sum)}</p>` : ''}
        <article class="body-v">${formatJobContent(content)}</article>
        <div class="end-v"><div><h2>Apply now</h2><p>You&rsquo;ll apply directly on the listing. It takes just a minute.</p></div>${btn('One-click apply')}</div>
    </div>
    ${next.length ? `<section class="vw nextup"><div class="sec-v"><h2>Next up</h2>${lane ? `<a href="${V.lanePath(lane)}">More in ${e(laneName(lane))} &rarr;</a>` : ''}</div>${speedGrid(next)}</section>` : ''}`;
    return {
        body: vPage(vHead({ title: `${toTitle(job.post_title)} – One-Click Apply | ${siteName}`, desc: sum || job.post_title, canonical: url, og: { type: 'article', title: toTitle(job.post_title), desc: summary(content, 200) }, ld }), body),
        ttl: TTL.job,
    };
}

// ── Lane (field) + search ───────────────────────────────────────────────────
async function laneView(ctx, q, want = 1) {
    const n = Math.max(1, want);
    let jobs = [], count = 0, pages = 1;
    if (q.length >= 2) {
        const r = await searchJobs(ctx, q, n);
        if (r && r.jobs && r.jobs.length) {
            jobs = tidyJobs(r.jobs);
            count = parseInt(r.pagination?.totalJobs ?? jobs.length, 10);
            pages = parseInt(r.pagination?.totalPages ?? 1, 10);
        }
    }
    const fixed = JOB_CATEGORIES.find((f) => f.toLowerCase() === q.toLowerCase());
    const name = fixed ? laneName(fixed) : ucwords(q.replace(/\bremote\b/gi, '').trim() || q);
    const root = q ? V.lanePath(q) : '/search';
    const href = (i) => (i === 1 ? root : `${root}/${i}`);
    const robots = !fixed || !jobs.length ? 'noindex, follow' : undefined;
    const status = q !== '' && !jobs.length && !ctx.failed ? 404 : 200;
    let links = '';
    if (n > 1) links += `<link rel="prev" href="${V.origin}${href(n - 1)}">\n`;
    if (n < pages) links += `<link rel="next" href="${V.origin}${href(n + 1)}">\n`;
    const others = JOB_CATEGORIES.filter((f) => f.toLowerCase() !== q.toLowerCase());
    const s0 = crc32(q.toLowerCase()) % Math.max(1, others.length);
    const near = Array.from({ length: Math.min(8, others.length) }, (_, i) => others[(s0 + i) % others.length]);
    const line = fixed && jobs.length && n === 1
        ? [`Remote ${name} roles are live right now. Newest first, full listings, one-click apply.`,
            `Switch into ${name}: remote openings sorted by what landed most recently.`,
            `The ${name} category: roles you can do from anywhere. Read the listing, then one-click apply.`][crc32(name.toLowerCase()) % 3]
        : '';
    const body = `<section class="band-v"><div class="vw">
        <p class="crumbs-v"><a href="/">${e(companyName)}</a> &rsaquo; ${q ? `<a href="/#lanes">Categories</a> &rsaquo; ${e(name)}` : 'Search'}</p>
        <h1>${q ? `Remote ${e(name)} jobs <span>${jobs.length ? `${fmt(count)} live` : ''}</span>` : 'Search remote roles'}</h1>
        ${line ? `<p>${line}</p>` : ''}
        ${vSearch(q, 'vq-lane')}
        ${laneSwitch(near)}
    </div></section>
    <div class="vw split"><section>${jobs.length ? speedGrid(jobs) + pager(n, pages, href)
        : q ? `<div class="v-empty"><h2>No live roles for &ldquo;${e(q)}&rdquo;</h2><p>Try a shorter title or switch categories.</p><a class="v-btn" href="/">See live roles</a></div>`
            : '<div class="v-empty"><h2>What&rsquo;s your next move?</h2><p>Type a title or skill above, or pick a category.</p></div>'}</section>${laneRail(fixed || '')}</div>`;
    const title = q
        ? (n > 1 ? `Remote ${name} Jobs, Page ${fmt(n)} | ${companyName}` : `Remote ${name} Jobs Hiring Now | ${companyName}`)
        : `Search Remote Jobs | ${siteName}`;
    const desc = q
        ? `Remote ${name} jobs hiring now on ${companyName}. Newest first, full listings, one-click apply.`
        : `Search remote jobs by title or skill across ${JOB_CATEGORIES.length} categories on ${companyName}.`;
    return { body: vPage(vHead({ title, desc, canonical: V.origin + href(n), robots, links }), body), status, ttl: status === 200 ? TTL.field : TTL.miss };
}

// ── Sitemaps + robots ───────────────────────────────────────────────────────
async function sitemapView(ctx, id) {
    const x = { type: 'application/xml; charset=utf-8', ttl: TTL.sitemap, headers: { 'X-Robots-Tag': 'noindex' } };
    const day = ymd(new Date());
    const set = (rows) => '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows.join('') + '</urlset>';
    if (id === 'lanes') {
        return { ...x, body: set([V.origin + '/', ...JOB_CATEGORIES.map((f) => V.origin + V.lanePath(f))].map((l) => `<url><loc>${l}</loc><lastmod>${day}</lastmod><changefreq>hourly</changefreq></url>\n`)) };
    }
    const total = await getTotalJobs(ctx);
    if (!total) return { ...x, body: '<?xml version="1.0" encoding="UTF-8"?><error>Upstream API unavailable.</error>' };
    const files = Math.ceil(total / URLS_PER_SITEMAP);
    if (id === 0) {
        let s = '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        s += `<sitemap><loc>${V.origin}/sitemap-lanes.xml</loc><lastmod>${day}</lastmod></sitemap>\n`;
        for (let i = 1; i <= files; i++) s += `<sitemap><loc>${V.origin}/sitemap-listings-${i}.xml</loc><lastmod>${day}</lastmod></sitemap>\n`;
        return { ...x, body: s + '</sitemapindex>' };
    }
    if (id < 1 || id > files) return { ...x, status: 404, ttl: TTL.miss, body: '<?xml version="1.0" encoding="UTF-8"?><error>Not found</error>' };
    const rows = (await getSitemapChunk(ctx, id)).map(([slug, date]) => `<url><loc>${V.origin}${V.listingPath(e(slug))}</loc><lastmod>${date || day}</lastmod></url>\n`);
    return { ...x, body: set(rows) };
}

const robotsView = () => ({
    body: GOOGLE_BOTS.map((b) => `User-agent: ${b}\nAllow: /\n`).join('\n') + `\nUser-agent: *\nDisallow: /\n\nSitemap: ${V.origin}/sitemap.xml\n`,
    type: 'text/plain; charset=utf-8', ttl: TTL.robots,
});

const unavailable = () => ({ body: 'Temporarily unavailable. Please try again shortly.', status: 503, type: 'text/plain; charset=utf-8', noStore: true, headers: { 'Retry-After': '30' } });
const permanent = (to) => ({ status: 301, location: V.origin + to, ttl: TTL.robots });

// ═══ CLOUDFLARE RESPONSE ══════════════════════════════════════════════════════

const SECURITY_HEADERS = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), interest-cohort=()',
};

function toResponse(ctx, r) {
    const status = r.status || 200;
    const headers = { ...SECURITY_HEADERS, ...(r.headers || {}) };
    if (r.location) headers.Location = r.location;
    else headers['Content-Type'] = r.type || 'text/html; charset=UTF-8';
    if (r.noStore || ctx.failed || !r.ttl) {
        headers['Cache-Control'] = 'no-store';
    } else {
        headers['Cache-Control'] = 'public, max-age=300';
    }
    return new Response(r.location ? null : r.body, { status, headers });
}

// ═══ ROUTES ════════════════════════════════════════════════════════════════

const ROUTES = [
    [/^\/$/, (ctx) => homeView(ctx, 1)],
    [/^\/new\/(\d+)$/, (ctx, m) => (m[1] === '1' ? permanent('/') : homeView(ctx, +m[1]))],
    [/^\/new$/, () => permanent('/new/2')],
    [/^\/listing\/(.+)$/, (ctx, m) => { let s = m[1]; try { s = decodeURIComponent(s); } catch { /* raw */ } return listingView(ctx, s); }],
    [/^\/search$/, (ctx, m, url) => { const q = (url.searchParams.get('q') || '').trim(); return q ? { status: 301, location: V.origin + V.lanePath(q), noStore: true } : laneView(ctx, ''); }],
    [/^\/lane$/, () => permanent('/#lanes')],
    [/^\/lane\/([a-z0-9-]+)$/, (ctx, m) => laneView(ctx, m[1].replace(/-/g, ' '), 1)],
    [/^\/lane\/([a-z0-9-]+)\/(\d+)$/, (ctx, m) => (m[2] === '1' ? permanent('/lane/' + m[1]) : laneView(ctx, m[1].replace(/-/g, ' '), +m[2]))],
    [/^\/sitemap\.xml$/, (ctx) => sitemapView(ctx, 0)],
    [/^\/sitemap-lanes\.xml$/, (ctx) => sitemapView(ctx, 'lanes')],
    [/^\/sitemap-listings-(\d+)\.xml$/, (ctx, m) => sitemapView(ctx, +m[1])],
    [/^\/robots\.txt$/, () => robotsView()],
    [/^\/health$/, () => ({ body: 'OK', type: 'text/plain; charset=utf-8', noStore: true })],
    [/^\/sitemap-debug$/, () => ({ body: JSON.stringify({ lastBuild: sitemapDebug, slicesInMemory: sitemapCache.size, apiBase: API_BASE, tokenSet: API_KEY !== '' }), type: 'application/json; charset=utf-8', noStore: true, headers: { 'X-Robots-Tag': 'noindex' } })],
];

async function dispatch(ctx, url) {
    const path = url.pathname.replace(/\/+$/, '') || '/';
    for (const [re, fn] of ROUTES) {
        const m = path.match(re);
        if (m) return fn(ctx, m, url);
    }
    return { body: vNotice('404', `Page not found — ${companyName}`, 'Wrong turn', 'That page isn&rsquo;t here. Search a role or browse categories.', vSearch('', 'vq-404') + laneSwitch(JOB_CATEGORIES.slice(0, 8))), status: 404, ttl: TTL.miss };
}

export async function handler(request, context) {
    V.origin = (env('SITE_URL') || cfg.baseUrl || context?.site?.url || new URL(request.url).origin).replace(/\/+$/, '');
    const ctx = { failed: false };
    try {
        return toResponse(ctx, await dispatch(ctx, new URL(request.url)));
    } catch (err) {
        console.error('[workwisd] render error:', err);
        return new Response('Something went wrong. Please try again shortly.', {
            status: 500,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
    }
}

export async function handle(url, origin) {
    V.origin = (env('SITE_URL') || origin).replace(/\/+$/, '');
    const ctx = { failed: false };
    try {
        const r = await dispatch(ctx, url);
        return { body: r.body || '', status: r.status || 200, ttl: r.ttl || 0, type: r.type || 'text/html; charset=UTF-8', headers: r.headers || {}, location: r.location };
    } catch (err) {
        console.error('[workwisd] handle error:', err);
        return { body: 'Something went wrong.', status: 500, ttl: 0, type: 'text/plain; charset=utf-8', headers: {} };
    }
}
