/**
 * Driver integrasi Supabase (PostgreSQL & PostgREST API).
 * Framework-agnostik: murni menggunakan fetch standar (bekerja di Node.js, Vercel, Netlify, browser, & test).
 */
import type { Assignment, Config, DispatchResult, PhotoMeta, Staff } from './types.ts';
import type { FetchLike } from './integrations.ts';
import type { Kv } from './api-core.ts';

export interface SupabaseConfig {
  url: string;
  key: string;
}

export interface SupabaseTestResult extends DispatchResult {
  tableKvExists?: boolean;
  tablesReady?: boolean;
  version?: string;
}

/** Validasi format URL Supabase */
export function isValidSupabaseUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

/** Membersihkan trailing slash URL */
export function normalizeSupabaseUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '');
}

/** Header standar untuk PostgREST Supabase */
function postgrestHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: key.trim(),
    Authorization: `Bearer ${key.trim()}`,
    'content-type': 'application/json',
    ...extra,
  };
}

/**
 * Menguji koneksi ke Supabase dan memeriksa ketersediaan tabel piket_kv.
 */
export async function testSupabase(
  fetchImpl: FetchLike,
  url: string,
  key: string
): Promise<SupabaseTestResult> {
  const cleanUrl = normalizeSupabaseUrl(url);
  const cleanKey = (key || '').trim();

  if (!cleanUrl || !cleanKey) {
    return {
      ok: false,
      skipped: true,
      message: 'URL Supabase dan API Key belum diisi di Pengaturan.',
    };
  }

  if (!isValidSupabaseUrl(cleanUrl)) {
    return {
      ok: false,
      message: 'Format URL Supabase tidak valid (contoh: https://xyzcompany.supabase.co).',
    };
  }

  try {
    // 1. Cek ketersediaan tabel piket_kv
    const kvCheckUrl = `${cleanUrl}/rest/v1/piket_kv?select=key&limit=1`;
    const res = await fetchImpl(kvCheckUrl, {
      method: 'GET',
      headers: postgrestHeaders(cleanKey),
    });

    if (res.ok) {
      return {
        ok: true,
        tableKvExists: true,
        tablesReady: true,
        message: 'Koneksi ke Supabase BERHASIL! Database dan tabel piket_kv siap digunakan.',
        url: cleanUrl,
      };
    }

    // Tangani bila tabel belum dibuat (PGRST205 atau 404 dari PostgREST)
    if (res.status === 404 || res.status === 400) {
      const errBody = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
      if (errBody?.code === 'PGRST205' || errBody?.message?.includes('piket_kv')) {
        return {
          ok: true,
          tableKvExists: false,
          tablesReady: false,
          message:
            'Kredensial Supabase VALID, namun tabel belum dibuat. Silakan salin skrip SQL di tombol "Panduan SQL Supabase" lalu jalankan di Supabase SQL Editor.',
          url: cleanUrl,
        };
      }
    }

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message: 'Koneksi ditolak (401/403). Pastikan Supabase Anon Key atau Service Role Key sudah benar.',
      };
    }

    return {
      ok: false,
      message: `Supabase merespons HTTP ${res.status}. Pastikan URL dan API Key sesuai.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Gagal menghubungi Supabase: ${(err as Error).message}`,
    };
  }
}

/**
 * Operasi PostgREST Supabase untuk Key-Value
 */
export async function supabaseKvGet<T>(
  fetchImpl: FetchLike,
  url: string,
  key: string,
  kvKey: string
): Promise<T | null> {
  try {
    const endpoint = `${normalizeSupabaseUrl(url)}/rest/v1/piket_kv?key=eq.${encodeURIComponent(kvKey)}&select=value`;
    const res = await fetchImpl(endpoint, {
      method: 'GET',
      headers: postgrestHeaders(key),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ value: unknown }>;
    if (Array.isArray(rows) && rows.length > 0 && rows[0].value !== undefined) {
      return rows[0].value as T;
    }
    return null;
  } catch {
    return null;
  }
}

export async function supabaseKvSet(
  fetchImpl: FetchLike,
  url: string,
  key: string,
  kvKey: string,
  value: unknown
): Promise<boolean> {
  try {
    const endpoint = `${normalizeSupabaseUrl(url)}/rest/v1/piket_kv`;
    const body = [{ key: kvKey, value, updated_at: new Date().toISOString() }];
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: postgrestHeaders(key, {
        Prefer: 'resolution=merge-duplicates',
      }),
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function supabaseKvDelete(
  fetchImpl: FetchLike,
  url: string,
  key: string,
  kvKey: string
): Promise<boolean> {
  try {
    const endpoint = `${normalizeSupabaseUrl(url)}/rest/v1/piket_kv?key=eq.${encodeURIComponent(kvKey)}`;
    const res = await fetchImpl(endpoint, {
      method: 'DELETE',
      headers: postgrestHeaders(key),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function supabaseKvList(
  fetchImpl: FetchLike,
  url: string,
  key: string,
  prefix: string
): Promise<string[]> {
  try {
    // PostgREST LIKE query: col=like.val%
    const endpoint = `${normalizeSupabaseUrl(url)}/rest/v1/piket_kv?key=like.${encodeURIComponent(prefix)}%25&select=key`;
    const res = await fetchImpl(endpoint, {
      method: 'GET',
      headers: postgrestHeaders(key),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ key: string }>;
    if (Array.isArray(rows)) {
      return rows.map((r) => r.key);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Sinkronisasi data ke tabel terstruktur Supabase (piket_staff, piket_schedule, piket_photos, piket_config)
 * Memudahkan pengguna melihat dan mengelola data langsung di Supabase Table Editor!
 */
export async function mirrorToStructuredTables(
  fetchImpl: FetchLike,
  url: string,
  key: string,
  kvKey: string,
  value: unknown
): Promise<void> {
  const cleanUrl = normalizeSupabaseUrl(url);
  const headers = postgrestHeaders(key, { Prefer: 'resolution=merge-duplicates' });

  try {
    // 1. Staff / Guru
    if (kvKey === 'staff' && Array.isArray(value)) {
      const staffList = value as Staff[];
      const rows = staffList.map((s) => ({
        id: s.id,
        nama: s.nama,
        jabatan: s.jabatan,
        foto_url: s.fotoUrl || null,
        updated_at: new Date().toISOString(),
      }));
      if (rows.length > 0) {
        await fetchImpl(`${cleanUrl}/rest/v1/piket_staff`, {
          method: 'POST',
          headers,
          body: JSON.stringify(rows),
        }).catch(() => undefined);
      }
    }

    // 2. Jadwal Piket
    if (kvKey === 'schedule' && Array.isArray(value)) {
      const scheduleList = value as Assignment[];
      const rows = scheduleList.map((a) => ({
        id: a.id,
        tanggal: a.tanggal,
        hari: a.hari,
        front_staff_id: a.frontStaffId,
        back_staff_id: a.backStaffId,
        catatan: a.catatan || null,
        front_replacement_id: a.frontReplacementId || null,
        front_replacement_reason: a.frontReplacementReason || null,
        front_replacement_notes: a.frontReplacementNotes || null,
        back_replacement_id: a.backReplacementId || null,
        back_replacement_reason: a.backReplacementReason || null,
        back_replacement_notes: a.backReplacementNotes || null,
        updated_at: new Date().toISOString(),
      }));
      if (rows.length > 0) {
        // Kirim dalam batch agar tidak melampaui limit payload
        for (let i = 0; i < rows.length; i += 50) {
          await fetchImpl(`${cleanUrl}/rest/v1/piket_schedule`, {
            method: 'POST',
            headers,
            body: JSON.stringify(rows.slice(i, i + 50)),
          }).catch(() => undefined);
        }
      }
    }

    // 3. Konfigurasi Sekolah
    if (kvKey === 'config' && value && typeof value === 'object') {
      const cfg = value as Config;
      const row = {
        id: 'current',
        school_name: cfg.schoolName,
        jam_mulai: cfg.jamMulai,
        jam_selesai: cfg.jamSelesai,
        data: cfg,
        updated_at: new Date().toISOString(),
      };
      await fetchImpl(`${cleanUrl}/rest/v1/piket_config`, {
        method: 'POST',
        headers,
        body: JSON.stringify([row]),
      }).catch(() => undefined);
    }

    // 4. Metadata Foto Piket (meta/YYYY-MM-DD/ID)
    if (kvKey.startsWith('meta/') && value && typeof value === 'object') {
      const p = value as PhotoMeta;
      const row = {
        id: p.id,
        tanggal: p.tanggal,
        waktu: p.waktu,
        lokasi: p.lokasi,
        staff_id: p.staffId,
        staff_nama: p.staffNama,
        kondisi: p.kondisi,
        keterangan: p.keterangan || '',
        sumber: p.sumber,
        uploaded_at: p.uploadedAt,
        file_name: p.fileName,
        thumb: p.thumb,
        drive_url: p.driveUrl || null,
        drive_at: p.driveAt || null,
        wa_at: p.waAt || null,
        deleted: !!p.deleted,
        updated_at: new Date().toISOString(),
      };
      await fetchImpl(`${cleanUrl}/rest/v1/piket_photos`, {
        method: 'POST',
        headers,
        body: JSON.stringify([row]),
      }).catch(() => undefined);
    }
  } catch (err) {
    // Abaikan jika tabel terstruktur belum dibuat
    console.warn('[supabase] mirror to structured table skipped:', (err as Error).message);
  }
}

/**
 * Membuat Kv adapter berbasis Supabase dengan fallback lokal opsional.
 */
export function createSupabaseKv(opts: {
  url: string;
  key: string;
  fetchImpl?: FetchLike;
  fallbackKv?: Kv;
  mirrorStructured?: boolean;
}): Kv {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const fallback = opts.fallbackKv;
  const mirror = opts.mirrorStructured ?? true;

  return {
    async get<T>(k: string): Promise<T | null> {
      const remote = await supabaseKvGet<T>(fetchImpl, opts.url, opts.key, k);
      if (remote !== null && remote !== undefined) return remote;
      if (fallback) return fallback.get<T>(k);
      return null;
    },

    async set(k: string, v: unknown): Promise<void> {
      // Simpan lokal terlebih dahulu bila ada fallback
      if (fallback) {
        try {
          await fallback.set(k, v);
        } catch {
          /* abaikan */
        }
      }

      // Simpan ke Supabase piket_kv
      await supabaseKvSet(fetchImpl, opts.url, opts.key, k, v);

      // Cerminkan ke tabel terstruktur bila aktif
      if (mirror) {
        mirrorToStructuredTables(fetchImpl, opts.url, opts.key, k, v).catch(() => undefined);
      }
    },

    async delete(k: string): Promise<void> {
      if (fallback) {
        try {
          await fallback.delete(k);
        } catch {
          /* abaikan */
        }
      }
      await supabaseKvDelete(fetchImpl, opts.url, opts.key, k);
    },

    async list(prefix: string): Promise<string[]> {
      const set = new Set<string>();
      if (fallback) {
        try {
          const localKeys = await fallback.list(prefix);
          for (const lk of localKeys) set.add(lk);
        } catch {
          /* abaikan */
        }
      }
      const remoteKeys = await supabaseKvList(fetchImpl, opts.url, opts.key, prefix);
      for (const rk of remoteKeys) set.add(rk);
      return [...set];
    },
  };
}

/**
 * Sinkronisasi seluruh data lokal (config, staff, schedule, photos) ke Supabase.
 */
export async function syncAllToSupabase(opts: {
  fetchImpl: FetchLike;
  url: string;
  key: string;
  kv: Kv;
}): Promise<{
  ok: boolean;
  message: string;
  stats?: { staffCount: number; scheduleCount: number; photosCount: number };
}> {
  const { fetchImpl, url, key, kv } = opts;
  const testRes = await testSupabase(fetchImpl, url, key);
  if (!testRes.ok) {
    return { ok: false, message: testRes.message };
  }

  try {
    let staffCount = 0;
    let scheduleCount = 0;
    let photosCount = 0;

    // 1. Config
    const config = await kv.get<Config>('config');
    if (config) {
      await supabaseKvSet(fetchImpl, url, key, 'config', config);
      await mirrorToStructuredTables(fetchImpl, url, key, 'config', config);
    }

    // 2. Staff
    const staff = await kv.get<Staff[]>('staff');
    if (staff && Array.isArray(staff)) {
      staffCount = staff.length;
      await supabaseKvSet(fetchImpl, url, key, 'staff', staff);
      await mirrorToStructuredTables(fetchImpl, url, key, 'staff', staff);
    }

    // 3. Schedule
    const schedule = await kv.get<Assignment[]>('schedule');
    if (schedule && Array.isArray(schedule)) {
      scheduleCount = schedule.length;
      await supabaseKvSet(fetchImpl, url, key, 'schedule', schedule);
      await mirrorToStructuredTables(fetchImpl, url, key, 'schedule', schedule);
    }

    // 4. Photos (meta/*)
    const photoKeys = await kv.list('meta/');
    for (const pk of photoKeys) {
      const meta = await kv.get<PhotoMeta>(pk);
      if (meta) {
        photosCount++;
        await supabaseKvSet(fetchImpl, url, key, pk, meta);
        await mirrorToStructuredTables(fetchImpl, url, key, pk, meta);
      }
    }

    return {
      ok: true,
      message: `Berhasil menyinkronkan data ke Supabase: ${staffCount} data guru, ${scheduleCount} hari jadwal piket, dan ${photosCount} arsip foto dokumentasi.`,
      stats: { staffCount, scheduleCount, photosCount },
    };
  } catch (err) {
    return {
      ok: false,
      message: `Gagal menyinkronkan data ke Supabase: ${(err as Error).message}`,
    };
  }
}

/**
 * Menghasilkan skrip SQL DDL untuk pembuatan tabel dan RLS di Supabase.
 */
export function getSupabaseSchemaSql(): string {
  return `-- ====================================================================
-- SKRIP SETUP DATABASE SUPABASE - APLIKASI PIKET GERBANG GURU
-- Salin dan jalankan skrip ini di: Supabase Dashboard > SQL Editor > New query
-- ====================================================================

-- 1. TABEL UTAMA: Key-Value Universal (piket_kv)
-- Menyimpan konfigurasi, data guru, jadwal, dan metadata foto secara aman.
CREATE TABLE IF NOT EXISTS piket_kv (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indeks untuk pencarian cepat berbasis prefix (misal: meta/2026-11/...)
CREATE INDEX IF NOT EXISTS idx_piket_kv_key_prefix ON piket_kv (key text_pattern_ops);

-- 2. TABEL TERSTRUKTUR: Data Guru & Tenaga Kependidikan (piket_staff)
CREATE TABLE IF NOT EXISTS piket_staff (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  jabatan TEXT NOT NULL,
  foto_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. TABEL TERSTRUKTUR: Jadwal Piket Harian (piket_schedule)
CREATE TABLE IF NOT EXISTS piket_schedule (
  id TEXT PRIMARY KEY,
  tanggal DATE NOT NULL,
  hari TEXT NOT NULL,
  front_staff_id TEXT,
  back_staff_id TEXT,
  catatan TEXT,
  front_replacement_id TEXT,
  front_replacement_reason TEXT,
  front_replacement_notes TEXT,
  back_replacement_id TEXT,
  back_replacement_reason TEXT,
  back_replacement_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_piket_schedule_tanggal ON piket_schedule (tanggal);

-- 4. TABEL TERSTRUKTUR: Dokumentasi Foto Piket (piket_photos)
CREATE TABLE IF NOT EXISTS piket_photos (
  id TEXT PRIMARY KEY,
  tanggal DATE NOT NULL,
  waktu TEXT NOT NULL,
  lokasi TEXT NOT NULL,
  staff_id TEXT,
  staff_nama TEXT,
  kondisi TEXT,
  keterangan TEXT,
  sumber TEXT,
  uploaded_at TIMESTAMPTZ,
  file_name TEXT,
  thumb TEXT,
  image_data TEXT,
  drive_url TEXT,
  drive_at TIMESTAMPTZ,
  wa_at TIMESTAMPTZ,
  deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_piket_photos_tanggal ON piket_photos (tanggal);
CREATE INDEX IF NOT EXISTS idx_piket_photos_uploaded_at ON piket_photos (uploaded_at DESC);

-- 5. TABEL TERSTRUKTUR: Konfigurasi Sekolah (piket_config)
CREATE TABLE IF NOT EXISTS piket_config (
  id TEXT PRIMARY KEY DEFAULT 'current',
  school_name TEXT,
  jam_mulai TEXT,
  jam_selesai TEXT,
  data JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ====================================================================
-- KEBIJAKAN AKSES & KEAMANAN (ROW LEVEL SECURITY - RLS)
-- Mengizinkan aplikasi membaca & menulis data dengan Anon Key / Service Key
-- ====================================================================

ALTER TABLE piket_kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE piket_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE piket_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE piket_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE piket_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Akses publik piket_kv" ON piket_kv;
CREATE POLICY "Akses publik piket_kv" ON piket_kv FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Akses publik piket_staff" ON piket_staff;
CREATE POLICY "Akses publik piket_staff" ON piket_staff FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Akses publik piket_schedule" ON piket_schedule;
CREATE POLICY "Akses publik piket_schedule" ON piket_schedule FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Akses publik piket_photos" ON piket_photos;
CREATE POLICY "Akses publik piket_photos" ON piket_photos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Akses publik piket_config" ON piket_config;
CREATE POLICY "Akses publik piket_config" ON piket_config FOR ALL USING (true) WITH CHECK (true);
`;
}

