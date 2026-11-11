/**
 * Inti API piket gerbang (framework-agnostik). Dipakai oleh Netlify Function, server lokal, dan test.
 *
 * Keamanan:
 *  - ACCESS_CODE : kode akses guru piket (wajib untuk semua operasi data)
 *  - ADMIN_PIN   : PIN admin (ubah jadwal/pengaturan/rahasia, hapus foto, uji integrasi)
 *  Rahasia integrasi (token Fonnte, URL & kunci Apps Script) hanya disimpan di server dan tidak pernah
 *  dikembalikan ke browser.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  Assignment,
  Config,
  DispatchResult,
  PhotoMeta,
  Secrets,
  SecretsStatus,
  Staff,
} from './types.ts';
import { DEFAULT_CONFIG } from './types.ts';
import {
  LIMITS,
  buildFileName,
  isValidDateISO,
  isValidMonth,
  sanitizeConfig,
  sanitizePhotoUpload,
  sanitizeSchedule,
  sanitizeStaffList,
} from './piket.ts';
import {
  listWaGroups,
  sendWhatsApp,
  testDrive,
  uploadPhotoToDrive,
  uploadRecapToDrive,
  type FetchLike,
} from './integrations.ts';
import {
  getSupabaseSchemaSql,
  isValidSupabaseUrl,
  mirrorToStructuredTables,
  supabaseKvSet,
  syncAllToSupabase,
  testSupabase,
} from './supabase.ts';

export interface Kv {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export interface ApiEnv {
  accessCode?: string;
  adminPin?: string;
  /** true bila kode/PIN memakai nilai bawaan (peringatkan admin agar menggantinya) */
  usingDefaults?: boolean;
  fonnteToken?: string;
  driveScriptUrl?: string;
  driveSecret?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}

export interface Hooks {
  /** Dipanggil setelah foto tersimpan (mode lokal: arsip ke disk E: & teruskan ke SIMS). */
  onPhotoSaved?: (meta: PhotoMeta, imageDataUrl: string) => Promise<{ localPath?: string } | void>;
}

export const MIN_SECRET_LENGTH = 6;

export interface Limiter {
  blocked(ip: string): boolean;
  fail(ip: string): void;
}

export function createLimiter(maxFails = 8, windowMs = 10 * 60 * 1000, now: () => number = Date.now): Limiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    blocked(ip) {
      const h = hits.get(ip);
      if (!h) return false;
      if (h.resetAt <= now()) {
        hits.delete(ip);
        return false;
      }
      return h.count >= maxFails;
    },
    fail(ip) {
      const t = now();
      const h = hits.get(ip);
      if (!h || h.resetAt <= t) hits.set(ip, { count: 1, resetAt: t + windowMs });
      else h.count += 1;
    },
  };
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
const fail = (status: number, error: string, code?: string) => json({ ok: false, error, code }, status);

const metaKey = (date: string, id: string) => `meta/${date}/${id}`;
const imgKey = (id: string) => `img/${id}`;

async function readBatches<T>(kv: Kv, keys: string[], size = 30): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += size) {
    const part = await Promise.all(keys.slice(i, i + size).map((k) => kv.get<T>(k)));
    for (const p of part) if (p) out.push(p);
  }
  return out;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!m) return null;
  return { bytes: new Uint8Array(Buffer.from(m[2], 'base64')), mime: m[1] };
}

export function createApiHandler(opts: {
  kv: Kv;
  env: ApiEnv;
  limiter?: Limiter;
  now?: () => Date;
  fetchImpl?: FetchLike;
  hooks?: Hooks;
  defaults?: {
    config?: Partial<Config>;
    staff?: Staff[];
    schedule?: Assignment[];
  };
}): (req: Request) => Promise<Response> {
  const { kv, env, defaults } = opts;
  const limiter = opts.limiter ?? createLimiter();
  const nowFn = opts.now ?? (() => new Date());
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const accessConfigured = !!env.accessCode && env.accessCode.length >= MIN_SECRET_LENGTH;
  const adminConfigured = !!env.adminPin && env.adminPin.length >= MIN_SECRET_LENGTH;

  const loadConfig = async (): Promise<Config> => {
    const stored = (await kv.get<Config>('config')) ?? ({} as Partial<Config>);
    return {
      ...DEFAULT_CONFIG,
      ...(defaults?.config ?? {}),
      ...stored,
      logoSekolahUrl: stored.logoSekolahUrl || defaults?.config?.logoSekolahUrl || DEFAULT_CONFIG.logoSekolahUrl,
      logoVisiUrl: stored.logoVisiUrl || defaults?.config?.logoVisiUrl || DEFAULT_CONFIG.logoVisiUrl,
    };
  };

  const effectiveSecrets = async (): Promise<Secrets & { fromEnv: { fonnte: boolean; drive: boolean; supabase: boolean } }> => {
    const stored = (await kv.get<Partial<Secrets>>('secrets')) ?? {};
    const fonnteToken = stored.fonnteToken || env.fonnteToken || '';
    const driveScriptUrl = stored.driveScriptUrl || env.driveScriptUrl || '';
    const driveSecret = stored.driveSecret || env.driveSecret || '';
    const supabaseUrl = stored.supabaseUrl || env.supabaseUrl || '';
    const supabaseKey = stored.supabaseKey || env.supabaseKey || '';
    return {
      fonnteToken,
      driveScriptUrl,
      driveSecret,
      supabaseUrl,
      supabaseKey,
      fromEnv: {
        fonnte: !stored.fonnteToken && !!env.fonnteToken,
        drive: !(stored.driveScriptUrl && stored.driveSecret) && !!(env.driveScriptUrl && env.driveSecret),
        supabase: !(stored.supabaseUrl && stored.supabaseKey) && !!(env.supabaseUrl && env.supabaseKey),
      },
    };
  };

  const secretsStatus = async (): Promise<SecretsStatus> => {
    const s = await effectiveSecrets();
    return {
      hasFonnteToken: !!s.fonnteToken,
      hasDriveScript: !!s.driveScriptUrl,
      hasDriveSecret: !!s.driveSecret,
      hasSupabase: !!(s.supabaseUrl && s.supabaseKey),
      fonnteFromEnv: s.fromEnv.fonnte,
      driveFromEnv: s.fromEnv.drive,
      supabaseFromEnv: s.fromEnv.supabase,
    };
  };

  const findMeta = async (date: string, id: string) => kv.get<PhotoMeta>(metaKey(date, id));

  const mirrorSupabase = async (k: string, val: unknown) => {
    try {
      const [cfg, sec] = await Promise.all([loadConfig(), effectiveSecrets()]);
      if (cfg.supabaseEnabled && sec.supabaseUrl && sec.supabaseKey) {
        await supabaseKvSet(fetchImpl, sec.supabaseUrl, sec.supabaseKey, k, val);
        await mirrorToStructuredTables(fetchImpl, sec.supabaseUrl, sec.supabaseKey, k, val);
      }
    } catch (err) {
      console.warn('[supabase-sync] mirror failed:', err);
    }
  };

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const op = url.searchParams.get('op') || '';
    const method = req.method.toUpperCase();
    const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown';
    const providedCode = req.headers.get('x-access-code') || '';
    const providedPin = req.headers.get('x-admin-pin') || '';

    try {
      if (limiter.blocked(ip)) return fail(429, 'Terlalu banyak percobaan salah. Coba lagi beberapa menit lagi.', 'rate_limited');

      const accessOk = () => accessConfigured && safeEqual(providedCode, env.accessCode as string);
      const adminOk = () => adminConfigured && providedPin !== '' && safeEqual(providedPin, env.adminPin as string);

      if (op === 'ping' && method === 'GET') {
        let authorized = false;
        if (providedCode) {
          authorized = accessOk();
          if (!authorized) limiter.fail(ip);
        }
        return json({
          ok: true,
          app: 'piket-gerbang',
          configured: accessConfigured,
          authorized,
          defaultCredentials: authorized ? !!env.usingDefaults : undefined,
          time: nowFn().toISOString(),
        });
      }

      if (!accessConfigured) {
        return fail(503, `Server belum dikonfigurasi. Atur ACCESS_CODE (min. ${MIN_SECRET_LENGTH} karakter).`, 'not_configured');
      }
      if (!accessOk()) {
        limiter.fail(ip);
        return fail(401, 'Kode akses salah atau belum diisi.', 'unauthorized');
      }

      const requireAdmin = (): Response | null => {
        if (!adminConfigured) return fail(503, `ADMIN_PIN belum dikonfigurasi (min. ${MIN_SECRET_LENGTH} karakter).`, 'admin_not_configured');
        if (!adminOk()) {
          if (providedPin) limiter.fail(ip);
          return fail(403, 'Perlu PIN admin untuk tindakan ini.', 'admin_required');
        }
        return null;
      };

      const readBody = async (maxBytes: number): Promise<unknown | undefined> => {
        const len = Number(req.headers.get('content-length') || '0');
        if (len > maxBytes) return undefined;
        const text = await req.text();
        if (text.length > maxBytes * 1.4) return undefined;
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      };

      /* ---------- auth admin ---------- */
      if (op === 'auth' && method === 'POST') {
        const denied = requireAdmin();
        return denied ?? json({ ok: true });
      }

      /* ---------- bootstrap: semua data ringan dalam satu permintaan ---------- */
      if (op === 'bootstrap' && method === 'GET') {
        const [config, staff, schedule, st] = await Promise.all([
          loadConfig(),
          kv.get<Staff[]>('staff'),
          kv.get<Assignment[]>('schedule'),
          secretsStatus(),
        ]);
        return json({
          ok: true,
          config,
          staff: staff ?? defaults?.staff ?? [],
          schedule: schedule ?? defaults?.schedule ?? [],
          secrets: st,
          defaultCredentials: !!env.usingDefaults,
        });
      }

      if (op === 'config' && method === 'PUT') {
        const denied = requireAdmin();
        if (denied) return denied;
        const body = await readBody(64 * 1024);
        if (!body) return fail(400, 'Format data tidak valid.', 'invalid');
        const config = sanitizeConfig(body);
        await kv.set('config', config);
        await mirrorSupabase('config', config);
        return json({ ok: true, config });
      }

      if (op === 'staff' && method === 'PUT') {
        const denied = requireAdmin();
        if (denied) return denied;
        const body = (await readBody(512 * 1024)) as { staff?: unknown } | null | undefined;
        const clean = sanitizeStaffList(body?.staff);
        if (!clean) return fail(400, `Format data guru tidak valid (maks ${LIMITS.maxStaff}).`, 'invalid');
        await kv.set('staff', clean);
        await mirrorSupabase('staff', clean);
        return json({ ok: true, staff: clean });
      }

      if (op === 'schedule' && method === 'PUT') {
        const denied = requireAdmin();
        if (denied) return denied;
        const body = (await readBody(2 * 1024 * 1024)) as { schedule?: unknown } | null | undefined;
        const clean = sanitizeSchedule(body?.schedule);
        if (!clean) return fail(400, `Format jadwal tidak valid (maks ${LIMITS.maxAssignments} hari).`, 'invalid');
        await kv.set('schedule', clean);
        await mirrorSupabase('schedule', clean);
        return json({ ok: true, schedule: clean });
      }

      /* ---------- rahasia integrasi (write-only) ---------- */
      if (op === 'secrets' && method === 'PUT') {
        const denied = requireAdmin();
        if (denied) return denied;
        const body = (await readBody(16 * 1024)) as Partial<Secrets> | null | undefined;
        if (!body || typeof body !== 'object') return fail(400, 'Format data tidak valid.', 'invalid');
        const cur = (await kv.get<Partial<Secrets>>('secrets')) ?? {};
        const next: Partial<Secrets> = { ...cur };
        for (const k of ['fonnteToken', 'driveScriptUrl', 'driveSecret', 'supabaseUrl', 'supabaseKey'] as const) {
          const v = (body as Record<string, unknown>)[k];
          if (typeof v === 'string') next[k] = v.trim().slice(0, 1000);
        }
        if (next.driveScriptUrl && !/^https:\/\/script\.google(usercontent)?\.com\//.test(next.driveScriptUrl)) {
          return fail(400, 'URL Google Apps Script harus diawali https://script.google.com/', 'invalid');
        }
        if (next.supabaseUrl && !isValidSupabaseUrl(next.supabaseUrl)) {
          return fail(400, 'URL Supabase harus diawali https:// (contoh: https://xyzcompany.supabase.co)', 'invalid');
        }
        await kv.set('secrets', next);
        return json({ ok: true, secrets: await secretsStatus() });
      }

      if (op === 'wa-groups' && method === 'GET') {
        const denied = requireAdmin();
        if (denied) return denied;
        const s = await effectiveSecrets();
        const r = await listWaGroups(fetchImpl, s.fonnteToken);
        return json({ ok: r.ok, groups: r.groups, message: r.message });
      }

      if (op === 'drive-test' && method === 'POST') {
        const denied = requireAdmin();
        if (denied) return denied;
        const [s, cfg] = await Promise.all([effectiveSecrets(), loadConfig()]);
        const r = await testDrive(fetchImpl, s.driveScriptUrl, s.driveSecret, cfg.schoolName);
        return json(r);
      }

      if (op === 'supabase-test' && method === 'POST') {
        const denied = requireAdmin();
        if (denied) return denied;
        const s = await effectiveSecrets();
        const r = await testSupabase(fetchImpl, s.supabaseUrl, s.supabaseKey);
        return json(r);
      }

      if (op === 'supabase-sync' && method === 'POST') {
        const denied = requireAdmin();
        if (denied) return denied;
        const s = await effectiveSecrets();
        const r = await syncAllToSupabase({ fetchImpl, url: s.supabaseUrl, key: s.supabaseKey, kv });
        return json(r);
      }

      if (op === 'supabase-schema' && method === 'GET') {
        return json({ ok: true, sql: getSupabaseSchemaSql() });
      }

      /* ---------- foto ---------- */
      if (op === 'photos' && method === 'GET') {
        const date = url.searchParams.get('date');
        const month = url.searchParams.get('month');
        let prefix: string;
        if (date && isValidDateISO(date)) prefix = `meta/${date}/`;
        else if (month && isValidMonth(month)) prefix = `meta/${month}`;
        else return fail(400, 'Parameter date (YYYY-MM-DD) atau month (YYYY-MM) wajib.', 'invalid');
        const keys = await kv.list(prefix);
        const photos = (await readBatches<PhotoMeta>(kv, keys)).filter((p) => !p.deleted);
        photos.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
        return json({ ok: true, photos });
      }

      if (op === 'photo' && method === 'GET') {
        const id = url.searchParams.get('id') || '';
        if (!/^[A-Za-z0-9_-]{6,60}$/.test(id)) return fail(400, 'ID tidak valid.', 'invalid');
        const rec = await kv.get<{ data: string }>(imgKey(id));
        const parsed = rec ? dataUrlToBytes(rec.data) : null;
        if (!parsed) return fail(404, 'Foto tidak ditemukan.', 'not_found');
        return new Response(parsed.bytes as unknown as BodyInit, {
          status: 200,
          headers: { 'content-type': parsed.mime, 'cache-control': 'private, max-age=3600' },
        });
      }

      if (op === 'photo' && method === 'POST') {
        const body = await readBody(4 * 1024 * 1024);
        if (body === undefined) return fail(413, 'Foto terlalu besar.', 'too_large');
        const up = sanitizePhotoUpload(body);
        if (!up) return fail(400, 'Data foto tidak valid (tanggal, waktu, lokasi, kondisi, atau gambar).', 'invalid');

        const existing = await findMeta(up.tanggal, up.id);
        if (existing && !existing.deleted) return json({ ok: true, photo: existing, duplicate: true });

        const meta: PhotoMeta = {
          id: up.id,
          tanggal: up.tanggal,
          waktu: up.waktu,
          lokasi: up.lokasi,
          staffId: up.staffId,
          staffNama: up.staffNama,
          kondisi: up.kondisi,
          keterangan: up.keterangan,
          sumber: up.sumber,
          uploadedAt: nowFn().toISOString(),
          fileName: buildFileName(up),
          thumb: up.thumb,
        };
        await kv.set(imgKey(up.id), { data: up.image });
        if (opts.hooks?.onPhotoSaved) {
          try {
            const extra = await opts.hooks.onPhotoSaved(meta, up.image);
            if (extra && extra.localPath) meta.localPath = extra.localPath;
          } catch (err) {
            console.error('[piket-api] hook arsip lokal gagal', err);
          }
        }
        await kv.set(metaKey(up.tanggal, up.id), meta);
        await mirrorSupabase(metaKey(up.tanggal, up.id), meta);
        await mirrorSupabase(imgKey(up.id), { data: up.image });
        return json({ ok: true, photo: meta });
      }

      if (op === 'photo' && method === 'DELETE') {
        const denied = requireAdmin();
        if (denied) return denied;
        const id = url.searchParams.get('id') || '';
        const date = url.searchParams.get('date') || '';
        if (!/^[A-Za-z0-9_-]{6,60}$/.test(id) || !isValidDateISO(date)) return fail(400, 'Parameter tidak valid.', 'invalid');
        const meta = await findMeta(date, id);
        if (!meta) return fail(404, 'Foto tidak ditemukan.', 'not_found');
        await kv.set(metaKey(date, id), { ...meta, deleted: true, thumb: '' });
        await kv.delete(imgKey(id));
        await mirrorSupabase(metaKey(date, id), { ...meta, deleted: true, thumb: '' });
        return json({ ok: true });
      }

      /* ---------- pengiriman: Google Drive & WhatsApp (terpisah agar ringan & dapat diulang) ---------- */
      if ((op === 'drive' || op === 'wa') && method === 'POST') {
        const id = url.searchParams.get('id') || '';
        const date = url.searchParams.get('date') || '';
        if (!/^[A-Za-z0-9_-]{6,60}$/.test(id) || !isValidDateISO(date)) return fail(400, 'Parameter tidak valid.', 'invalid');
        const meta = await findMeta(date, id);
        if (!meta || meta.deleted) return fail(404, 'Foto tidak ditemukan.', 'not_found');
        const img = await kv.get<{ data: string }>(imgKey(id));
        if (!img) return fail(404, 'Berkas foto tidak ditemukan.', 'not_found');
        const [cfg, sec] = await Promise.all([loadConfig(), effectiveSecrets()]);

        let result: DispatchResult;
        if (op === 'drive') {
          if (!cfg.driveEnabled) {
            result = { ok: false, skipped: true, message: 'Penyimpanan Google Drive dinonaktifkan di Pengaturan.' };
          } else {
            result = await uploadPhotoToDrive({
              fetchImpl,
              scriptUrl: sec.driveScriptUrl,
              secret: sec.driveSecret,
              photo: meta,
              imageDataUrl: img.data,
              schoolName: cfg.schoolName,
            });
          }
          if (result.ok) {
            meta.driveUrl = result.url;
            meta.driveAt = nowFn().toISOString();
            delete meta.driveError;
          } else if (!result.skipped) {
            meta.driveError = result.message.slice(0, 200);
          }
        } else {
          if (!cfg.waEnabled) {
            result = { ok: false, skipped: true, message: 'Notifikasi WhatsApp dinonaktifkan di Pengaturan.' };
          } else {
            result = await sendWhatsApp({
              fetchImpl,
              token: sec.fonnteToken,
              target: cfg.waGroupTarget,
              photo: meta,
              imageDataUrl: img.data,
              schoolName: cfg.schoolName,
            });
          }
          if (result.ok) {
            meta.waAt = nowFn().toISOString();
            delete meta.waError;
          } else if (!result.skipped) {
            meta.waError = result.message.slice(0, 200);
          }
        }
        await kv.set(metaKey(date, id), meta);
        return json({ ok: true, result, photo: meta });
      }

      if (op === 'drive-recap' && method === 'POST') {
        const body = (await readBody(4 * 1024 * 1024)) as { month?: string; fileName?: string; mimeType?: string; base64?: string } | null | undefined;
        if (!body || !isValidMonth(body.month) || typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(body.base64)) {
          return fail(400, 'Data rekap tidak valid.', 'invalid');
        }
        const [cfg, sec] = await Promise.all([loadConfig(), effectiveSecrets()]);
        if (!cfg.driveEnabled) return json({ ok: true, result: { ok: false, skipped: true, message: 'Google Drive dinonaktifkan di Pengaturan.' } });
        const fileName = String(body.fileName || `Rekap_Piket_${body.month}.xlsx`).replace(/[^A-Za-z0-9_. -]/g, '_').slice(0, 100);
        const result = await uploadRecapToDrive({
          fetchImpl,
          scriptUrl: sec.driveScriptUrl,
          secret: sec.driveSecret,
          month: body.month,
          fileName,
          mimeType: body.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          base64: body.base64,
          schoolName: cfg.schoolName,
        });
        return json({ ok: true, result });
      }

      return fail(404, 'Operasi tidak dikenal.', 'unknown_op');
    } catch (err) {
      console.error('[piket-api] error', err);
      return fail(500, 'Terjadi kesalahan pada server.', 'server_error');
    }
  };
}

