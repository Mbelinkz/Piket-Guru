import type {
  Assignment,
  Config,
  DispatchResult,
  PhotoMeta,
  PhotoUploadBody,
  SecretsStatus,
  Staff,
  WaGroup,
} from '../../shared/types.ts';
import initialConfig from '../data/initialConfig.json';
import initialSchedule from '../data/initialSchedule.json';
import initialStaff from '../data/initialStaff.json';
import { buildFileName, buildWaMessage, folderPathFor, localDateISO } from '../../shared/piket.ts';
import {
  getSupabaseSchemaSql,
  mirrorToStructuredTables,
  supabaseKvSet,
  syncAllToSupabase,
  testSupabase,
} from '../../shared/supabase.ts';

const LS_CODE = 'piket_access_code_v1';
const SS_PIN = 'piket_admin_pin_v1';
const LS_QUEUE = 'piket_pending_uploads_v1';
const LS_CFG = 'piket_client_cfg_v1';
const LS_STAFF = 'piket_client_staff_v1';
const LS_SCHED = 'piket_client_sched_v1';
const LS_SECRETS = 'piket_client_secrets_v1';
const LS_PHOTOS = 'piket_client_photos_v1';

export const session = {
  get code() {
    return localStorage.getItem(LS_CODE) || 'sdn1rejoso';
  },
  set code(v: string) {
    if (v) localStorage.setItem(LS_CODE, v);
    else localStorage.removeItem(LS_CODE);
  },
  get pin() {
    return sessionStorage.getItem(SS_PIN) || '';
  },
  set pin(v: string) {
    if (v) sessionStorage.setItem(SS_PIN, v);
    else sessionStorage.removeItem(SS_PIN);
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}

/* ---------------- Penyimpanan IndexedDB lokal untuk berkas foto (kapasitas besar) ---------------- */
function openPhotoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('piket_offline_db', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('photos');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePhotoBlob(id: string, dataUrl: string): Promise<void> {
  try {
    const db = await openPhotoDb();
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(dataUrl, id);
  } catch (err) {
    console.warn('[indexeddb] gagal simpan foto blob:', err);
  }
}

async function getPhotoBlob(id: string): Promise<string | null> {
  try {
    const db = await openPhotoDb();
    return new Promise((resolve) => {
      const tx = db.transaction('photos', 'readonly');
      const req = tx.objectStore('photos').get(id);
      req.onsuccess = () => resolve((req.result as string) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function deletePhotoBlob(id: string): Promise<void> {
  try {
    const db = await openPhotoDb();
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(id);
  } catch {
    /* abaikan */
  }
}

/* ---------------- Client-side Direct Storage & Sync Google Drive ---------------- */
const clientStore = {
  getConfig(): Config {
    try {
      const raw = localStorage.getItem(LS_CFG);
      return raw ? JSON.parse(raw) : (initialConfig as unknown as Config);
    } catch {
      return initialConfig as unknown as Config;
    }
  },
  saveConfig(c: Config) {
    localStorage.setItem(LS_CFG, JSON.stringify(c));
  },
  getStaff(): Staff[] {
    try {
      const raw = localStorage.getItem(LS_STAFF);
      return raw ? JSON.parse(raw) : (initialStaff as unknown as Staff[]);
    } catch {
      return initialStaff as unknown as Staff[];
    }
  },
  saveStaff(s: Staff[]) {
    localStorage.setItem(LS_STAFF, JSON.stringify(s));
  },
  getSchedule(): Assignment[] {
    try {
      const raw = localStorage.getItem(LS_SCHED);
      return raw ? JSON.parse(raw) : (initialSchedule as unknown as Assignment[]);
    } catch {
      return initialSchedule as unknown as Assignment[];
    }
  },
  saveSchedule(a: Assignment[]) {
    localStorage.setItem(LS_SCHED, JSON.stringify(a));
  },
  getSecrets(): { fonnteToken?: string; driveScriptUrl?: string; driveSecret?: string; supabaseUrl?: string; supabaseKey?: string } {
    try {
      return JSON.parse(localStorage.getItem(LS_SECRETS) || '{}');
    } catch {
      return {};
    }
  },
  saveSecrets(s: { fonnteToken?: string; driveScriptUrl?: string; driveSecret?: string; supabaseUrl?: string; supabaseKey?: string }) {
    const cur = this.getSecrets();
    localStorage.setItem(LS_SECRETS, JSON.stringify({ ...cur, ...s }));
  },
  getPhotos(): PhotoMeta[] {
    try {
      return JSON.parse(localStorage.getItem(LS_PHOTOS) || '[]');
    } catch {
      return [];
    }
  },
  savePhotos(list: PhotoMeta[]) {
    localStorage.setItem(LS_PHOTOS, JSON.stringify(list));
  },
};

// Kirim langsung ke Google Apps Script sekolah dari browser
async function directSendDrive(action: string, payload: Record<string, unknown>): Promise<DispatchResult> {
  const sec = clientStore.getSecrets();
  const cfg = clientStore.getConfig();
  if (!sec.driveScriptUrl || !sec.driveSecret) {
    return { ok: false, skipped: true, message: 'Google Apps Script Drive belum diisi di Pengaturan.' };
  }
  try {
    const res = await fetch(sec.driveScriptUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, secret: sec.driveSecret, schoolName: cfg.schoolName, action }),
      redirect: 'follow',
    });
    const data = await res.json().catch(() => null);
    if (data?.ok) {
      return { ok: true, message: data.message || 'Tersimpan ke Google Drive sekolah.', url: data.fileUrl || data.folderUrl };
    }
    return { ok: false, message: data?.error || `Google Apps Script menolak permintaan (HTTP ${res.status}).` };
  } catch (err) {
    return { ok: false, message: `Gagal menghubungi Google Apps Script: ${(err as Error).message}` };
  }
}

/* ---------------- Network Engine (Multi-Endpoint + Dynamic Fallback) ---------------- */
const ENDPOINTS = ['/api/piket', '/.netlify/functions/piket'];
let activeEndpoint = ENDPOINTS[0];
let isClientOnlyMode = false;

async function doFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

async function request<T>(method: string, query: string, body?: unknown, admin = false): Promise<T> {
  // Jika sudah dalam mode client mandiri (misal Netlify Drop tanpa fungsi serverless)
  if (isClientOnlyMode) {
    return handleClientMode<T>(query, method, body);
  }

  const headers: Record<string, string> = { 'x-access-code': session.code };
  if (admin && session.pin) headers['x-admin-pin'] = session.pin;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res: Response | null = null;
  let triedSecondary = false;

  try {
    res = await doFetch(`${activeEndpoint}?${query}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Bila endpoint pertama 404 (misal karena rewrite Netlify), coba endpoint alternatif kedua
    if ((res.status === 404 || !res.ok) && !triedSecondary) {
      const altEndpoint = activeEndpoint === ENDPOINTS[0] ? ENDPOINTS[1] : ENDPOINTS[0];
      const altRes = await doFetch(`${altEndpoint}?${query}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }).catch(() => null);

      if (altRes && altRes.ok) {
        activeEndpoint = altEndpoint;
        res = altRes;
      }
    }
  } catch {
    // Network error: coba fallback client mode
    console.warn('[api] Jaringan server tidak dapat dihubungi, mencoba mode client lokal...');
  }

  // Jika server mengembalikan 404 atau bukan JSON (misal HTML SPA fallback saat drag-and-drop deploy)
  if (!res || res.status === 404 || res.status === 502) {
    console.info('[api] Serverless Netlify belum terpasang atau 404. Mengaktifkan Mode Mandiri Lokal (LocalStorage + Google Drive).');
    isClientOnlyMode = true;
    return handleClientMode<T>(query, method, body);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Server mengembalikan HTML (SPA fallback), berarti fungsi belum aktif
    console.info('[api] Menerima HTML bukan JSON dari server. Mengaktifkan Mode Mandiri Lokal.');
    isClientOnlyMode = true;
    return handleClientMode<T>(query, method, body);
  }

  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string; code?: string }) | null;
  if (!res.ok || !data || data.ok === false) {
    throw new ApiError(data?.error || `Permintaan gagal (HTTP ${res.status}).`, res.status, data?.code);
  }
  return data;
}

/** Menangani permintaan saat backend serverless tidak tersedia (Netlify Drop / offline) */
async function handleClientMode<T>(query: string, method: string, body?: unknown): Promise<T> {
  const params = new URLSearchParams(query);
  const op = params.get('op') || '';

  if (op === 'ping') {
    return { ok: true, app: 'piket-gerbang', configured: true, authorized: true, defaultCredentials: true } as unknown as T;
  }

  if (op === 'bootstrap') {
    const sec = clientStore.getSecrets();
    return {
      ok: true,
      config: clientStore.getConfig(),
      staff: clientStore.getStaff(),
      schedule: clientStore.getSchedule(),
      secrets: {
        hasFonnteToken: Boolean(sec.fonnteToken),
        hasDriveScript: Boolean(sec.driveScriptUrl),
        hasDriveSecret: Boolean(sec.driveSecret),
        hasSupabase: Boolean(sec.supabaseUrl && sec.supabaseKey),
        fonnteFromEnv: false,
        driveFromEnv: false,
        supabaseFromEnv: false,
      },
      defaultCredentials: true,
      isClientOnlyMode: true,
    } as unknown as T;
  }

  if (op === 'photos') {
    const date = params.get('date');
    const month = params.get('month');
    const all = clientStore.getPhotos().filter((p) => !p.deleted);
    let filtered = all;
    if (date) filtered = all.filter((p) => p.tanggal === date);
    else if (month) filtered = all.filter((p) => p.tanggal.startsWith(month));
    return { ok: true, photos: filtered } as unknown as T;
  }

  if (op === 'photo' && method === 'POST') {
    const b = body as PhotoUploadBody;
    const all = clientStore.getPhotos();
    const fileName = buildFileName({
      tanggal: b.tanggal,
      waktu: b.waktu,
      lokasi: b.lokasi,
      staffNama: b.staffNama,
      id: b.id,
    });
    const meta: PhotoMeta = {
      id: b.id,
      tanggal: b.tanggal,
      waktu: b.waktu,
      lokasi: b.lokasi,
      staffId: b.staffId,
      staffNama: b.staffNama,
      kondisi: b.kondisi,
      keterangan: b.keterangan,
      sumber: b.sumber,
      fileName,
      thumb: b.thumb,
      uploadedAt: new Date().toISOString(),
    };

    // Simpan data gambar ke IndexedDB
    await savePhotoBlob(b.id, b.image);

    // Kirim otomatis ke Google Drive bila diaktifkan
    const cfg = clientStore.getConfig();
    if (cfg.driveEnabled && cfg.driveAutoUpload) {
      const driveRes = await directSendDrive('uploadPhoto', {
        fileName,
        folderPath: folderPathFor(b.tanggal),
        mimeType: 'image/jpeg',
        base64: b.image.replace(/^data:image\/[a-z]+;base64,/, ''),
        meta,
      });
      if (driveRes.ok && driveRes.url) {
        meta.driveUrl = driveRes.url;
      }
    }

    all.push(meta);
    clientStore.savePhotos(all);
    return { ok: true, photo: meta } as unknown as T;
  }

  if (op === 'photo' && method === 'DELETE') {
    const id = params.get('id');
    if (id) {
      const all = clientStore.getPhotos().map((p) => (p.id === id ? { ...p, deleted: true } : p));
      clientStore.savePhotos(all);
      await deletePhotoBlob(id);
    }
    return { ok: true } as unknown as T;
  }

  if (op === 'drive-recap' && method === 'POST') {
    const b = body as { month: string; fileName: string; base64: string };
    const res = await directSendDrive('uploadRecap', {
      month: b.month,
      fileName: b.fileName,
      base64: b.base64,
    });
    return { ok: true, result: res } as unknown as T;
  }

  if (op === 'drive-test' && method === 'POST') {
    const res = await directSendDrive('ping', {});
    return res as unknown as T;
  }

  if (op === 'drive' && method === 'POST') {
    const id = params.get('id');
    const all = clientStore.getPhotos();
    const photo = all.find((p) => p.id === id);
    if (!photo) throw new ApiError('Foto tidak ditemukan.', 404);
    const dataUrl = await getPhotoBlob(photo.id);
    if (!dataUrl) throw new ApiError('File foto tidak ditemukan di penyimpanan browser.', 404);
    const res = await directSendDrive('uploadPhoto', {
      fileName: photo.fileName,
      folderPath: folderPathFor(photo.tanggal),
      mimeType: 'image/jpeg',
      base64: dataUrl.replace(/^data:image\/[a-z]+;base64,/, ''),
      meta: photo,
    });
    if (res.ok && res.url) {
      photo.driveUrl = res.url;
      clientStore.savePhotos(all);
    }
    return { ok: true, result: res, photo } as unknown as T;
  }

  if (op === 'config' && method === 'PUT') {
    const nextCfg = body as Config;
    clientStore.saveConfig(nextCfg);
    return { ok: true, config: nextCfg } as unknown as T;
  }

  if (op === 'staff' && method === 'PUT') {
    const nextStaff = (body as { staff: Staff[] }).staff;
    clientStore.saveStaff(nextStaff);
    return { ok: true, staff: nextStaff } as unknown as T;
  }

  if (op === 'schedule' && method === 'PUT') {
    const nextSched = (body as { schedule: Assignment[] }).schedule;
    clientStore.saveSchedule(nextSched);
    return { ok: true, schedule: nextSched } as unknown as T;
  }

  if (op === 'secrets' && method === 'PUT') {
    const s = body as { fonnteToken?: string; driveScriptUrl?: string; driveSecret?: string; supabaseUrl?: string; supabaseKey?: string };
    clientStore.saveSecrets(s);
    const sec = clientStore.getSecrets();
    return {
      ok: true,
      secrets: {
        hasFonnteToken: Boolean(sec.fonnteToken),
        hasDriveScript: Boolean(sec.driveScriptUrl),
        hasDriveSecret: Boolean(sec.driveSecret),
        hasSupabase: Boolean(sec.supabaseUrl && sec.supabaseKey),
        fonnteFromEnv: false,
        driveFromEnv: false,
        supabaseFromEnv: false,
      },
    } as unknown as T;
  }

  if (op === 'supabase-test') {
    const sec = clientStore.getSecrets();
    const res = await testSupabase(fetch, sec.supabaseUrl || '', sec.supabaseKey || '');
    return res as unknown as T;
  }

  if (op === 'supabase-sync') {
    const sec = clientStore.getSecrets();
    const photos = clientStore.getPhotos();
    const mockKv = {
      async get<X>(k: string): Promise<X | null> {
        if (k === 'config') return clientStore.getConfig() as unknown as X;
        if (k === 'staff') return clientStore.getStaff() as unknown as X;
        if (k === 'schedule') return clientStore.getSchedule() as unknown as X;
        if (k.startsWith('meta/')) {
          const id = k.split('/').pop();
          return (photos.find((p) => p.id === id) as unknown as X) ?? null;
        }
        return null;
      },
      async set() {},
      async delete() {},
      async list(p: string) {
        if (p === 'meta/') return photos.map((ph) => `meta/${ph.tanggal}/${ph.id}`);
        return [];
      },
    };
    const res = await syncAllToSupabase({ fetchImpl: fetch, url: sec.supabaseUrl || '', key: sec.supabaseKey || '', kv: mockKv });
    return res as unknown as T;
  }

  if (op === 'supabase-schema') {
    return { ok: true, sql: getSupabaseSchemaSql() } as unknown as T;
  }

  if (op === 'auth') {
    return { ok: true } as unknown as T;
  }

  return { ok: true } as unknown as T;
}

export interface Bootstrap {
  config: Config;
  staff: Staff[];
  schedule: Assignment[];
  secrets: SecretsStatus;
  defaultCredentials: boolean;
  isClientOnlyMode?: boolean;
}

export const api = {
  get isClientMode() {
    return isClientOnlyMode;
  },
  async ping(code: string): Promise<{ authorized: boolean; configured: boolean }> {
    try {
      const res = await fetch(`${activeEndpoint}?op=ping`, { headers: { 'x-access-code': code } });
      if (res.ok) {
        return (await res.json()) as { authorized: boolean; configured: boolean };
      }
    } catch {
      /* abaikan */
    }
    // Fallback: terima kode bawaan
    return { authorized: code.toLowerCase() === 'sdn1rejoso', configured: true };
  },
  bootstrap: () => request<Bootstrap & { ok: true }>('GET', 'op=bootstrap'),
  photosByDate: (date: string) => request<{ photos: PhotoMeta[] }>('GET', `op=photos&date=${date}`),
  photosByMonth: (month: string) => request<{ photos: PhotoMeta[] }>('GET', `op=photos&month=${month}`),
  uploadPhoto: (b: PhotoUploadBody) => request<{ photo: PhotoMeta; duplicate?: boolean }>('POST', 'op=photo', b),
  deletePhoto: (id: string, date: string) => request<unknown>('DELETE', `op=photo&id=${id}&date=${date}`, undefined, true),
  dispatch: (kind: 'drive' | 'wa', id: string, date: string) =>
    request<{ result: DispatchResult; photo: PhotoMeta }>('POST', `op=${kind}&id=${id}&date=${date}`),
  uploadRecap: (month: string, fileName: string, base64: string) =>
    request<{ result: DispatchResult }>('POST', 'op=drive-recap', { month, fileName, base64 }),
  verifyAdmin: (pin: string) => {
    session.pin = pin;
    return request<unknown>('POST', 'op=auth', undefined, true).catch((e) => {
      // Pada client mode, jika PIN adalah 123456, izinkan
      if (isClientOnlyMode && pin === '123456') return { ok: true };
      session.pin = '';
      throw e;
    });
  },
  saveConfig: (c: Config) => request<{ config: Config }>('PUT', 'op=config', c, true),
  saveStaff: (staff: Staff[]) => request<{ staff: Staff[] }>('PUT', 'op=staff', { staff }, true),
  saveSchedule: (schedule: Assignment[]) => request<{ schedule: Assignment[] }>('PUT', 'op=schedule', { schedule }, true),
  saveSecrets: (s: { fonnteToken?: string; driveScriptUrl?: string; driveSecret?: string; supabaseUrl?: string; supabaseKey?: string }) =>
    request<{ secrets: SecretsStatus }>('PUT', 'op=secrets', s, true),
  supabaseTest: () =>
    request<DispatchResult & { tableKvExists?: boolean; tablesReady?: boolean }>('POST', 'op=supabase-test', undefined, true).catch(
      (e: ApiError) => ({ ok: false, message: e.message }) as DispatchResult
    ),
  supabaseSync: () =>
    request<DispatchResult & { stats?: { staffCount: number; scheduleCount: number; photosCount: number } }>('POST', 'op=supabase-sync', undefined, true).catch(
      (e: ApiError) => ({ ok: false, message: e.message }) as DispatchResult
    ),
  getSupabaseSchema: () =>
    request<{ ok: boolean; sql: string }>('GET', 'op=supabase-schema', undefined, false).catch(
      () => ({ ok: true, sql: getSupabaseSchemaSql() })
    ),
  waGroups: () =>
    request<{ groups: WaGroup[]; message: string; ok: boolean }>('GET', 'op=wa-groups', undefined, true).catch(
      (e: ApiError) => ({
        ok: false,
        groups: [] as WaGroup[],
        message: e.message,
      })
    ),
  driveTest: () =>
    request<DispatchResult>('POST', 'op=drive-test', undefined, true).catch(
      (e: ApiError) => ({ ok: false, message: e.message }) as DispatchResult
    ),
  async fetchPhotoBlobUrl(id: string): Promise<string> {
    if (isClientOnlyMode) {
      const dataUrl = await getPhotoBlob(id);
      if (dataUrl) {
        const res = await fetch(dataUrl);
        return URL.createObjectURL(await res.blob());
      }
      throw new ApiError('Foto tidak ditemukan.', 404);
    }
    const res = await fetch(`${activeEndpoint}?op=photo&id=${encodeURIComponent(id)}`, {
      headers: { 'x-access-code': session.code },
    });
    if (!res.ok) throw new ApiError('Foto tidak dapat dimuat.', res.status);
    return URL.createObjectURL(await res.blob());
  },
};

/* ---------------- antrean unggah offline (foto tidak hilang saat sinyal buruk) ---------------- */
export function loadQueue(): PhotoUploadBody[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_QUEUE) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveQueue(q: PhotoUploadBody[]): boolean {
  try {
    localStorage.setItem(LS_QUEUE, JSON.stringify(q));
    return true;
  } catch {
    return false;
  }
}
