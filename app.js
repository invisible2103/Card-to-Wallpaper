// Lockscreen Magic — ứng dụng Express (chạy được cả local lẫn Vercel serverless)
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const UA = 'LockscreenMagic/1.0 (magic tool)';
const IS_VERCEL = !!process.env.VERCEL;
const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: ['text/*'], limit: '100kb' }));

// ---------- Lưu trữ: Upstash Redis (khi deploy) hoặc file JSON (khi chạy local) ----------
async function redis(cmd) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

let localDb = {};
if (!REST_URL) { try { localDb = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) {} }

const validToken = t => /^[a-f0-9]{24}$/.test(t || '');

async function loadProfile(token) {
  if (!validToken(token)) return null;
  if (REST_URL) {
    const v = await redis(['GET', 'lsm:' + token]);
    return v ? JSON.parse(v) : null;
  }
  if (IS_VERCEL) throw new Error('Chưa cấu hình Redis (xem README, bước 3).');
  return localDb[token] || null;
}

async function saveProfile(token, p) {
  if (REST_URL) { await redis(['SET', 'lsm:' + token, JSON.stringify(p)]); return; }
  if (IS_VERCEL) throw new Error('Chưa cấu hình Redis (xem README, bước 3).');
  localDb[token] = p;
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(localDb)); } catch (_) {}
}

// ---------- Tìm ảnh ----------
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function wikipediaImage(term, lang) {
  const l = /^[a-z-]{2,10}$/.test(lang) ? lang : 'en';
  const url = `https://${l}.wikipedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(term)}&gsrlimit=6&prop=pageimages&piprop=original|thumbnail&pithumbsize=1600` +
    `&format=json&formatversion=2`;
  const j = await getJson(url);
  const pages = (j.query && j.query.pages) || [];
  pages.sort((a, b) => a.index - b.index);
  for (const p of pages) {
    const img = (p.thumbnail && p.thumbnail.source) || (p.original && p.original.source);
    if (img) return { url: img, title: p.title };
  }
  return null;
}

async function commonsImage(term) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6` +
    `&gsrsearch=${encodeURIComponent(term)}&gsrlimit=6&prop=imageinfo&iiprop=url&iiurlwidth=1600&format=json&formatversion=2`;
  const j = await getJson(url);
  const pages = (j.query && j.query.pages) || [];
  pages.sort((a, b) => a.index - b.index);
  for (const p of pages) {
    const ii = p.imageinfo && p.imageinfo[0];
    if (ii && /\.(jpe?g|png|webp)$/i.test(ii.url)) return { url: ii.thumburl || ii.url, title: p.title };
  }
  return null;
}

async function findImage(term, profile) {
  const lang = profile.lang || 'en';
  const map = profile.overrides || {};
  const key = term.trim().toLowerCase();
  if (map[key]) return { url: map[key], title: term };
  let r = null;
  try { r = await wikipediaImage(term, lang); } catch (e) { console.error('wiki', e.message); }
  if (!r && lang !== 'en') { try { r = await wikipediaImage(term, 'en'); } catch (_) {} }
  if (!r) { try { r = await commonsImage(term); } catch (e) { console.error('commons', e.message); } }
  return r;
}

// ---------- Rút từ khoá từ request của app ảo thuật ----------
const AUTO_KEYS = ['q', 'query', 'search', 'term', 'word', 'text', 'name', 'keyword', 'value', 'result', 'answer', 'message', 'title'];

function dig(obj, pathStr) {
  return pathStr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function extractTerm(req, field) {
  const src = Object.assign({}, req.query || {});
  if (req.body && typeof req.body === 'object') Object.assign(src, req.body);
  if (field) {
    const v = dig(src, field);
    if (v != null && typeof v !== 'object' && String(v).trim()) return String(v).trim();
  }
  if (req.params && req.params.term) {
    try { return decodeURIComponent(req.params.term).trim(); } catch (_) { return req.params.term.trim(); }
  }
  for (const k of AUTO_KEYS) {
    if (src[k] != null && typeof src[k] !== 'object' && String(src[k]).trim()) return String(src[k]).trim();
  }
  if (typeof req.body === 'string' && req.body.trim()) return req.body.trim();
  for (const v of Object.values(src)) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  if (!res.headersSent) res.status(500).json({ error: e.message });
});

// ---------- API ----------
app.post('/api/profile', wrap(async (req, res) => {
  const token = crypto.randomBytes(12).toString('hex');
  await saveProfile(token, {
    created: Date.now(), lang: 'en', field: '', overrides: {},
    term: '', title: '', imageUrl: '', updatedAt: 0, history: []
  });
  res.json({ token });
}));

app.get('/api/profile/:token', wrap(async (req, res) => {
  const p = await loadProfile(req.params.token);
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json({
    lang: p.lang, field: p.field, overrides: p.overrides,
    term: p.term, title: p.title, imageUrl: p.imageUrl, updatedAt: p.updatedAt,
    history: p.history.slice(0, 10)
  });
}));

app.put('/api/profile/:token', wrap(async (req, res) => {
  const p = await loadProfile(req.params.token);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  if (typeof b.lang === 'string' && /^[a-z-]{2,10}$/.test(b.lang)) p.lang = b.lang;
  if (typeof b.field === 'string') p.field = b.field.slice(0, 60);
  if (b.overrides && typeof b.overrides === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(b.overrides)) {
      if (typeof v === 'string' && /^https?:\/\//.test(v)) o[String(k).toLowerCase().slice(0, 80)] = v;
    }
    p.overrides = o;
  }
  await saveProfile(req.params.token, p);
  res.json({ ok: true });
}));

// Webhook: app ảo thuật gọi vào đây (GET hoặc POST)
const hook = wrap(async (req, res) => {
  const p = await loadProfile(req.params.token);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const term = extractTerm(req, p.field);
  if (!term) return res.status(400).json({ error: 'no_term', hint: 'Không tìm thấy từ khoá trong request' });
  const img = await findImage(term, p);
  p.term = term;
  p.updatedAt = Date.now();
  p.imageUrl = img ? img.url : '';
  p.title = img ? img.title : '';
  p.history.unshift({ term, title: p.title, at: p.updatedAt, found: !!img });
  p.history = p.history.slice(0, 30);
  await saveProfile(req.params.token, p);
  res.json({ ok: true, term, found: !!img, title: p.title });
});
app.all('/api/h/:token', hook);
app.all('/api/h/:token/:term', hook);

app.post('/api/reset/:token', wrap(async (req, res) => {
  const p = await loadProfile(req.params.token);
  if (!p) return res.status(404).json({ error: 'not_found' });
  p.term = ''; p.title = ''; p.imageUrl = ''; p.updatedAt = Date.now();
  await saveProfile(req.params.token, p);
  res.json({ ok: true });
}));

// Ảnh hình nền đã cắt đúng tỉ lệ iPhone — Phím tắt tải ảnh này
// /api/w/<token>.jpg?w=1290&h=2796
const blackImage = (w, h) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#000' } }).jpeg({ quality: 85 }).toBuffer();

app.get('/api/w/:file', wrap(async (req, res) => {
  const token = req.params.file.replace(/\.(jpe?g|png)$/i, '');
  const p = await loadProfile(token);
  if (!p) return res.status(404).send('not found');
  const w = Math.min(Math.max(parseInt(req.query.w) || 1290, 200), 3000);
  const h = Math.min(Math.max(parseInt(req.query.h) || 2796, 400), 4000);
  res.set({ 'Cache-Control': 'no-store, max-age=0', 'Content-Type': 'image/jpeg' });
  try {
    if (!p.imageUrl) return res.send(await blackImage(w, h));
    const r = await fetch(p.imageUrl, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('image HTTP ' + r.status);
    const input = Buffer.from(await r.arrayBuffer());
    const meta = await sharp(input).metadata();
    const ratio = (meta.width || 1) / (meta.height || 1);
    const target = w / h;
    let out;
    if (ratio > target * 1.6) {
      // Ảnh quá ngang: nền mờ + ảnh chính ở giữa
      const bg = await sharp(input).resize(w, h, { fit: 'cover' }).blur(40).modulate({ brightness: 0.6 }).toBuffer();
      const fg = await sharp(input).resize(w, null, { fit: 'inside' }).toBuffer();
      out = await sharp(bg).composite([{ input: fg, gravity: 'center' }]).jpeg({ quality: 85 }).toBuffer();
    } else {
      out = await sharp(input).rotate().resize(w, h, { fit: 'cover', position: 'attention' }).jpeg({ quality: 85 }).toBuffer();
    }
    res.send(out);
  } catch (e) {
    console.error('wallpaper', e.message);
    res.send(await blackImage(w, h));
  }
}));

app.get('/api/health', (_, res) => res.json({ ok: true, storage: REST_URL ? 'redis' : (IS_VERCEL ? 'missing' : 'file') }));

// Khi chạy local, Express phục vụ luôn giao diện. Trên Vercel thì thư mục public/ tự được phục vụ.
app.use(express.static(path.join(__dirname, 'public')));

module.exports = app;
