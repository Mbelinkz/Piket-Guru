-- ====================================================================
-- SKRIP SETUP DATABASE SUPABASE - APLIKASI PIKET GERBANG GURU
-- SD NEGERI 1 REJOSO
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

