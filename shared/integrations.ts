/**
 * Integrasi eksternal sisi-server: WhatsApp (Fonnte) & Google Drive (Google Apps Script milik sekolah).
 * `fetchImpl` disuntikkan agar dapat diuji tanpa jaringan.
 *
 * Mengapa Apps Script untuk Drive? Akun Google sekolah tetap pemilik berkas; aplikasi tidak perlu
 * menyimpan kredensial OAuth/service-account. Skrip dipasang sekali oleh admin (lihat
 * google-apps-script/Code.gs) dan hanya menerima permintaan yang membawa kunci rahasia.
 */
import type { DispatchResult, PhotoMeta, WaGroup } from './types.ts';
import { buildWaMessage, folderPathFor } from './piket.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const FONNTE = 'https://api.fonnte.com';

function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } | null {
  const m = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  return { blob: new Blob([bytes], { type: m[1] }), mime: m[1] };
}

export async function sendWhatsApp(opts: {
  fetchImpl: FetchLike;
  token: string;
  target: string;
  photo: PhotoMeta;
  imageDataUrl: string;
  schoolName: string;
}): Promise<DispatchResult> {
  const { token, target, photo } = opts;
  if (!token) return { ok: false, skipped: true, message: 'Token WhatsApp (Fonnte) belum diisi di Pengaturan.' };
  if (!target) return { ok: false, skipped: true, message: 'Grup WhatsApp tujuan belum dipilih di Pengaturan.' };
  try {
    const form = new FormData();
    form.append('target', target);
    form.append('message', buildWaMessage(photo, opts.schoolName));
    const img = dataUrlToBlob(opts.imageDataUrl);
    if (img) form.append('file', img.blob, photo.fileName);
    const res = await opts.fetchImpl(`${FONNTE}/send`, { method: 'POST', headers: { Authorization: token }, body: form });
    const json = (await res.json().catch(() => null)) as { status?: boolean; reason?: string } | null;
    if (json?.status) return { ok: true, message: 'Terkirim ke grup WhatsApp.' };
    return { ok: false, message: json?.reason || `Gateway WhatsApp menolak permintaan (HTTP ${res.status}).` };
  } catch (err) {
    return { ok: false, message: `Gagal menghubungi gateway WhatsApp: ${(err as Error).message}` };
  }
}

export async function listWaGroups(fetchImpl: FetchLike, token: string): Promise<{ ok: boolean; groups: WaGroup[]; message: string }> {
  if (!token) return { ok: false, groups: [], message: 'Token WhatsApp (Fonnte) belum diisi.' };
  try {
    await fetchImpl(`${FONNTE}/fetch-group`, { method: 'POST', headers: { Authorization: token } }).catch(() => undefined);
    const res = await fetchImpl(`${FONNTE}/get-whatsapp-group`, { method: 'POST', headers: { Authorization: token } });
    const json = (await res.json().catch(() => null)) as { status?: boolean; data?: Array<{ id?: string; name?: string }>; reason?: string } | null;
    const groups = (json?.data || [])
      .filter((g): g is { id: string; name?: string } => !!g && typeof g.id === 'string')
      .map((g) => ({ id: g.id, name: g.name || g.id }));
    if (json?.status && groups.length) return { ok: true, groups, message: `${groups.length} grup ditemukan.` };
    return { ok: false, groups: [], message: json?.reason || 'Tidak ada grup ditemukan. Pastikan nomor WA tersambung di fonnte.com.' };
  } catch (err) {
    return { ok: false, groups: [], message: `Gagal menghubungi gateway WhatsApp: ${(err as Error).message}` };
  }
}

interface DriveReply {
  ok?: boolean;
  error?: string;
  fileUrl?: string;
  folderUrl?: string;
  message?: string;
}

async function callDrive(fetchImpl: FetchLike, url: string, payload: Record<string, unknown>): Promise<DriveReply> {
  // Apps Script web app mengalihkan (302) ke googleusercontent; fetch mengikuti redirect untuk POST → GET hasil.
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as DriveReply;
  } catch {
    return { ok: false, error: 'Balasan Google Apps Script tidak valid. Pastikan skrip di-deploy sebagai Web App (akses: Anyone).' };
  }
}

function validDriveUrl(u: string): boolean {
  return /^https:\/\/script\.google(usercontent)?\.com\//.test(u);
}

export async function uploadPhotoToDrive(opts: {
  fetchImpl: FetchLike;
  scriptUrl: string;
  secret: string;
  photo: PhotoMeta;
  imageDataUrl: string;
  schoolName: string;
}): Promise<DispatchResult> {
  const { scriptUrl, secret, photo } = opts;
  if (!scriptUrl || !secret) return { ok: false, skipped: true, message: 'Google Drive belum dihubungkan (URL skrip & kunci rahasia).' };
  if (!validDriveUrl(scriptUrl)) return { ok: false, message: 'URL Google Apps Script tidak valid (harus diawali https://script.google.com/).' };
  const m = opts.imageDataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!m) return { ok: false, message: 'Data foto tidak valid.' };
  try {
    const r = await callDrive(opts.fetchImpl, scriptUrl, {
      secret,
      action: 'uploadPhoto',
      schoolName: opts.schoolName,
      folderPath: folderPathFor(photo.tanggal),
      fileName: photo.fileName,
      mimeType: m[1],
      base64: m[2],
      meta: {
        id: photo.id,
        tanggal: photo.tanggal,
        waktu: photo.waktu,
        lokasi: photo.lokasi,
        staffNama: photo.staffNama,
        kondisi: photo.kondisi,
        keterangan: photo.keterangan,
        sumber: photo.sumber,
      },
    });
    if (r.ok && r.fileUrl) return { ok: true, message: 'Tersimpan di Google Drive sekolah.', url: r.fileUrl };
    return { ok: false, message: r.error || 'Google Drive menolak permintaan.' };
  } catch (err) {
    return { ok: false, message: `Gagal menghubungi Google Apps Script: ${(err as Error).message}` };
  }
}

export async function uploadRecapToDrive(opts: {
  fetchImpl: FetchLike;
  scriptUrl: string;
  secret: string;
  month: string;
  fileName: string;
  mimeType: string;
  base64: string;
  schoolName: string;
}): Promise<DispatchResult> {
  const { scriptUrl, secret } = opts;
  if (!scriptUrl || !secret) return { ok: false, skipped: true, message: 'Google Drive belum dihubungkan.' };
  if (!validDriveUrl(scriptUrl)) return { ok: false, message: 'URL Google Apps Script tidak valid.' };
  try {
    const [y, mm] = opts.month.split('-');
    const r = await callDrive(opts.fetchImpl, scriptUrl, {
      secret,
      action: 'uploadRecap',
      schoolName: opts.schoolName,
      folderPath: [y, `${mm}`, 'Rekap'],
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      base64: opts.base64,
    });
    if (r.ok && r.fileUrl) return { ok: true, message: 'Rekap tersimpan di Google Drive.', url: r.fileUrl };
    return { ok: false, message: r.error || 'Google Drive menolak permintaan.' };
  } catch (err) {
    return { ok: false, message: `Gagal menghubungi Google Apps Script: ${(err as Error).message}` };
  }
}

export async function testDrive(fetchImpl: FetchLike, scriptUrl: string, secret: string, schoolName: string): Promise<DispatchResult> {
  if (!scriptUrl || !secret) return { ok: false, skipped: true, message: 'Isi URL skrip dan kunci rahasia terlebih dahulu.' };
  if (!validDriveUrl(scriptUrl)) return { ok: false, message: 'URL Google Apps Script tidak valid (harus diawali https://script.google.com/).' };
  try {
    const r = await callDrive(fetchImpl, scriptUrl, { secret, action: 'ping', schoolName });
    if (r.ok) return { ok: true, message: r.message || 'Terhubung ke Google Drive sekolah.', url: r.folderUrl };
    return { ok: false, message: r.error || 'Kunci rahasia salah atau skrip belum di-deploy.' };
  } catch (err) {
    return { ok: false, message: `Gagal menghubungi Google Apps Script: ${(err as Error).message}` };
  }
}

