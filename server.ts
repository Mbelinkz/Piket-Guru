/**
 * Server lokal Piket Gerbang (http://localhost:3333) - mode mandiri.
 * - Melayani aplikasi hasil build (dist/) + API /api/piket (inti kode yang sama dengan Netlify Function).
 * - Penyimpanan: berkas di data/kv. Arsip foto per hari ke disk E: (tidak pernah menimpa/menghapus foto lama).
 * - Opsional meneruskan foto ke SIMS Mandiri (localhost:3000) agar tersimpan di basis data utama.
 *   Notifikasi WhatsApp HANYA dikirim aplikasi ini (SIMS di 3000 hanya menerima & menyimpan).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler, createLimiter, type ApiEnv, type Hooks, type Kv } from './shared/api-core.ts';
import { folderPathFor } from './shared/piket.ts';
import { createSupabaseKv } from './shared/supabase.ts';
import type { PhotoMeta } from './shared/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---- .env sederhana (tanpa dependensi) ---- */
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  /* abaikan */
}

const PORT = Number(process.env.PORT || 3333);
const DIST_DIR = path.join(__dirname, 'dist');
const DATA_DIR = path.join(__dirname, 'data');
const KV_DIR = path.join(DATA_DIR, 'kv');
const SEED_DIR = path.join(__dirname, 'src', 'data');
const SIMS_URL = (process.env.SIMS_URL || 'http://localhost:3000').replace(/\/$/, '');
const SIMS_FORWARD = (process.env.SIMS_FORWARD ?? 'true') !== 'false';
const ARCHIVE_DIR =
  process.env.PIKET_ARCHIVE_DIR ||
  (fs.existsSync('E:\\') ? 'E:\\RESTU DIGITAL\\DATABASE_PIKET_GERBANG\\Foto_Piket' : path.join(DATA_DIR, 'arsip'));

/* ---- KV berbasis berkas ---- */
fs.mkdirSync(KV_DIR, { recursive: true });
const fileOf = (key: string) => path.join(KV_DIR, `${encodeURIComponent(key)}.json`);

function atomicWrite(file: string, content: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, file);
}

const kv: Kv = {
  async get<T>(key: string) {
    try {
      return JSON.parse(fs.readFileSync(fileOf(key), 'utf-8')) as T;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    atomicWrite(fileOf(key), JSON.stringify(value));
  },
  async delete(key) {
    try {
      fs.unlinkSync(fileOf(key));
    } catch {
      /* sudah tidak ada */
    }
  },
  async list(prefix) {
    return fs
      .readdirSync(KV_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => decodeURIComponent(f.slice(0, -5)))
      .filter((k) => k.startsWith(prefix));
  },
};

const readSeed = (n: string) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(SEED_DIR, n), 'utf-8'));
  } catch {
    return null;
  }
};

/* ---- data awal (jadwal & guru SD Negeri 1 Rejoso) ---- */
async function seedIfEmpty() {
  if (!(await kv.get('staff'))) {
    const s = readSeed('initialStaff.json');
    if (s) await kv.set('staff', s);
  }
  if (!(await kv.get('schedule'))) {
    const s = readSeed('initialSchedule.json');
    if (s) await kv.set('schedule', s);
  }
  if (!(await kv.get('config'))) {
    const s = readSeed('initialConfig.json');
    if (s) await kv.set('config', s);
  }
}

/* ---- arsip lokal: folder per hari, nama unik, tidak menimpa ---- */
function uniquePath(dir: string, fileName: string): string {
  let p = path.join(dir, fileName);
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(fileName);
  const base = fileName.slice(0, -ext.length);
  for (let i = 2; i < 1000; i++) {
    p = path.join(dir, `${base}_${i}${ext}`);
    if (!fs.existsSync(p)) return p;
  }
  return path.join(dir, `${base}_${Date.now()}${ext}`);
}

async function forwardToSims(meta: PhotoMeta, image: string, savedPath: string) {
  if (!SIMS_FORWARD) return;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    await fetch(`${SIMS_URL}/api/picket-photo-upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({
        photo: {
          id: meta.id,
          tanggal: meta.tanggal,
          waktuPagiOtomatis: meta.waktu,
          lokasi: meta.lokasi,
          staffId: meta.staffId,
          staffNama: meta.staffNama,
          fotoUrl: image,
          keterangan: meta.keterangan,
          statusKondisi: meta.kondisi,
          uploadedAt: meta.uploadedAt,
          savedFileName: meta.fileName,
          savedFilePathE: savedPath,
        },
        // SIMS (3000) hanya menerima & menyimpan; WhatsApp dikirim oleh aplikasi piket ini.
        sourcePortal: 'piket_standalone',
        allowWaNotification: false,
      }),
    }).finally(() => clearTimeout(t));
  } catch {
    /* SIMS tidak aktif: tidak masalah, foto tetap tersimpan di aplikasi ini */
  }
}

const hooks: Hooks = {
  async onPhotoSaved(meta, image) {
    const m = image.match(/^data:image\/[a-z]+;base64,(.+)$/);
    if (!m) return;
    const dir = path.join(ARCHIVE_DIR, ...folderPathFor(meta.tanggal));
    fs.mkdirSync(dir, { recursive: true });
    const target = uniquePath(dir, meta.fileName);
    fs.writeFileSync(target, Buffer.from(m[1], 'base64'));
    void forwardToSims(meta, image, target);
    return { localPath: target };
  },
};

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const effectiveKv: Kv = SUPABASE_URL && SUPABASE_KEY
  ? createSupabaseKv({ url: SUPABASE_URL, key: SUPABASE_KEY, fallbackKv: kv })
  : kv;

if (SUPABASE_URL && SUPABASE_KEY) {
  console.log('[server] Database Supabase aktif:', SUPABASE_URL);
}

const env: ApiEnv = {
  accessCode: process.env.ACCESS_CODE || 'sdn1rejoso',
  adminPin: process.env.ADMIN_PIN || '123456',
  usingDefaults: !process.env.ACCESS_CODE || !process.env.ADMIN_PIN,
  fonnteToken: process.env.FONNTE_TOKEN,
  driveScriptUrl: process.env.GDRIVE_SCRIPT_URL,
  driveSecret: process.env.GDRIVE_SECRET,
  supabaseUrl: SUPABASE_URL,
  supabaseKey: SUPABASE_KEY,
};

const handler = createApiHandler({
  kv: effectiveKv,
  env,
  limiter: createLimiter(30),
  hooks,
  defaults: {
    config: readSeed('initialConfig.json'),
    staff: readSeed('initialStaff.json'),
    schedule: readSeed('initialSchedule.json'),
  },
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 6 * 1024 * 1024) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/piket' || url.pathname === '/.netlify/functions/piket') {
    try {
      const method = (req.method || 'GET').toUpperCase();
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(req);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
      }
      headers.set('x-forwarded-for', req.socket.remoteAddress || 'local');
      const webRes = await handler(
        new Request(url.toString(), { method, headers, body: body && body.length ? new Uint8Array(body) : undefined })
      );
      res.statusCode = webRes.status;
      webRes.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await webRes.arrayBuffer()));
    } catch (err) {
      res.statusCode = (err as Error).message === 'too large' ? 413 : 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: res.statusCode === 413 ? 'Data terlalu besar.' : 'Kesalahan server.' }));
    }
    return;
  }

  // Berkas statis + fallback SPA
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  let filePath = path.normalize(path.join(DIST_DIR, rel));
  if (!filePath.startsWith(DIST_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Aplikasi belum di-build. Jalankan: npm run build');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('content-type', MIME[ext] || 'application/octet-stream');
  res.setHeader('cache-control', ext === '.html' ? 'no-cache' : 'public, max-age=86400');
  res.setHeader('permissions-policy', 'camera=(self)');
  fs.createReadStream(filePath).pipe(res);
});

await seedIfEmpty();
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[Piket Gerbang] Port ${PORT} sudah digunakan (aplikasi mungkin sudah berjalan).`);
    process.exit(0);
  }
  throw err;
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================================');
  console.log('  APLIKASI PIKET GERBANG GURU (MANDIRI & SIAP DEPLOY NETLIFY)');
  console.log(`  Alamat      : http://localhost:${PORT}`);
  console.log(`  Arsip foto  : ${ARCHIVE_DIR}`);
  console.log(`  Teruskan ke SIMS (${SIMS_URL}): ${SIMS_FORWARD ? 'aktif (jika SIMS menyala)' : 'nonaktif'}`);
  console.log('====================================================================');
});

