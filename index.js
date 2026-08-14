const express = require('express');
const { addonBuilder } = require('stremio-addon-sdk');
const cors = require('cors');

const faselhd = require('./lib/providers/faselhd');
const egydead = require('./lib/providers/egydead');

const PROVIDERS = [faselhd, egydead];

const app = express();
app.use(cors());
app.use(express.json());

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
    {
      type: 'movie',
      id: 'arabic_movies',
      name: 'Arabic Movies',
      genres: ['Action', 'Comedy', 'Drama', 'Horror', 'Romance', 'Thriller'],
      extra: [{ name: 'search' }, { name: 'skip' }],
    },
    {
      type: 'series',
      id: 'arabic_series',
      name: 'Arabic Series',
      genres: ['Action', 'Comedy', 'Drama', 'Horror', 'Romance', 'Thriller'],
      extra: [{ name: 'search' }, { name: 'skip' }],
    },
  ],
  idPrefixes: PROVIDERS.map(p => p.id),
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
  },
};

const builder = new addonBuilder(manifest);

function parseId(id) {
  const parts = id.split(':');
  if (parts.length < 3) return null;
  return {
    providerId: parts[0],
    type: parts[1],
    contentId: parts.slice(2).join(':'),
  };
}

builder.defineCatalogHandler(async (args) => {
  const { type, id, extra } = args;
  const results = [];

  if (extra?.search) {
    const searchPromises = PROVIDERS.map(p => p.search(extra.search));
    const searchResults = await Promise.allSettled(searchPromises);
    for (let i = 0; i < PROVIDERS.length; i++) {
      if (searchResults[i].status === 'fulfilled') {
        results.push(...searchResults[i].value.filter(r => r.type === type));
      }
    }
  } else {
    const genre = extra?.genre || null;
    const skip = parseInt(extra?.skip) || 0;
    const catalogPromises = PROVIDERS.map(p => p.getCatalog(type, genre, skip));
    const catalogResults = await Promise.allSettled(catalogPromises);
    for (let i = 0; i < PROVIDERS.length; i++) {
      if (catalogResults[i].status === 'fulfilled') {
        results.push(...catalogResults[i].value);
      }
    }
  }
  return { metas: results.slice(0, 100) };
});

builder.defineMetaHandler(async (args) => {
  const { id } = args;
  const parsed = parseId(id);
  if (!parsed) return { meta: null };
  const provider = PROVIDERS.find(p => p.id === parsed.providerId);
  if (!provider) return { meta: null };
  return {
    meta: {
      id,
      name: parsed.contentId.split('/').pop() || 'Unknown',
      type: parsed.type,
    },
  };
});

builder.defineStreamHandler(async (args) => {
  const { id } = args;
  const parsed = parseId(id);
  if (!parsed) return { streams: [] };
  const provider = PROVIDERS.find(p => p.id === parsed.providerId);
  if (!provider) return { streams: [] };
  let streams = [];
  if (parsed.type === 'movie') {
    streams = await provider.getMovieStreams(parsed.contentId);
  } else if (parsed.type === 'series') {
    streams = await provider.getSeriesStreams(parsed.contentId, 1, 1);
  }
  return { streams };
});

app.get('/', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const baseUrl = `${protocol}://${host}`;

  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arabic Streams - Stremio Addon</title>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Tajawal', sans-serif;
      background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
      min-height: 100vh;
      color: #fff;
      overflow-x: hidden;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .hero { text-align: center; padding: 4rem 1rem; position: relative; }
    .hero::before {
      content: '';
      position: absolute;
      top: -50%; left: -50%;
      width: 200%; height: 200%;
      background: radial-gradient(circle, rgba(120,119,198,0.3) 0%, transparent 70%);
      animation: pulse 4s ease-in-out infinite;
      z-index: -1;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.5; }
      50% { transform: scale(1.1); opacity: 0.8; }
    }
    .logo { width: 120px; height: 120px; margin-bottom: 2rem; filter: drop-shadow(0 0 20px rgba(120,119,198,0.5)); }
    h1 {
      font-size: 3.5rem; font-weight: 800; margin-bottom: 1rem;
      background: linear-gradient(135deg, #fff 0%, #a8a4e6 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .subtitle { font-size: 1.3rem; color: #a8a4e6; margin-bottom: 2rem; line-height: 1.6; }
    .providers { display: flex; flex-wrap: wrap; justify-content: center; gap: 1rem; margin: 2rem 0; }
    .provider-badge {
      background: rgba(255,255,255,0.1); backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.2); padding: 0.75rem 1.5rem;
      border-radius: 50px; font-weight: 500; transition: all 0.3s ease;
    }
    .provider-badge:hover { background: rgba(255,255,255,0.2); transform: translateY(-2px); }
    .install-btn {
      display: inline-flex; align-items: center; gap: 0.75rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white; text-decoration: none; padding: 1.25rem 3rem;
      border-radius: 50px; font-size: 1.2rem; font-weight: 700;
      margin-top: 2rem; transition: all 0.3s ease;
      box-shadow: 0 10px 30px rgba(102,126,234,0.4); border: none; cursor: pointer;
    }
    .install-btn:hover { transform: translateY(-3px); box-shadow: 0 15px 40px rgba(102,126,234,0.6); }
    .install-btn svg { width: 24px; height: 24px; }
    .features {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 2rem; margin-top: 4rem;
    }
    .feature-card {
      background: rgba(255,255,255,0.05); backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.1); border-radius: 20px;
      padding: 2rem; transition: all 0.3s ease;
    }
    .feature-card:hover { background: rgba(255,255,255,0.1); transform: translateY(-5px); }
    .feature-icon { font-size: 2.5rem; margin-bottom: 1rem; }
    .feature-title { font-size: 1.3rem; font-weight: 700; margin-bottom: 0.5rem; }
    .feature-desc { color: #a8a4e6; line-height: 1.6; }
    .footer { text-align: center; padding: 3rem 1rem; color: #a8a4e6; font-size: 0.9rem; }
    @media (max-width: 768px) {
      h1 { font-size: 2.5rem; }
      .subtitle { font-size: 1.1rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Stremio_logo.svg/1200px-Stremio_logo.svg.png" alt="Stremio" class="logo">
      <h1>Arabic Streams</h1>
      <p class="subtitle">
        إضافة Stremio متكاملة لمحتوى عربي من أفضل المصادر<br>
        أفلام ومسلسلات عربية وأجنبية مترجمة بجودة عالية
      </p>
      <div class="providers">
        <span class="provider-badge">🎬 FaselHD</span>
        <span class="provider-badge">📺 EgyDead</span>
      </div>
      <a href="stremio://${baseUrl.replace(/^https?:\/\//, '')}/manifest.json" class="install-btn">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
        </svg>
        تثبيت الإضافة في Stremio
      </a>
    </div>
    <div class="features">
      <div class="feature-card">
        <div class="feature-icon">🔍</div>
        <div class="feature-title">بحث متكامل</div>
        <div class="feature-desc">ابحث في FaselHD و EgyDead من مكان واحد مع دعم كامل للغة العربية</div>
      </div>
      <div class="feature-card">
        <div class="feature-icon">⚡</div>
        <div class="feature-title">سرعة فائقة</div>
        <div class="feature-desc">جلب فوري للمصادر مع دعم الجودات المتعددة 1080p, 720p, 480p</div>
      </div>
      <div class="feature-card">
        <div class="feature-icon">📱</div>
        <div class="feature-title">يعمل على جميع الأجهزة</div>
        <div class="feature-desc">متوافق مع Android, iOS, Windows, macOS, Linux, و Android TV</div>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🛡️</div>
        <div class="feature-title">تخطي الحماية</div>
        <div class="feature-desc">دعم مدمج لتخطي Cloudflare واستخراج الروابط المباشرة تلقائياً</div>
      </div>
    </div>
    <div class="footer">
      <p>Made with ❤️ for Arabic Stremio community</p>
      <p style="margin-top: 0.5rem; opacity: 0.7;">Base URL: ${baseUrl}</p>
    </div>
  </div>
</body>
</html>
  `);
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(manifest);
});

app.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    const result = await builder.catalogHandler({
      type: req.params.type,
      id: req.params.id,
      extra: req.query,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const result = await builder.metaHandler({
      type: req.params.type,
      id: req.params.id,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const result = await builder.streamHandler({
      type: req.params.type,
      id: req.params.id,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', providers: PROVIDERS.map(p => p.id) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Arabic Streams addon running on port ${PORT}`);
  console.log(`Providers loaded: ${PROVIDERS.map(p => p.name).join(', ')}`);
});

module.exports = app;
