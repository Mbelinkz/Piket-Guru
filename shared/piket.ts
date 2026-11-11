/** Logika murni piket gerbang (tanpa DOM/Node): tanggal, nama berkas, pesan WA, validasi, jadwal. */
import type {
  Assignment,
  Condition,
  Config,
  Gate,
  PhotoMeta,
  PhotoSource,
  PhotoUploadBody,
  ReplacementReason,
  Staff,
} from './types.ts';
import {
  CONDITIONS,
  DAY_NAMES,
  DEFAULT_CONFIG,
  GATES,
  MONTH_NAMES,
  REPLACEMENT_REASONS,
} from './types.ts';

/* ---------------- tanggal & waktu (zona waktu lokal perangkat/Jakarta) ---------------- */

export function localDateISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function jakartaDateISO(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function clockWIB(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} WIB`;
}

export function isValidDateISO(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidMonth(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function dayNameOf(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
}

export function formatIndonesianDate(dateISO: string): string {
  if (!isValidDateISO(dateISO)) return dateISO;
  const [y, m, d] = dateISO.split('-').map(Number);
  return `${dayNameOf(dateISO)}, ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
}

/* ---------------- nama berkas & folder arsip (per hari, bertambah, tidak menimpa) ---------------- */

export function sanitizeSegment(s: string, max = 45): string {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, max);
}

export function buildFileName(p: { tanggal: string; waktu: string; lokasi: string; staffNama: string; id: string }): string {
  const time = p.waktu.replace(/\s*WIB/i, '').replace(/:/g, '-');
  const shortId = sanitizeSegment(p.id.replace(/^photo-/, ''), 12);
  return `${p.tanggal}_${sanitizeSegment(time)}_${sanitizeSegment(p.lokasi)}_${sanitizeSegment(p.staffNama)}__${shortId}.jpg`;
}

/** Struktur folder: [Tahun, "MM - Bulan", "YYYY-MM-DD (Hari)"] */
export function folderPathFor(tanggal: string): string[] {
  const [y, m] = tanggal.split('-').map(Number);
  return [String(y), `${String(m).padStart(2, '0')} - ${MONTH_NAMES[m - 1]}`, `${tanggal} (${dayNameOf(tanggal)})`];
}

/* ---------------- pesan WhatsApp ---------------- */

export function buildWaMessage(photo: PhotoMeta, schoolName: string): string {
  const lines = [
    '*🔔 LAPORAN DOKUMENTASI PIKET PAGI GURU*',
    `*${(schoolName || 'SD NEGERI 1 REJOSO').toUpperCase()}*`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    `👤 *Petugas Piket* : ${photo.staffNama}`,
    `📅 *Hari, Tanggal* : ${formatIndonesianDate(photo.tanggal)}`,
    `⏰ *Waktu Presensi* : ${photo.waktu}`,
    `📍 *Lokasi Tugas* : ${photo.lokasi}`,
    `✅ *Kondisi Gerbang* : ${photo.kondisi}`,
    `📝 *Kegiatan / Catatan* : ${photo.keterangan || '-'}`,
  ];
  if (photo.driveUrl) lines.push(`🗂️ *Arsip Google Drive* : ${photo.driveUrl}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`_Notifikasi otomatis Aplikasi Piket Gerbang ${schoolName || ''}_`.trim());
  return lines.join('\n');
}

/* ---------------- validasi & sanitasi input server ---------------- */

export const LIMITS = {
  maxImageBytes: 2_500_000,
  maxThumbBytes: 60_000,
  maxStaff: 200,
  maxAssignments: 800,
  maxText: 400,
};

const clip = (v: unknown, n = LIMITS.maxText): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const DATA_JPEG = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : '';
  return Math.floor((b64.length * 3) / 4);
}

export function sanitizePhotoUpload(raw: unknown): PhotoUploadBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = clip(r.id, 60);
  if (!/^[A-Za-z0-9_-]{6,60}$/.test(id)) return null;
  const tanggal = r.tanggal;
  if (!isValidDateISO(tanggal)) return null;
  const waktu = clip(r.waktu, 20);
  if (!/^\d{2}:\d{2}(:\d{2})?( WIB)?$/.test(waktu)) return null;
  if (!GATES.includes(r.lokasi as Gate)) return null;
  if (!CONDITIONS.includes(r.kondisi as Condition)) return null;
  const sumber: PhotoSource = r.sumber === 'galeri' ? 'galeri' : 'kamera';
  const image = typeof r.image === 'string' ? r.image : '';
  const thumb = typeof r.thumb === 'string' ? r.thumb : '';
  if (!DATA_JPEG.test(image) || dataUrlBytes(image) > LIMITS.maxImageBytes) return null;
  if (thumb && (!DATA_JPEG.test(thumb) || dataUrlBytes(thumb) > LIMITS.maxThumbBytes)) return null;
  const staffNama = clip(r.staffNama, 120);
  if (!staffNama) return null;
  return {
    id,
    tanggal,
    waktu: waktu.endsWith('WIB') ? waktu : `${waktu.length === 5 ? `${waktu}:00` : waktu} WIB`,
    lokasi: r.lokasi as Gate,
    staffId: clip(r.staffId, 80),
    staffNama,
    kondisi: r.kondisi as Condition,
    keterangan: clip(r.keterangan),
    sumber,
    image,
    thumb,
  };
}

export function sanitizeStaffList(raw: unknown): Staff[] | null {
  if (!Array.isArray(raw) || raw.length > LIMITS.maxStaff) return null;
  const seen = new Set<string>();
  const out: Staff[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const id = clip(o.id, 80);
    const nama = clip(o.nama, 120);
    if (!id || !nama || seen.has(id)) continue;
    seen.add(id);
    const fotoUrl = typeof o.fotoUrl === 'string' && (o.fotoUrl.startsWith('data:image/') || o.fotoUrl.startsWith('/') || o.fotoUrl.startsWith('https://')) && o.fotoUrl.length < 600_000 ? o.fotoUrl : undefined;
    out.push({ id, nama, jabatan: clip(o.jabatan, 80), fotoUrl });
  }
  return out;
}

const REASONS = REPLACEMENT_REASONS as readonly string[];

export function sanitizeSchedule(raw: unknown): Assignment[] | null {
  if (!Array.isArray(raw) || raw.length > LIMITS.maxAssignments) return null;
  const seen = new Set<string>();
  const out: Assignment[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (!isValidDateISO(o.tanggal) || seen.has(o.tanggal)) continue;
    seen.add(o.tanggal);
    const a: Assignment = {
      id: `picket-${o.tanggal}`,
      tanggal: o.tanggal,
      hari: dayNameOf(o.tanggal),
      frontStaffId: clip(o.frontStaffId, 80),
      backStaffId: clip(o.backStaffId, 80),
      catatan: clip(o.catatan, 200) || undefined,
    };
    for (const side of ['front', 'back'] as const) {
      const rid = clip(o[`${side}ReplacementId`], 80);
      if (rid) {
        a[`${side}ReplacementId`] = rid;
        const reason = clip(o[`${side}ReplacementReason`], 40);
        a[`${side}ReplacementReason`] = (REASONS.includes(reason) ? reason : 'Lainnya') as ReplacementReason;
        const notes = clip(o[`${side}ReplacementNotes`], 200);
        if (notes) a[`${side}ReplacementNotes`] = notes;
      }
    }
    out.push(a);
  }
  return out.sort((x, y) => x.tanggal.localeCompare(y.tanggal));
}

export function sanitizeConfig(raw: unknown): Config {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const time = (v: unknown, d: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const dates = Array.isArray(o.liburDates) ? o.liburDates.filter(isValidDateISO).slice(0, 400) : [];
  const days = Array.isArray(o.hariKerja) ? o.hariKerja.filter((x): x is string => DAY_NAMES.includes(x as string)) : [];
  const folderUrl = clip(o.driveFolderUrl, 300);
  const invite = clip(o.waGroupInviteLink, 300);
  const D = DEFAULT_CONFIG;
  const sanitizeLogo = (v: unknown, d: string | undefined) => {
    if (typeof v === 'string' && (v.startsWith('data:image/') || v.startsWith('/') || v.startsWith('https://')) && v.length < 900_000) {
      return v;
    }
    return d;
  };
  return {
    schoolName: clip(o.schoolName, 120) || D.schoolName,
    schoolSub: clip(o.schoolSub, 160) || D.schoolSub,
    logoSekolahUrl: sanitizeLogo(o.logoSekolahUrl, D.logoSekolahUrl),
    logoVisiUrl: sanitizeLogo(o.logoVisiUrl, D.logoVisiUrl),
    jamMulai: time(o.jamMulai, D.jamMulai),
    jamSelesai: time(o.jamSelesai, D.jamSelesai),
    hariKerja: days.length ? days : D.hariKerja,
    liburDates: dates,
    coordinatorStaffId: clip(o.coordinatorStaffId, 80),
    documentTitle: clip(o.documentTitle, 160) || D.documentTitle,
    waEnabled: bool(o.waEnabled, D.waEnabled),
    waAutoSend: bool(o.waAutoSend, D.waAutoSend),
    waGroupName: clip(o.waGroupName, 120),
    waGroupInviteLink: /^https:\/\//.test(invite) ? invite : '',
    waGroupTarget: clip(o.waGroupTarget, 80),
    driveEnabled: bool(o.driveEnabled, D.driveEnabled),
    driveAutoUpload: bool(o.driveAutoUpload, D.driveAutoUpload),
    driveFolderUrl: /^https:\/\//.test(folderUrl) ? folderUrl : '',
    supabaseEnabled: bool(o.supabaseEnabled, D.supabaseEnabled),
    supabaseAutoSync: bool(o.supabaseAutoSync, D.supabaseAutoSync),
  };
}

/* ---------------- jadwal ---------------- */

/** Pegawai yang bertugas pada sisi tertentu (pengganti bila ada). */
export function dutyStaffId(a: Assignment | undefined, side: 'front' | 'back'): string {
  if (!a) return '';
  return (side === 'front' ? a.frontReplacementId || a.frontStaffId : a.backReplacementId || a.backStaffId) || '';
}

export function isWorkingDay(dateISO: string, cfg: Config): boolean {
  return cfg.hariKerja.includes(dayNameOf(dateISO)) && !cfg.liburDates.includes(dateISO);
}

/**
 * Buat jadwal 1 bulan. Hari kerja dikelompokkan menjadi blok 2–3 hari berurutan;
 * tiap blok: 1 guru gerbang depan + 1 guru gerbang belakang, bergilir merata.
 */
export function generateMonthlySchedule(month: string, staff: Staff[], cfg: Config, startOffset = 0): Assignment[] {
  if (!isValidMonth(month) || staff.length === 0) return [];
  const pool = staff.length === 1 ? [staff[0], staff[0]] : staff;
  const days = monthDays(month).filter((d) => isWorkingDay(d, cfg));
  const blocks: string[][] = [];
  let i = 0;
  while (i < days.length) {
    const remaining = days.length - i;
    let size = blocks.length % 2 === 0 ? 2 : 3;
    if (remaining <= 3) size = remaining;
    else if (remaining === 4) size = 2;
    blocks.push(days.slice(i, i + size));
    i += size;
  }
  if (blocks.length > 1 && blocks[blocks.length - 1].length === 1) {
    blocks[blocks.length - 2].push(...(blocks.pop() as string[]));
  }
  let ptr = startOffset % pool.length;
  const out: Assignment[] = [];
  for (const block of blocks) {
    const front = pool[ptr % pool.length];
    ptr++;
    let back = pool[ptr % pool.length];
    if (back.id === front.id && pool.length > 1) {
      ptr++;
      back = pool[ptr % pool.length];
    }
    ptr++;
    for (const d of block) {
      out.push({
        id: `picket-${d}`,
        tanggal: d,
        hari: dayNameOf(d),
        frontStaffId: front.id,
        backStaffId: back.id,
        catatan: `Piket Gerbang 5S (${block.length} Hari Berurutan)`,
      });
    }
  }
  return out;
}

/* ---------------- rekap ---------------- */

export interface DayRecap {
  tanggal: string;
  hari: string;
  scheduled: boolean;
  frontStaffId: string;
  backStaffId: string;
  frontDone: boolean;
  backDone: boolean;
  photos: number;
  drive: number;
  wa: number;
}

export function buildMonthRecap(month: string, schedule: Assignment[], photos: PhotoMeta[]): DayRecap[] {
  const live = photos.filter((p) => !p.deleted && p.tanggal.startsWith(month));
  const byDate = new Map<string, PhotoMeta[]>();
  for (const p of live) byDate.set(p.tanggal, [...(byDate.get(p.tanggal) || []), p]);
  const sched = new Map(schedule.map((a) => [a.tanggal, a]));
  const rows: DayRecap[] = [];
  for (const d of monthDays(month)) {
    const a = sched.get(d);
    const ps = byDate.get(d) || [];
    if (!a && ps.length === 0) continue;
    const front = dutyStaffId(a, 'front');
    const back = dutyStaffId(a, 'back');
    rows.push({
      tanggal: d,
      hari: dayNameOf(d),
      scheduled: !!a,
      frontStaffId: front,
      backStaffId: back,
      frontDone: ps.some((p) => p.lokasi === 'Gerbang Depan'),
      backDone: ps.some((p) => p.lokasi === 'Gerbang Belakang'),
      photos: ps.length,
      drive: ps.filter((p) => p.driveUrl).length,
      wa: ps.filter((p) => p.waAt).length,
    });
  }
  return rows;
}

export interface TeacherRecap {
  staffId: string;
  nama: string;
  dijadwalkan: number;
  terlaksana: number;
  foto: number;
}

export function buildTeacherRecap(month: string, schedule: Assignment[], photos: PhotoMeta[], staff: Staff[]): TeacherRecap[] {
  const live = photos.filter((p) => !p.deleted && p.tanggal.startsWith(month));
  const map = new Map<string, TeacherRecap>();
  const get = (id: string, nama: string) => {
    if (!map.has(id)) map.set(id, { staffId: id, nama, dijadwalkan: 0, terlaksana: 0, foto: 0 });
    return map.get(id)!;
  };
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.nama || id;
  for (const a of schedule.filter((x) => x.tanggal.startsWith(month))) {
    for (const side of ['front', 'back'] as const) {
      const id = dutyStaffId(a, side);
      if (!id) continue;
      const rec = get(id, nameOf(id));
      rec.dijadwalkan++;
      const gate: Gate = side === 'front' ? 'Gerbang Depan' : 'Gerbang Belakang';
      if (live.some((p) => p.tanggal === a.tanggal && p.lokasi === gate)) rec.terlaksana++;
    }
  }
  for (const p of live) {
    const key = p.staffId || p.staffNama;
    get(key, p.staffNama).foto++;
  }
  return [...map.values()].sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

