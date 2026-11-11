/** Tipe data bersama (aplikasi web, server lokal, dan Netlify Function). Tanpa modul Node/DOM. */

export type Gate = 'Gerbang Depan' | 'Gerbang Belakang' | 'Halaman / Pos Sekolah';
export type Condition = 'Aman & Tertib' | 'Lancar & Terkendali' | 'Padat / Ramai' | 'Hujan / Cuaca Buruk';
export type PhotoSource = 'kamera' | 'galeri';

export const GATES: Gate[] = ['Gerbang Depan', 'Gerbang Belakang', 'Halaman / Pos Sekolah'];
export const CONDITIONS: Condition[] = ['Aman & Tertib', 'Lancar & Terkendali', 'Padat / Ramai', 'Hujan / Cuaca Buruk'];
export const REPLACEMENT_REASONS = [
  'Tugas Luar / Dinas Luar',
  'Izin Pribadi / Keluarga',
  'Sakit',
  'Tukar Jadwal',
  'Lainnya',
] as const;
export type ReplacementReason = (typeof REPLACEMENT_REASONS)[number];

export const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export interface Staff {
  id: string;
  nama: string;
  jabatan: string;
  fotoUrl?: string; // Data URL base64 atau path gambar avatar
}

export interface Assignment {
  id: string;
  tanggal: string; // YYYY-MM-DD
  hari: string;
  frontStaffId: string;
  backStaffId: string;
  catatan?: string;
  /** Pengganti (dinas luar, izin, sakit, tukar jadwal) */
  frontReplacementId?: string;
  frontReplacementReason?: ReplacementReason;
  frontReplacementNotes?: string;
  backReplacementId?: string;
  backReplacementReason?: ReplacementReason;
  backReplacementNotes?: string;
}

export interface Config {
  schoolName: string;
  schoolSub: string;
  logoSekolahUrl?: string; // URL / Base64 logo utama sekolah
  logoVisiUrl?: string;    // URL / Base64 logo visi / branding
  jamMulai: string; // "06:30"
  jamSelesai: string; // "07:15"
  hariKerja: string[];
  /** Tanggal libur tambahan (YYYY-MM-DD) yang dilewati saat membuat jadwal. */
  liburDates: string[];
  coordinatorStaffId: string;
  documentTitle: string;
  waEnabled: boolean;
  waAutoSend: boolean;
  waGroupName: string;
  waGroupInviteLink: string;
  /** ID grup Fonnte, mis. 120363xxxx@g.us (bukan rahasia; token disimpan terpisah di server). */
  waGroupTarget: string;
  driveEnabled: boolean;
  driveAutoUpload: boolean;
  /** URL folder Drive sekolah (hanya tautan tampilan, untuk tombol "Buka Drive"). */
  driveFolderUrl: string;
  /** Integrasi database Supabase (PostgreSQL & PostgREST) */
  supabaseEnabled: boolean;
  supabaseAutoSync: boolean;
}

export const DEFAULT_CONFIG: Config = {
  schoolName: 'SD NEGERI 1 REJOSO',
  schoolSub: 'Piket Gerbang Guru',
  logoSekolahUrl: '/logo-sekolah.png',
  logoVisiUrl: '/logo-visi.png',
  jamMulai: '06:30',
  jamSelesai: '07:15',
  hariKerja: ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
  liburDates: [],
  coordinatorStaffId: '',
  documentTitle: 'DAFTAR HADIR DAN JADWAL PIKET GURU GERBANG SEKOLAH',
  waEnabled: false,
  waAutoSend: true,
  waGroupName: '',
  waGroupInviteLink: '',
  waGroupTarget: '',
  driveEnabled: false,
  driveAutoUpload: true,
  driveFolderUrl: '',
  supabaseEnabled: false,
  supabaseAutoSync: true,
};

/** Rahasia sisi-server. TIDAK PERNAH dikirim ke browser (hanya penanda terisi/tidak). */
export interface Secrets {
  fonnteToken: string;
  driveScriptUrl: string;
  driveSecret: string;
  supabaseUrl: string;
  supabaseKey: string;
}

export interface SecretsStatus {
  hasFonnteToken: boolean;
  hasDriveScript: boolean;
  hasDriveSecret: boolean;
  hasSupabase: boolean;
  fonnteFromEnv: boolean;
  driveFromEnv: boolean;
  supabaseFromEnv: boolean;
}

export interface PhotoMeta {
  id: string;
  tanggal: string;
  waktu: string; // "06:45:10 WIB"
  lokasi: Gate;
  staffId: string;
  staffNama: string;
  kondisi: Condition;
  keterangan: string;
  sumber: PhotoSource;
  uploadedAt: string; // ISO
  fileName: string;
  /** thumbnail kecil (data URL) agar galeri cepat dimuat */
  thumb: string;
  /** hasil pengiriman */
  driveUrl?: string;
  driveAt?: string;
  driveError?: string;
  waAt?: string;
  waError?: string;
  /** salinan arsip lokal (hanya mode lokal) */
  localPath?: string;
  deleted?: boolean;
}

export interface PhotoUploadBody {
  id: string;
  tanggal: string;
  waktu: string;
  lokasi: Gate;
  staffId: string;
  staffNama: string;
  kondisi: Condition;
  keterangan: string;
  sumber: PhotoSource;
  image: string; // data URL jpeg
  thumb: string; // data URL jpeg kecil
}

export interface DispatchResult {
  ok: boolean;
  skipped?: boolean;
  message: string;
  url?: string;
}

export interface WaGroup {
  id: string;
  name: string;
}

