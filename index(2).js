const express = require('express');
const { addonBuilder } = require('stremio-addon-sdk');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const httpClient = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ar-EG,ar;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="124", "Chromium";v="124"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
  },
  maxRedirects: 5,
});

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await httpClient({
        url,
        method: options.method || 'GET',
        data: options.data,
        headers: { ...httpClient.defaults.headers, ...(options.headers || {}) },
        responseType: options.responseType || 'text',
      });
    } catch (err) {
      if (i === retries - 1) throw err;
      if (err.response?.status === 429 || err.response?.status === 403) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      } else throw err;
    }
  }
}

async function fetchDocument(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  return cheerio.load(response.data);
}

function normalizeUrl(url, base) {
  if (!url || typeof url !== 'string') return null;
  url = url.trim();
  if (url.startsWith('#') || url.toLowerCase().startsWith('javascript:')) return null;
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  const baseUrl = new URL(base);
  return new URL(url, baseUrl.origin + baseUrl.pathname).href;
}

function extractQuality(name) {
  if (!name) return null;
  const match = name.match(/(1080p|720p|480p|360p|240p|4K|2160p)/i);
  return match ? match[1] : null;
}

// ═══════════════════════════════════════════════════════════════
// FASELHD PROVIDER
// ═══════════════════════════════════════════════════════════════
const FASEL_BASE = 'https://www.faselhd.club';

function faselMeta(id, title, poster, year, type = 'movie') {
  return { id: `faselhd:${type}:${id}`, name: title, type, poster, background: poster, year: year ? parseInt(year) : undefined };
}

async function faselSearch(query) {
  const results = [];
  try {
    const $ = await fetchDocument(`${FASEL_BASE}/?s=${encodeURIComponent(query)}`);
    $('.postDiv').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const href = link.attr('href');
      const title = link.attr('title') || $el.find('h3').text() || $el.find('.h1').text();
      const img = $el.find('img').attr('src') || $el.find('img').attr('data-src');
      const year = ($el.find('.year').text() || '').match(/\d{4}/)?.[0];
      if (href && title) {
        results.push(faselMeta(href, title.trim(), normalizeUrl(img, FASEL_BASE), year, href.includes('/series/') || href.includes('/season/') ? 'series' : 'movie'));
      }
    });
  } catch (e) { console.error('[FaselHD] search:', e.message); }
  return results;
}

async function faselStreams(id) {
  const streams = [];
  try {
    const $ = await fetchDocument(id);
    const scriptText = $('script').map((_, el) => $(el).html()).get().join(' ');
    const urls = scriptText.match(/https?:\/\/[^\s'"\]+\.(mp4|m3u8|mkv)[^\s'"]*/gi) || [];
    $('video source, .player source').each((_, el) => { const src = $(el).attr('src'); if (src) urls.push(src); });

    const iframe = $('iframe').attr('src');
    if (iframe) {
      try {
        const i$ = await fetchDocument(normalizeUrl(iframe, FASEL_BASE));
        const itxt = i$('script').map((_, el) => i$(el).html()).get().join(' ');
        (itxt.match(/https?:\/\/[^\s'"\]+\.(mp4|m3u8|mkv)[^\s'"]*/gi) || []).forEach(u => urls.push(u));
      } catch (e) {
        streams.push({ name: 'FaselHD', title: 'External Player', externalUrl: normalizeUrl(iframe, FASEL_BASE) });
      }
    }

    const seen = new Set();
    for (const url of urls) {
      const n = normalizeUrl(url, FASEL_BASE);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      const q = extractQuality(n) || 'HD';
      streams.push({ name: `FaselHD ${q}`, title: q, url: n, behaviorHints: { notWebReady: n.endsWith('.m3u8'), bingeGroup: `faselhd-${q}` } });
    }
    const sub = $('track[kind="subtitles"]').attr('src');
    if (sub && streams.length) streams[0].subtitles = [{ url: normalizeUrl(sub, FASEL_BASE), lang: 'ara' }];
  } catch (e) { console.error('[FaselHD] streams:', e.message); }
  return streams;
}

async function faselSeriesStreams(id, season, episode) {
  try {
    const $ = await fetchDocument(id);
    let sUrl = id;
    for (const el of $('a[href*="season"], a[href*="موسم"]').toArray()) {
      const href = $(el).attr('href');
      const num = ($(el).text().match(/\d+/) || [])[0];
      if (num && parseInt(num) === season) { sUrl = normalizeUrl(href, FASEL_BASE); break; }
    }
    const s$ = await fetchDocument(sUrl);
    let eUrl = sUrl;
    for (const el of s$('a[href*="episode"], a[href*="حلقة"]').toArray()) {
      const href = s$(el).attr('href');
      const num = (s$(el).text().match(/\d+/) || [])[0];
      if (num && parseInt(num) === episode) { eUrl = normalizeUrl(href, FASEL_BASE); break; }
    }
    return faselStreams(eUrl);
  } catch (e) { console.error('[FaselHD] series:', e.message); }
  return [];
}

async function faselCatalog(type, genre, skip) {
  const results = [];
  try {
    let url = type === 'series' ? (genre ? `${FASEL_BASE}/series/category/${genre}/` : `${FASEL_BASE}/series/`) : (genre ? `${FASEL_BASE}/category/${genre}/` : `${FASEL_BASE}/`);
    if (skip > 0) url += `page/${Math.floor(skip / 20) + 1}/`;
    const $ = await fetchDocument(url);
    $('.postDiv').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const href = link.attr('href');
      const title = link.attr('title') || $el.find('h3').text() || $el.find('.h1').text();
      const img = $el.find('img').attr('src') || $el.find('img').attr('data-src');
      const year = ($el.find('.year').text() || '').match(/\d{4}/)?.[0];
      if (href && title) results.push(faselMeta(href, title.trim(), normalizeUrl(img, FASEL_BASE), year, type));
    });
  } catch (e) { console.error('[FaselHD] catalog:', e.message); }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// EGYDEAD PROVIDER
// ═══════════════════════════════════════════════════════════════
const EGY_BASE = 'https://egydead.fyi';

function egyMeta(id, title, poster, year, type = 'movie') {
  return { id: `egydead:${type}:${id}`, name: title, type, poster, background: poster, year: year ? parseInt(year) : undefined };
}

async function egySearch(query) {
  const results = [];
  try {
    const $ = await fetchDocument(`${EGY_BASE}/?s=${encodeURIComponent(query)}`);
    $('.Grid--MycimaPosts > li, .MovieBlock').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const href = link.attr('href');
      const title = link.attr('title') || $el.find('h3').text() || $el.find('.h1').text();
      const img = $el.find('img').attr('src') || $el.find('img').attr('data-src');
      const year = ($el.find('.year, .num, .number').text() || '').match(/\d{4}/)?.[0];
      if (href && title) {
        results.push(egyMeta(href, title.trim(), normalizeUrl(img, EGY_BASE), year, href.includes('/series/') || href.includes('/season/') ? 'series' : 'movie'));
      }
    });
  } catch (e) { console.error('[EgyDead] search:', e.message); }
  return results;
}

async function egyStreams(id) {
  const streams = [];
  try {
    const $ = await fetchDocument(id);
    const scriptText = $('script').map((_, el) => $(el).html()).get().join(' ');
    const urls = scriptText.match(/https?:\/\/[^\s'"\]+\.(mp4|m3u8|mkv)[^\s'"]*/gi) || [];
    $('video source, .player source, source').each((_, el) => { const src = $(el).attr('src'); if (src) urls.push(src); });
    $('.download-link, a[href*=".mp4"], a[href*=".m3u8"]').each((_, el) => { const href = $(el).attr('href'); if (href) urls.push(href); });

    const iframe = $('iframe').attr('src');
    if (iframe) {
      try {
        const i$ = await fetchDocument(normalizeUrl(iframe, EGY_BASE));
        const itxt = i$('script').map((_, el) => i$(el).html()).get().join(' ');
        (itxt.match(/https?:\/\/[^\s'"\]+\.(mp4|m3u8|mkv)[^\s'"]*/gi) || []).forEach(u => urls.push(u));
      } catch (e) {
        streams.push({ name: 'EgyDead', title: 'External Player', externalUrl: normalizeUrl(iframe, EGY_BASE) });
      }
    }

    const seen = new Set();
    for (const url of urls) {
      const n = normalizeUrl(url, EGY_BASE);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      const q = extractQuality(n) || 'HD';
      streams.push({ name: `EgyDead ${q}`, title: q, url: n, behaviorHints: { notWebReady: n.endsWith('.m3u8'), bingeGroup: `egydead-${q}` } });
    }
    const sub = $('track[kind="subtitles"]').attr('src');
    if (sub && streams.length) streams[0].subtitles = [{ url: normalizeUrl(sub, EGY_BASE), lang: 'ara' }];
  } catch (e) { console.error('[EgyDead] streams:', e.message); }
  return streams;
}

async function egySeriesStreams(id, season, episode) {
  try {
    const $ = await fetchDocument(id);
    let sUrl = id;
    for (const el of $('a[href*="season"], a[href*="موسم"]').toArray()) {
      const href = $(el).attr('href');
      const num = ($(el).text().match(/\d+/) || [])[0];
      if (num && parseInt(num) === season) { sUrl = normalizeUrl(href, EGY_BASE); break; }
    }
    const s$ = await fetchDocument(sUrl);
    let eUrl = sUrl;
    for (const el of s$('a[href*="episode"], a[href*="حلقة"]').toArray()) {
      const href = s$(el).attr('href');
      const num = (s$(el).text().match(/\d+/) || [])[0];
      if (num && parseInt(num) === episode) { eUrl = normalizeUrl(href, EGY_BASE); break; }
    }
    return egyStreams(eUrl);
  } catch (e) { console.error('[EgyDead] series:', e.message); }
  return [];
}

async function egyCatalog(type, genre, skip) {
  const results = [];
  try {
    let url = type === 'series' ? (genre ? `${EGY_BASE}/series/category/${genre}/` : `${EGY_BASE}/series/`) : (genre ? `${EGY_BASE}/category/${genre}/` : `${EGY_BASE}/`);
    if (skip > 0) url += `page/${Math.floor(skip / 20) + 1}/`;
    const $ = await fetchDocument(url);
    $('.Grid--MycimaPosts > li, .MovieBlock').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const href = link.attr('href');
      const title = link.attr('title') || $el.find('h3').text() || $el.find('.h1').text();
      const img = $el.find('img').attr('src') || $el.find('img').attr('data-src');
      const year = ($el.find('.year, .num, .number').text() || '').match(/\d{4}/)?.[0];
      if (href && title) results.push(egyMeta(href, title.trim(), normalizeUrl(img, EGY_BASE), year, type));
    });
  } catch (e) { console.error('[EgyDead] catalog:', e.message); }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// STREMIO ADDON
// ═══════════════════════════════════════════════════════════════
const PROVIDERS = [
  { id: 'faselhd', name: 'FaselHD', search: faselSearch, getMovieStreams: faselStreams, getSeriesStreams: faselSeriesStreams, getCatalog: faselCatalog },
  { id: 'egydead', name: 'EgyDead', search: egySearch, getMovieStreams: egyStreams, getSeriesStreams: egySeriesStreams, getCatalog: egyCatalog },
];

const manifest = {
  id: 'org.arabicstreams.stremio',
  version: '1.0.0',
  name: 'Arabic Streams',
  description: 'Arabic movies and series from FaselHD and EgyDead',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Stremio_logo.svg/1200px-Stremio_logo.svg.png',
  background: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1920',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'arabic_movies', name: 'Arabic Movies', genres: ['Action', 'Comedy', 'Drama', 'Horror', 'Romance', 'Thriller'], extra: [{ name: 'search' }, { name: 'skip' }] },
    { type: 'series', id: 'arabic_series', name: 'Arabic Series', genres: ['Action', 'Comedy', 'Drama', 'Horror', 'Romance', 'Thriller'], extra: [{ name: 'search' }, { name: 'skip' }] },
  ],
  idPrefixes: PROVIDERS.map(p => p.id),
  behaviorHints: { configurable: false, configurationRequired: false },
};

const builder = new addonBuilder(manifest);

function parseId(id) {
  const parts = id.split(':');
  if (parts.length < 3) return null;
  return { providerId: parts[0], type: parts[1], contentId: parts.slice(2).join(':') };
}

builder.defineCatalogHandler(async (args) => {
  const { type, extra } = args;
  const results = [];
  if (extra?.search) {
    const r = await Promise.allSettled(PROVIDERS.map(p => p.search(extra.search)));
    r.forEach((res, i) => { if (res.status === 'fulfilled') results.push(...res.value.filter(x => x.type === type)); });
  } else {
    const r = await Promise.allSettled(PROVIDERS.map(p => p.getCatalog(type, extra?.genre || null, parseInt(extra?.skip) || 0)));
    r.forEach((res) => { if (res.status === 'fulfilled') results.push(...res.value); });
  }
  return { metas: results.slice(0, 100) };
});

builder.defineMetaHandler(async (args) => {
  const parsed = parseId(args.id);
  if (!parsed) return { meta: null };
  return { meta: { id: args.id, name: parsed.contentId.split('/').pop() || 'Unknown', type: parsed.type } };
});

builder.defineStreamHandler(async (args) => {
  const parsed = parseId(args.id);
  if (!parsed) return { streams: [] };
  const p = PROVIDERS.find(x => x.id === parsed.providerId);
  if (!p) return { streams: [] };
  if (parsed.type === 'movie') return { streams: await p.getMovieStreams(parsed.contentId) };
  return { streams: await p.getSeriesStreams(parsed.contentId, 1, 1) };
});

// ═══════════════════════════════════════════════════════════════
// EXPRESS APP
// ═══════════════════════════════════════════════════════════════
const app = express();
app.use(cors());
app.use(express.json());

// Helper to register routes for both / and /api/ prefixes
function route(path, handler) {
  app.get(path, handler);
  app.get('/api' + path, handler);
}

route('/', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const baseUrl = `${protocol}://${host}`;
  const manifestUrl = `${baseUrl}/manifest.json`;
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Arabic Streams - Stremio Addon</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Tajawal',sans-serif;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);min-height:100vh;color:#fff}
.container{max-width:1200px;margin:0 auto;padding:2rem}.hero{text-align:center;padding:4rem 1rem;position:relative}
.hero::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,rgba(120,119,198,.3),transparent 70%);animation:pulse 4s ease-in-out infinite;z-index:-1}
@keyframes pulse{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(1.1);opacity:.8}}
.logo{width:120px;height:120px;margin-bottom:2rem;filter:drop-shadow(0 0 20px rgba(120,119,198,.5))}
h1{font-size:3.5rem;font-weight:800;margin-bottom:1rem;background:linear-gradient(135deg,#fff,#a8a4e6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.subtitle{font-size:1.3rem;color:#a8a4e6;margin-bottom:2rem;line-height:1.6}.providers{display:flex;flex-wrap:wrap;justify-content:center;gap:1rem;margin:2rem 0}
.provider-badge{background:rgba(255,255,255,.1);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.2);padding:.75rem 1.5rem;border-radius:50px;font-weight:500}
.install-btn{display:inline-flex;align-items:center;gap:.75rem;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;padding:1.25rem 3rem;border-radius:50px;font-size:1.2rem;font-weight:700;margin-top:2rem;box-shadow:0 10px 30px rgba(102,126,234,.4);border:none;cursor:pointer}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:2rem;margin-top:4rem}
.feature-card{background:rgba(255,255,255,.05);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:2rem}
.feature-icon{font-size:2.5rem;margin-bottom:1rem}.feature-title{font-size:1.3rem;font-weight:700;margin-bottom:.5rem}
.feature-desc{color:#a8a4e6;line-height:1.6}.footer{text-align:center;padding:3rem 1rem;color:#a8a4e6;font-size:.9rem}
@media(max-width:768px){h1{font-size:2.5rem}}
</style></head>
<body><div class="container"><div class="hero">
<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Stremio_logo.svg/1200px-Stremio_logo.svg.png" alt="Stremio" class="logo">
<h1>Arabic Streams</h1><p class="subtitle">إضافة Stremio متكاملة لمحتوى عربي من أفضل المصادر<br>أفلام ومسلسلات عربية وأجنبية مترجمة بجودة عالية</p>
<div class="providers"><span class="provider-badge">🎬 FaselHD</span><span class="provider-badge">📺 EgyDead</span></div>
<a href="stremio://${manifestUrl.replace(/^https?:\/\//, '')}" class="install-btn">📥 تثبيت الإضافة في Stremio</a>
</div><div class="features">
<div class="feature-card"><div class="feature-icon">🔍</div><div class="feature-title">بحث متكامل</div><div class="feature-desc">ابحث في FaselHD و EgyDead من مكان واحد</div></div>
<div class="feature-card"><div class="feature-icon">⚡</div><div class="feature-title">سرعة فائقة</div><div class="feature-desc">جلب فوري للمصادر مع دعم الجودات المتعددة</div></div>
<div class="feature-card"><div class="feature-icon">📱</div><div class="feature-title">جميع الأجهزة</div><div class="feature-desc">Android, iOS, Windows, macOS, Linux, Android TV</div></div>
<div class="feature-card"><div class="feature-icon">🛡️</div><div class="feature-title">تخطي الحماية</div><div class="feature-desc">دعم مدمج لتخطي Cloudflare تلقائياً</div></div>
</div><div class="footer"><p>Made with ❤️ for Arabic Stremio community</p></div></div></body></html>`);
});

route('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(manifest);
});

route('/catalog/:type/:id.json', async (req, res) => {
  try {
    const result = await builder.catalogHandler({ type: req.params.type, id: req.params.id, extra: req.query });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

route('/meta/:type/:id.json', async (req, res) => {
  try {
    const result = await builder.metaHandler({ type: req.params.type, id: req.params.id });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

route('/stream/:type/:id.json', async (req, res) => {
  try {
    const result = await builder.streamHandler({ type: req.params.type, id: req.params.id });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

route('/health', (req, res) => {
  res.json({ status: 'ok', providers: PROVIDERS.map(p => p.id) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Arabic Streams addon running on port ${PORT}`);
  console.log(`Providers: ${PROVIDERS.map(p => p.name).join(', ')}`);
});

module.exports = app;
