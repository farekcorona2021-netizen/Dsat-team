# Arabic Streams - Stremio Addon

إضافة Stremio متكاملة لمحتوى عربي من FaselHD و EgyDead.

## المصادر المدعومة
- **FaselHD** (`faselhd`) - أفلام ومسلسلات عربية وأجنبية مترجمة
- **EgyDead** (`egydead`) - محتوى متنوع بجودة عالية

## البنية

```
stremio-arabic-addon/
├── api/
│   └── index.js              # نقطة الدخول الرئيسية + Landing Page
├── lib/
│   ├── utils.js              # أدوات مشتركة (HTTP, Cheerio, Helpers)
│   └── providers/
│       ├── faselhd.js        # مزود FaselHD
│       └── egydead.js        # مزود EgyDead
├── package.json
└── vercel.json
```

## التثبيت المحلي

```bash
npm install
npm start
```

## النشر على Vercel

```bash
npm i -g vercel
vercel --prod
```

## رابط التثبيت المباشر

بعد النشر، افتح الرابط الرئيسي واضغط على زر **"تثبيت الإضافة في Stremio"**، أو استخدم الرابط المباشر:

```
stremio://YOUR_DOMAIN/manifest.json
```

## آلية العمل

### معرفات المحتوى (ID Prefixes)
كل مزود يستخدم prefix خاص به في معرفات Stremio:
- `faselhd:movie:URL` - فيلم من FaselHD
- `faselhd:series:URL` - مسلسل من FaselHD
- `egydead:movie:URL` - فيلم من EgyDead
- `egydead:series:URL` - مسلسل من EgyDead

### استخراج الروابط
1. **HTML Parsing**: يتم جلب صفحة الفيلم/الحلقة وتحليلها بـ Cheerio
2. **Script Extraction**: البحث عن روابط MP4/M3U8 المباشرة داخل `<script>` tags
3. **Iframe Resolution**: محاولة فتح iframes واستخراج الروابط منها
4. **Quality Detection**: استخراج الجودة تلقائياً من اسم الملف (1080p, 720p, 480p)
5. **Subtitles**: استخراج ملفات الترجمة العربية عند توفرها

### تخطي الحماية
- **User-Agent**: Android Chrome Mobile (يقلل فرص الحظر)
- **Headers كاملة**: `sec-ch-ua`, `Accept-Language: ar-EG`, إلخ
- **Retry Logic**: محاولة إعادة الجلب عند 429/403 مع تأخير exponential

## المسارات (Endpoints)

| المسار | الوظيفة |
|--------|---------|
| `GET /` | Landing Page مع زر التثبيت |
| `GET /manifest.json` | ملف Manifest الخاص بـ Stremio |
| `GET /catalog/:type/:id.json` | قائمة الأفلام/المسلسلات |
| `GET /meta/:type/:id.json` | بيانات Metadata |
| `GET /stream/:type/:id.json` | روابط التشغيل |
| `GET /health` | فحص صحة الإضافة |

## ملاحظات هامة

1. **FaselHD**: يعتمد على selectors مثل `.postDiv` للبحث ويستخرج الروابط من `video source` و `script` tags.
2. **EgyDead**: يستخدم بنية `.Grid--MycimaPosts` ويدعم روابط التحميل المباشرة.
3. **الجودات**: يتم استخراجها تلقائياً من اسم الملف أو الرابط.
4. **الترجمة**: يتم استخراج ملفات الترجمة العربية تلقائياً عند توفرها.

## الترخيص

MIT License - للاستخدام الشخصي فقط.
