import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle,
  Copy,
  Database,
  ExternalLink,
  HardDrive,
  ImageIcon,
  ImagePlus,
  KeyRound,
  MessageSquare,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  School,
  Sparkles,
  Trash2,
  Upload,
  User,
  Users,
} from 'lucide-react';
import type { Config, Staff, WaGroup } from '../../shared/types.ts';
import { DAY_NAMES } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import type { AppCtx } from '../lib/ctx.ts';
import { compressAvatar, validateImageFile } from '../lib/image.ts';
import { Avatar, Chip, Modal, btn, card, input } from './ui.tsx';

const GAS_CODE_SNIPPET = `/**
 * Google Apps Script - Penyimpanan Foto Piket Gerbang ke Google Drive Sekolah
 * Tempel kode ini di https://script.google.com > Deploy sebagai Web App ("Anyone")
 */
const SECRET = "GANTI_DENGAN_KUNCI_RAHASIA_ANDA";
const ROOT_FOLDER_ID = ""; // Opsional: ID folder Drive sekolah

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!SECRET || SECRET.indexOf("GANTI_") === 0) return out_({ ok: false, error: "SECRET di skrip belum diganti." });
    if (String(req.secret || "") !== SECRET) return out_({ ok: false, error: "Kunci rahasia salah." });

    const root = rootFolder_(String(req.schoolName || "Sekolah"));
    switch (req.action) {
      case "ping":
        return out_({ ok: true, message: "Terhubung ke Google Drive sekolah.", folderUrl: root.getUrl() });
      case "uploadPhoto":
        return out_(uploadPhoto_(root, req));
      case "uploadRecap":
        return out_(uploadRecap_(root, req));
      default:
        return out_({ ok: false, error: "Aksi tidak dikenal." });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return out_({ ok: true, app: "piket-gerbang-drive", message: "Skrip aktif." });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function rootFolder_(schoolName) {
  if (ROOT_FOLDER_ID) return DriveApp.getFolderById(ROOT_FOLDER_ID);
  const name = "Piket Gerbang - " + schoolName;
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function ensurePath_(root, parts) {
  var cur = root;
  (parts || []).forEach(function (p) {
    const name = String(p).replace(/[\\\\/:*?"<>|]/g, "-").slice(0, 80);
    const it = cur.getFoldersByName(name);
    cur = it.hasNext() ? it.next() : cur.createFolder(name);
  });
  return cur;
}

function uploadPhoto_(root, req) {
  const folder = ensurePath_(root, req.folderPath);
  const name = String(req.fileName || "foto.jpg");
  const existing = folder.getFilesByName(name);
  let file;
  if (existing.hasNext()) {
    file = existing.next();
  } else {
    const bytes = Utilities.base64Decode(String(req.base64 || ""));
    file = folder.createFile(Utilities.newBlob(bytes, String(req.mimeType || "image/jpeg"), name));
  }
  return { ok: true, fileUrl: file.getUrl(), folderUrl: folder.getUrl() };
}

function uploadRecap_(root, req) {
  const folder = ensurePath_(root, [req.month.slice(0, 4), req.month.slice(5, 7), "Rekap"]);
  const bytes = Utilities.base64Decode(String(req.base64 || ""));
  const file = folder.createFile(Utilities.newBlob(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", String(req.fileName || "rekap.xlsx")));
  return { ok: true, fileUrl: file.getUrl(), folderUrl: folder.getUrl() };
}`;

export const SettingsView: React.FC<{ ctx: AppCtx }> = ({ ctx }) => {
  const { secrets } = ctx;
  const [cfg, setCfg] = useState<Config>({ ...ctx.config });
  const [staffList, setStaffList] = useState<Staff[]>([...ctx.staff]);
  const [activeTab, setActiveTab] = useState<'general' | 'branding' | 'staff' | 'supabase' | 'drive' | 'wa'>('general');

  // Rahasia (hanya diisi saat ingin diubah)
  const [secretDriveUrl, setSecretDriveUrl] = useState('');
  const [secretDriveKey, setSecretDriveKey] = useState('');
  const [secretFonnteToken, setSecretFonnteToken] = useState('');
  const [secretSupabaseUrl, setSecretSupabaseUrl] = useState('');
  const [secretSupabaseKey, setSecretSupabaseKey] = useState('');

  // Status uji koneksi & sinkronisasi
  const [testingDrive, setTestingDrive] = useState(false);
  const [driveTestResult, setDriveTestResult] = useState<{ ok: boolean; message: string; url?: string } | null>(null);

  const [testingSupabase, setTestingSupabase] = useState(false);
  const [supabaseTestResult, setSupabaseTestResult] = useState<{ ok: boolean; message: string; tablesReady?: boolean; url?: string } | null>(null);
  const [syncingSupabase, setSyncingSupabase] = useState(false);
  const [showSupabaseSqlModal, setShowSupabaseSqlModal] = useState(false);
  const [supabaseSqlSnippet, setSupabaseSqlSnippet] = useState('');

  // Daftar grup WA Fonnte
  const [fetchingWaGroups, setFetchingWaGroups] = useState(false);
  const [waGroups, setWaGroups] = useState<WaGroup[]>([]);
  const [showGasModal, setShowGasModal] = useState(false);

  // Staf baru
  const [newStaffNama, setNewStaffNama] = useState('');
  const [newStaffJabatan, setNewStaffJabatan] = useState('');
  const [newStaffFoto, setNewStaffFoto] = useState('');

  // Refs untuk upload file
  const logoSekolahInputRef = useRef<HTMLInputElement>(null);
  const logoVisiInputRef = useRef<HTMLInputElement>(null);
  const teacherPhotoInputRef = useRef<HTMLInputElement>(null);
  const [activeTeacherIdForPhoto, setActiveTeacherIdForPhoto] = useState<string | null>(null);

  // Simpan Konfigurasi Umum & Branding
  const saveConfigOnly = async () => {
    if (!(await ctx.requireAdmin())) return;
    try {
      await api.saveConfig(cfg);
      ctx.notify('ok', 'Pengaturan berhasil disimpan.');
      await ctx.reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal menyimpan pengaturan.';
      ctx.notify('err', msg);
    }
  };

  // Upload Logo Sekolah
  const handleUploadLogoSekolah = async (file: File | undefined) => {
    if (!file) return;
    const err = validateImageFile(file);
    if (err) return ctx.notify('err', err);
    try {
      const dataUrl = await compressAvatar(file, 260, 0.9);
      setCfg((prev) => ({ ...prev, logoSekolahUrl: dataUrl }));
      ctx.notify('ok', 'Logo sekolah berhasil dimuat. Klik "Simpan Logo & Branding" untuk menerapkan.');
    } catch {
      ctx.notify('err', 'Gagal memproses gambar logo sekolah.');
    }
  };

  // Upload Logo Visi Sekolah
  const handleUploadLogoVisi = async (file: File | undefined) => {
    if (!file) return;
    const err = validateImageFile(file);
    if (err) return ctx.notify('err', err);
    try {
      const dataUrl = await compressAvatar(file, 260, 0.9);
      setCfg((prev) => ({ ...prev, logoVisiUrl: dataUrl }));
      ctx.notify('ok', 'Logo visi sekolah berhasil dimuat. Klik "Simpan Logo & Branding" untuk menerapkan.');
    } catch {
      ctx.notify('err', 'Gagal memproses gambar logo visi.');
    }
  };

  // Upload Foto Profil Guru
  const triggerTeacherPhotoUpload = (teacherId: string) => {
    setActiveTeacherIdForPhoto(teacherId);
    teacherPhotoInputRef.current?.click();
  };

  const handleTeacherPhotoPicked = async (file: File | undefined) => {
    if (!file || !activeTeacherIdForPhoto) return;
    const err = validateImageFile(file);
    if (err) return ctx.notify('err', err);
    try {
      const dataUrl = await compressAvatar(file, 240, 0.85);
      setStaffList((prev) =>
        prev.map((s) => (s.id === activeTeacherIdForPhoto ? { ...s, fotoUrl: dataUrl } : s))
      );
      const targetTeacher = staffList.find((s) => s.id === activeTeacherIdForPhoto);
      ctx.notify('ok', `Foto profil ${targetTeacher?.nama || 'guru'} berhasil dipilih. Klik 'Simpan Daftar Guru'.`);
    } catch {
      ctx.notify('err', 'Gagal memproses foto profil guru.');
    } finally {
      setActiveTeacherIdForPhoto(null);
      if (teacherPhotoInputRef.current) teacherPhotoInputRef.current.value = '';
    }
  };

  const removeTeacherPhoto = (teacherId: string) => {
    setStaffList((prev) =>
      prev.map((s) => (s.id === teacherId ? { ...s, fotoUrl: undefined } : s))
    );
    ctx.notify('info', 'Foto profil dihapus. Klik "Simpan Daftar Guru" untuk menyimpan.');
  };

  // Simpan Integrasi Google Drive
  const saveDriveSettings = async () => {
    if (!(await ctx.requireAdmin())) return;
    try {
      await api.saveConfig(cfg);
      if (secretDriveUrl || secretDriveKey) {
        await api.saveSecrets({
          driveScriptUrl: secretDriveUrl || undefined,
          driveSecret: secretDriveKey || undefined,
        });
        setSecretDriveUrl('');
        setSecretDriveKey('');
      }
      ctx.notify('ok', 'Pengaturan Google Drive berhasil disimpan.');
      await ctx.reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal menyimpan pengaturan Drive.';
      ctx.notify('err', msg);
    }
  };

  // Uji Koneksi Google Drive
  const testDriveConnection = async () => {
    setTestingDrive(true);
    setDriveTestResult(null);
    try {
      const res = await api.driveTest();
      setDriveTestResult({ ok: res.ok, message: res.message, url: res.url });
      if (res.ok) {
        ctx.notify('ok', 'Google Drive sekolah terhubung dengan baik!');
      } else {
        ctx.notify('err', res.message || 'Gagal terhubung ke Google Drive.');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal menguji koneksi.';
      setDriveTestResult({ ok: false, message: msg });
      ctx.notify('err', msg);
    } finally {
      setTestingDrive(false);
    }
  };

  // Simpan Pengaturan Supabase
  const saveSupabaseSettings = async () => {
    if (!(await ctx.requireAdmin())) return;
    try {
      await api.saveConfig(cfg);
      if (secretSupabaseUrl || secretSupabaseKey) {
        await api.saveSecrets({
          supabaseUrl: secretSupabaseUrl || undefined,
          supabaseKey: secretSupabaseKey || undefined,
        });
        setSecretSupabaseUrl('');
        setSecretSupabaseKey('');
      }
      ctx.notify('ok', 'Pengaturan Supabase berhasil disimpan.');
      await ctx.reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal menyimpan pengaturan Supabase.';
      ctx.notify('err', msg);
    }
  };

  // Uji Koneksi Supabase
  const testSupabaseConnection = async () => {
    setTestingSupabase(true);
    setSupabaseTestResult(null);
    try {
      const res = await api.supabaseTest();
      setSupabaseTestResult({
        ok: res.ok,
        message: res.message,
        tablesReady: (res as unknown as { tablesReady?: boolean }).tablesReady,
        url: res.url,
      });
      if (res.ok) {
        ctx.notify('ok', 'Supabase berhasil terhubung!');
      } else {
        ctx.notify('err', res.message || 'Gagal terhubung ke Supabase.');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal menguji koneksi Supabase.';
      setSupabaseTestResult({ ok: false, message: msg });
      ctx.notify('err', msg);
    } finally {
      setTestingSupabase(false);
    }
  };

  // Sinkronkan Semua Data Lokal ke Supabase Sekarang
  const syncToSupabaseNow = async () => {
    if (!(await ctx.requireAdmin())) return;
    setSyncingSupabase(true);
    try {
      const res = await api.supabaseSync();
      if (res.ok) {
        ctx.notify('ok', res.message || 'Semua data berhasil disinkronkan ke Supabase!');
      } else {
        ctx.notify('err', res.message || 'Gagal menyinkronkan data ke Supabase.');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal sinkronisasi.';
      ctx.notify('err', msg);
    } finally {
      setSyncingSupabase(false);
    }
  };

  // Buka Modal Skrip SQL Supabase
  const openSupabaseSqlModal = async () => {
    try {
      const res = await api.getSupabaseSchema();
      setSupabaseSqlSnippet(res.sql);
    } catch {
      /* abaikan */
    }
    setShowSupabaseSqlModal(true);
  };

  // Simpan Integrasi WhatsApp
  const saveWaSettings = async () => {
    if (!(await ctx.requireAdmin())) return;
    try {
      await api.saveConfig(cfg);
      if (secretFonnteToken) {
        await api.saveSecrets({ fonnteToken: secretFonnteToken });
        setSecretFonnteToken('');
      }
      ctx.notify('ok', 'Pengaturan WhatsApp Fonnte berhasil disimpan.');
      await ctx.reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal menyimpan pengaturan WhatsApp.';
      ctx.notify('err', msg);
    }
  };

  // Tarik Daftar Grup WA dari Fonnte
  const fetchWaGroupList = async () => {
    if (!secrets.hasFonnteToken && !secretFonnteToken) {
      return ctx.notify('err', 'Token Fonnte belum tersimpan.');
    }
    setFetchingWaGroups(true);
    try {
      const res = await api.waGroups();
      if (res.ok && res.groups) {
        setWaGroups(res.groups);
        ctx.notify('ok', `Ditemukan ${res.groups.length} grup WhatsApp dari Fonnte.`);
      } else {
        ctx.notify('err', res.message || 'Tidak ada grup ditemukan.');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal mengambil daftar grup.';
      ctx.notify('err', msg);
    } finally {
      setFetchingWaGroups(false);
    }
  };

  // Simpan Staf Guru
  const saveStaffOnly = async () => {
    if (!(await ctx.requireAdmin())) return;
    try {
      await api.saveStaff(staffList);
      ctx.notify('ok', `Daftar guru (${staffList.length} orang) berhasil disimpan.`);
      await ctx.reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal menyimpan daftar staf.';
      ctx.notify('err', msg);
    }
  };

  const addStaffItem = () => {
    if (!newStaffNama.trim()) return ctx.notify('err', 'Nama guru tidak boleh kosong.');
    const id = `staff-${Date.now()}`;
    setStaffList([
      ...staffList,
      {
        id,
        nama: newStaffNama.trim(),
        jabatan: newStaffJabatan.trim() || 'Guru',
        fotoUrl: newStaffFoto || undefined,
      },
    ]);
    setNewStaffNama('');
    setNewStaffJabatan('');
    setNewStaffFoto('');
  };

  const removeStaffItem = (id: string) => {
    if (staffList.length <= 1) return ctx.notify('err', 'Minimal harus ada 1 guru terdaftar.');
    setStaffList(staffList.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Alert Default Credentials */}
      {ctx.defaultCredentials && (
        <div className="bg-amber-50/90 backdrop-blur-md border border-amber-200 text-amber-900 rounded-2xl p-4 flex items-start gap-3 text-xs shadow-xs">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold">Keamanan: Kredensial Bawaan Masih Aktif</div>
            <div>
              Aplikasi ini masih menggunakan kode akses bawaan (<code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono font-bold">sdn1rejoso</code>) dan PIN Admin (<code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono font-bold">123456</code>). Anda dapat menyesuaikannya melalui file environment atau menu Pengaturan.
            </div>
          </div>
        </div>
      )}

      {/* Navigasi Tab Pengaturan Modern */}
      <div className="flex border-b border-slate-200/90 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-black border-b-2 cursor-pointer transition whitespace-nowrap ${activeTab === 'general'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
        >
          <School className="w-4 h-4" />
          Umum & Jam Piket
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('branding')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-black border-b-2 cursor-pointer transition whitespace-nowrap ${activeTab === 'branding'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
        >
          <Palette className="w-4 h-4" />
          Logo & Branding Sekolah
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('staff')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-black border-b-2 cursor-pointer transition whitespace-nowrap ${activeTab === 'staff'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
        >
          <Users className="w-4 h-4" />
          Daftar Guru & Foto Profil ({staffList.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('supabase')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-black border-b-2 cursor-pointer transition whitespace-nowrap ${activeTab === 'supabase'
              ? 'border-emerald-600 text-emerald-700 bg-emerald-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
        >
          <Database className="w-4 h-4" />
          Database Supabase
          {secrets.hasSupabase && <Chip tone="ok">Aktif</Chip>}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('drive')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-black border-b-2 cursor-pointer transition whitespace-nowrap ${activeTab === 'drive'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
        >
          <HardDrive className="w-4 h-4" />
          Google Drive Sekolah
          {secrets.hasDriveScript && <Chip tone="ok">Aktif</Chip>}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('wa')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-black border-b-2 cursor-pointer transition whitespace-nowrap ${activeTab === 'wa'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
        >
          <MessageSquare className="w-4 h-4" />
          WhatsApp Fonnte
          {secrets.hasFonnteToken && <Chip tone="ok">Aktif</Chip>}
        </button>
      </div>

      {/* TAB 1: PENGATURAN UMUM */}
      {activeTab === 'general' && (
        <div className={`${card} p-6 space-y-6`}>
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <School className="w-5 h-5 text-blue-600" />
              Identitas Sekolah & Jam Operasional Piket
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Konfigurasi nama sekolah, batas waktu piket pagi, dan koordinator pelaksana.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Nama Sekolah</label>
              <input
                type="text"
                value={cfg.schoolName}
                onChange={(e) => setCfg({ ...cfg, schoolName: e.target.value })}
                className={input}
                placeholder="SD NEGERI 1 REJOSO"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Sub Judul / Aplikasi</label>
              <input
                type="text"
                value={cfg.schoolSub}
                onChange={(e) => setCfg({ ...cfg, schoolSub: e.target.value })}
                className={input}
                placeholder="Piket Gerbang Guru 5S"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Jam Mulai Piket (WIB)</label>
              <input
                type="time"
                value={cfg.jamMulai}
                onChange={(e) => setCfg({ ...cfg, jamMulai: e.target.value })}
                className={input}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Jam Selesai Piket (WIB)</label>
              <input
                type="time"
                value={cfg.jamSelesai}
                onChange={(e) => setCfg({ ...cfg, jamSelesai: e.target.value })}
                className={input}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">Koordinator Piket Gerbang</label>
              <select
                value={cfg.coordinatorStaffId}
                onChange={(e) => setCfg({ ...cfg, coordinatorStaffId: e.target.value })}
                className={input}
              >
                <option value="">-- Pilih Guru / Penanggung Jawab --</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nama} ({s.jabatan})
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">Hari Kerja Piket</label>
              <div className="flex flex-wrap gap-2 pt-1">
                {DAY_NAMES.filter((d) => d !== 'Minggu').map((d) => {
                  const active = cfg.hariKerja.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        const next = active ? cfg.hariKerja.filter((x) => x !== d) : [...cfg.hariKerja, d];
                        setCfg({ ...cfg, hariKerja: next });
                      }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition cursor-pointer ${active
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white/80 border-slate-200 text-slate-500 hover:text-slate-800'
                        }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button type="button" onClick={saveConfigOnly} className={btn.primary}>
              <Save className="w-3.5 h-3.5" />
              Simpan Pengaturan Umum
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: LOGO & BRANDING SEKOLAH (FITUR BARU) */}
      {activeTab === 'branding' && (
        <div className={`${card} p-6 space-y-6`}>
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <Palette className="w-5 h-5 text-indigo-600" />
              Upload Logo Sekolah & Logo Visi Sekolah
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Logo akan otomatis muncul pada Header Aplikasi, Lembar Rekap Resmi Cetak Dinas, dan Kartu Stempel Foto Dokumentasi Piket.
            </p>
          </div>

          {/* Hidden inputs untuk upload file logo */}
          <input
            ref={logoSekolahInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleUploadLogoSekolah(e.target.files?.[0])}
          />
          <input
            ref={logoVisiInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleUploadLogoVisi(e.target.files?.[0])}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* KARTU 1: LOGO SEKOLAH */}
            <div className="rounded-2xl border border-slate-200/90 bg-white/70 p-5 space-y-4 flex flex-col items-center text-center shadow-xs">
              <div className="flex items-center justify-between w-full border-b border-slate-100 pb-2">
                <span className="text-xs font-black text-slate-800 uppercase tracking-wide">Logo Utama Sekolah</span>
                <span className="text-[10px] text-slate-400">PNG / JPG / SVG</span>
              </div>

              {/* Preview Box */}
              <div className="w-32 h-32 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/80 flex items-center justify-center p-2 relative overflow-hidden group">
                {cfg.logoSekolahUrl ? (
                  <img
                    src={cfg.logoSekolahUrl}
                    alt="Pratinjau Logo Sekolah"
                    className="w-full h-full object-contain drop-shadow-sm transition group-hover:scale-105"
                  />
                ) : (
                  <div className="text-center text-slate-400 text-xs">
                    <ImageIcon className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                    Belum ada logo
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 pt-1 w-full">
                <button
                  type="button"
                  onClick={() => logoSekolahInputRef.current?.click()}
                  className={`${btn.primary} text-xs py-1.5`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Unggah Logo Baru
                </button>

                <button
                  type="button"
                  onClick={() => setCfg({ ...cfg, logoSekolahUrl: '/logo-sekolah.png' })}
                  className={`${btn.ghost} text-xs py-1.5`}
                  title="Gunakan logo bawaan SDN 1 Rejoso"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Bawaan
                </button>

                {cfg.logoSekolahUrl && (
                  <button
                    type="button"
                    onClick={() => setCfg({ ...cfg, logoSekolahUrl: '' })}
                    className={`${btn.danger} text-xs py-1.5`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Hapus
                  </button>
                )}
              </div>
            </div>

            {/* KARTU 2: LOGO VISI SEKOLAH */}
            <div className="rounded-2xl border border-slate-200/90 bg-white/70 p-5 space-y-4 flex flex-col items-center text-center shadow-xs">
              <div className="flex items-center justify-between w-full border-b border-slate-100 pb-2">
                <span className="text-xs font-black text-slate-800 uppercase tracking-wide">Logo Visi / Branding Sekolah</span>
                <span className="text-[10px] text-slate-400">PNG / JPG / SVG</span>
              </div>

              {/* Preview Box */}
              <div className="w-32 h-32 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/80 flex items-center justify-center p-2 relative overflow-hidden group">
                {cfg.logoVisiUrl ? (
                  <img
                    src={cfg.logoVisiUrl}
                    alt="Pratinjau Logo Visi"
                    className="w-full h-full object-contain drop-shadow-sm transition group-hover:scale-105"
                  />
                ) : (
                  <div className="text-center text-slate-400 text-xs">
                    <Sparkles className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                    Belum ada logo visi
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 pt-1 w-full">
                <button
                  type="button"
                  onClick={() => logoVisiInputRef.current?.click()}
                  className={`${btn.green} text-xs py-1.5`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Unggah Logo Visi
                </button>

                <button
                  type="button"
                  onClick={() => setCfg({ ...cfg, logoVisiUrl: '/logo-visi.png' })}
                  className={`${btn.ghost} text-xs py-1.5`}
                  title="Gunakan logo visi bawaan"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Bawaan
                </button>

                {cfg.logoVisiUrl && (
                  <button
                    type="button"
                    onClick={() => setCfg({ ...cfg, logoVisiUrl: '' })}
                    className={`${btn.danger} text-xs py-1.5`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Hapus
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button type="button" onClick={saveConfigOnly} className={btn.primary}>
              <Save className="w-3.5 h-3.5" />
              Simpan Logo & Branding
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: DAFTAR GURU & FOTO PROFIL GURU (FITUR BARU) */}
      {activeTab === 'staff' && (
        <div className={`${card} p-6 space-y-6`}>
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              Daftar Guru & Kelola Foto Profil Guru
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Setiap guru dapat memiliki foto profil tersendiri yang akan muncul di Kartu Jadwal, Portal Hari Ini, Galeri, dan Rekap.
            </p>
          </div>

          {/* Hidden input untuk ganti foto guru */}
          <input
            ref={teacherPhotoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleTeacherPhotoPicked(e.target.files?.[0])}
          />

          {/* Form Tambah Guru Baru */}
          <div className="bg-slate-50/90 p-4 rounded-2xl border border-slate-200/90 flex flex-col sm:flex-row items-center gap-3">
            <Avatar name={newStaffNama || 'Guru'} fotoUrl={newStaffFoto} size="lg" />
            <input
              type="text"
              value={newStaffNama}
              onChange={(e) => setNewStaffNama(e.target.value)}
              placeholder="Nama Lengkap Guru beserta Gelar"
              className={`${input} flex-1`}
            />
            <input
              type="text"
              value={newStaffJabatan}
              onChange={(e) => setNewStaffJabatan(e.target.value)}
              placeholder="Jabatan (Guru Kelas 1, PAI, dsb)"
              className={`${input} sm:w-60`}
            />
            <button type="button" onClick={addStaffItem} className={`${btn.green} whitespace-nowrap`}>
              <Plus className="w-3.5 h-3.5" />
              Tambah Guru
            </button>
          </div>

          {/* Tabel Staf & Foto Profil */}
          <div className="overflow-x-auto border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50/90 border-b border-slate-200 text-slate-600 font-black uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-3 w-10 text-center">No</th>
                  <th className="py-3 px-3 w-16 text-center">Foto</th>
                  <th className="py-3 px-4">Nama Lengkap Guru</th>
                  <th className="py-3 px-4">Jabatan / Tugas</th>
                  <th className="py-3 px-4 text-center w-40">Ubah Foto Profil</th>
                  <th className="py-3 px-3 w-16 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {staffList.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-2.5 px-3 text-center text-slate-400 font-bold">{idx + 1}</td>
                    <td className="py-2.5 px-3 text-center">
                      <Avatar name={s.nama} fotoUrl={s.fotoUrl} size="md" className="mx-auto" />
                    </td>
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        value={s.nama}
                        onChange={(e) => {
                          const val = e.target.value;
                          setStaffList((prev) => prev.map((item) => (item.id === s.id ? { ...item, nama: val } : item)));
                        }}
                        className="w-full px-2 py-1 font-bold text-slate-800 bg-transparent hover:bg-slate-100 focus:bg-white rounded-lg border border-transparent focus:border-blue-500 outline-none transition"
                      />
                    </td>
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        value={s.jabatan}
                        onChange={(e) => {
                          const val = e.target.value;
                          setStaffList((prev) => prev.map((item) => (item.id === s.id ? { ...item, jabatan: val } : item)));
                        }}
                        className="w-full px-2 py-1 text-slate-600 bg-transparent hover:bg-slate-100 focus:bg-white rounded-lg border border-transparent focus:border-blue-500 outline-none transition"
                      />
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => triggerTeacherPhotoUpload(s.id)}
                          className={`${btn.ghost} py-1 px-2.5 text-[11px]`}
                          title="Unggah atau ganti foto profil guru"
                        >
                          <Camera className="w-3.5 h-3.5 text-blue-600" />
                          <span>{s.fotoUrl ? 'Ganti Foto' : 'Unggah Foto'}</span>
                        </button>
                        {s.fotoUrl && (
                          <button
                            type="button"
                            onClick={() => removeTeacherPhoto(s.id)}
                            className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 transition"
                            title="Hapus foto profil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => removeStaffItem(s.id)}
                        className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                        title="Hapus Guru dari Daftar"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button type="button" onClick={saveStaffOnly} className={btn.primary}>
              <Save className="w-3.5 h-3.5" />
              Simpan Daftar Guru & Foto Profil
            </button>
          </div>
        </div>
      )}

      {/* TAB: DATABASE SUPABASE */}
      {activeTab === 'supabase' && (
        <div className={`${card} p-6 space-y-6`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-600" />
                Integrasi Database Cloud Supabase (PostgreSQL)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Simpan konfigurasi, daftar guru, jadwal piket, dan foto dokumentasi langsung ke database PostgreSQL Supabase yang aman dan dapat diakses dari mana saja.
              </p>
            </div>

            <button
              type="button"
              onClick={openSupabaseSqlModal}
              className={`${btn.ghost} text-xs py-1.5 border border-emerald-200 text-emerald-800 bg-emerald-50/60 hover:bg-emerald-100/80`}
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              Panduan & Skrip SQL Supabase
            </button>
          </div>

          {/* Status Box */}
          <div className="p-4 rounded-2xl bg-slate-50/90 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Status Database Supabase:</span>
              {secrets.hasSupabase ? (
                <Chip tone="ok">Terkonfigurasi ✓</Chip>
              ) : (
                <Chip tone="bad">Belum Diatur</Chip>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={testSupabaseConnection}
                disabled={testingSupabase || (!secrets.hasSupabase && (!secretSupabaseUrl || !secretSupabaseKey))}
                className={`${btn.primary} bg-slate-800 hover:bg-slate-900 text-xs py-1.5`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingSupabase ? 'animate-spin' : ''}`} />
                {testingSupabase ? 'Menguji Koneksi...' : 'Uji Koneksi Supabase'}
              </button>

              <button
                type="button"
                onClick={syncToSupabaseNow}
                disabled={syncingSupabase || !secrets.hasSupabase}
                className={`${btn.ghost} text-xs py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-700`}
                title="Unggah semua data guru, jadwal, dan arsip foto saat ini ke Supabase"
              >
                <Upload className={`w-3.5 h-3.5 ${syncingSupabase ? 'animate-spin' : ''}`} />
                {syncingSupabase ? 'Menyinkronkan...' : 'Sinkronkan Semua Data ke Supabase'}
              </button>

              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className={`${btn.ghost} text-xs py-1.5 inline-flex items-center gap-1.5 text-emerald-700`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Buka Dasbor Supabase
              </a>
            </div>

            {supabaseTestResult && (
              <div
                className={`p-3 rounded-xl text-xs font-bold ${supabaseTestResult.ok ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'
                  }`}
              >
                {supabaseTestResult.ok ? '✓ ' : '✕ '} {supabaseTestResult.message}
                {supabaseTestResult.tablesReady === false && (
                  <div className="mt-1 font-normal">
                    <button
                      type="button"
                      onClick={openSupabaseSqlModal}
                      className="underline font-bold text-emerald-950 cursor-pointer"
                    >
                      Klik di sini untuk melihat skrip pembuatan tabel SQL Supabase.
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Form Konfigurasi Supabase */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Project URL Supabase
              </label>
              <input
                type="url"
                value={secretSupabaseUrl}
                onChange={(e) => setSecretSupabaseUrl(e.target.value)}
                placeholder={
                  secrets.hasSupabase
                    ? '•••••• (Sudah tersimpan, isi hanya jika ingin mengganti)'
                    : 'https://xxxxxxxxxxxxxxxxxxxx.supabase.co'
                }
                className={input}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Ditemukan di Supabase Dashboard &gt; Project Settings &gt; Configuration &gt; Data API &gt; Project URL.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                API Key Supabase (anon / service_role)
              </label>
              <input
                type="password"
                value={secretSupabaseKey}
                onChange={(e) => setSecretSupabaseKey(e.target.value)}
                placeholder={
                  secrets.hasSupabase
                    ? '•••••• (Sudah tersimpan, isi hanya jika ingin mengganti)'
                    : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                }
                className={input}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Ditemukan di Supabase Dashboard &gt; Project Settings &gt; API &gt; Project API keys (anon public atau service_role).
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="supabaseEnabled"
                  checked={cfg.supabaseEnabled}
                  onChange={(e) => setCfg({ ...cfg, supabaseEnabled: e.target.checked })}
                  className="w-4 h-4 text-emerald-600 rounded cursor-pointer"
                />
                <label htmlFor="supabaseEnabled" className="text-xs font-bold text-slate-700 cursor-pointer">
                  Aktifkan penyimpanan database Supabase (PostgreSQL)
                </label>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="supabaseAutoSync"
                  checked={cfg.supabaseAutoSync}
                  onChange={(e) => setCfg({ ...cfg, supabaseAutoSync: e.target.checked })}
                  className="w-4 h-4 text-emerald-600 rounded cursor-pointer"
                />
                <label htmlFor="supabaseAutoSync" className="text-xs font-bold text-slate-700 cursor-pointer">
                  Otomatis simpan setiap foto dokumentasi dan perubahan data ke Supabase
                </label>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button type="button" onClick={saveSupabaseSettings} className={`${btn.primary} bg-emerald-700 hover:bg-emerald-800`}>
              <Save className="w-3.5 h-3.5" />
              Simpan Pengaturan Supabase
            </button>
          </div>
        </div>
      )}

      {/* TAB 4: GOOGLE DRIVE SEKOLAH */}
      {activeTab === 'drive' && (
        <div className={`${card} p-6 space-y-6`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-emerald-600" />
                Integrasi Penyimpanan Google Drive Sekolah
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Setiap foto piket dan laporan rekap bulanan otomatis tersimpan rapi per tahun/bulan/hari di Google Drive sekolah.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowGasModal(true)}
              className={`${btn.ghost} text-xs py-1.5 border border-slate-200`}
            >
              Panduan Pasang Skrip Drive
            </button>
          </div>

          {/* Status Box */}
          <div className="p-4 rounded-2xl bg-slate-50/90 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Status Google Apps Script:</span>
              {secrets.hasDriveScript ? (
                <Chip tone="ok">Terkonfigurasi ✓</Chip>
              ) : (
                <Chip tone="bad">Belum Diatur</Chip>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={testDriveConnection}
                disabled={testingDrive || !secrets.hasDriveScript}
                className={`${btn.primary} bg-slate-800 hover:bg-slate-900 text-xs py-1.5`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingDrive ? 'animate-spin' : ''}`} />
                {testingDrive ? 'Menguji...' : 'Uji Koneksi Google Drive'}
              </button>

              {cfg.driveFolderUrl && (
                <a
                  href={cfg.driveFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`${btn.ghost} text-xs py-1.5 inline-flex items-center gap-1.5 text-blue-700`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka Folder Google Drive Sekolah
                </a>
              )}
            </div>

            {driveTestResult && (
              <div
                className={`p-3 rounded-xl text-xs font-bold ${driveTestResult.ok ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'
                  }`}
              >
                {driveTestResult.ok ? '✓ ' : '✕ '} {driveTestResult.message}
                {driveTestResult.url && (
                  <div className="mt-1 font-normal underline">
                    <a href={driveTestResult.url} target="_blank" rel="noreferrer">
                      Buka Folder Drive Baru
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Form Konfigurasi Drive */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                URL Web App Google Apps Script
              </label>
              <input
                type="url"
                value={secretDriveUrl}
                onChange={(e) => setSecretDriveUrl(e.target.value)}
                placeholder={secrets.hasDriveScript ? '•••••• (Sudah tersimpan, isi hanya jika ingin mengganti)' : 'https://script.google.com/macros/s/.../exec'}
                className={input}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Diperoleh dari menu Deployment baru &gt; Aplikasi Web pada proyek Google Apps Script akun sekolah.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Kunci Rahasia (SECRET) Google Apps Script
              </label>
              <input
                type="password"
                value={secretDriveKey}
                onChange={(e) => setSecretDriveKey(e.target.value)}
                placeholder={secrets.hasDriveSecret ? '•••••• (Sudah tersimpan, isi hanya jika ingin mengganti)' : 'Kunci rahasia minimal 12 karakter'}
                className={input}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Tautan Tampilan Folder Google Drive (Opsional)
              </label>
              <input
                type="url"
                value={cfg.driveFolderUrl}
                onChange={(e) => setCfg({ ...cfg, driveFolderUrl: e.target.value })}
                placeholder="https://drive.google.com/drive/folders/..."
                className={input}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <input
                type="checkbox"
                id="driveAutoUpload"
                checked={cfg.driveAutoUpload}
                onChange={(e) => setCfg({ ...cfg, driveAutoUpload: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded cursor-pointer"
              />
              <label htmlFor="driveAutoUpload" className="text-xs font-bold text-slate-700 cursor-pointer">
                Otomatis kirim setiap foto piket baru ke Google Drive sekolah
              </label>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button type="button" onClick={saveDriveSettings} className={btn.primary}>
              <Save className="w-3.5 h-3.5" />
              Simpan Pengaturan Google Drive
            </button>
          </div>
        </div>
      )}

      {/* TAB 5: WHATSAPP FONNTE */}
      {activeTab === 'wa' && (
        <div className={`${card} p-6 space-y-6`}>
          <div>
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald-600" />
              Notifikasi Laporan Piket ke WhatsApp Grup Sekolah
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Kirim laporan dokumentasi foto beserta nama guru dan kondisi gerbang langsung ke grup WA guru sekolah via Fonnte.
            </p>
          </div>

          {/* Form Konfigurasi WA */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Token Fonnte
              </label>
              <input
                type="password"
                value={secretFonnteToken}
                onChange={(e) => setSecretFonnteToken(e.target.value)}
                placeholder={secrets.hasFonnteToken ? '•••••• (Sudah tersimpan, isi hanya jika ingin mengganti)' : 'Token akun Fonnte'}
                className={input}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Dapatkan dari dasbor <a href="https://fonnte.com" target="_blank" rel="noreferrer" className="text-blue-600 underline">fonnte.com</a>.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchWaGroupList}
                disabled={fetchingWaGroups}
                className={`${btn.ghost} text-xs py-1.5`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${fetchingWaGroups ? 'animate-spin' : ''}`} />
                {fetchingWaGroups ? 'Menarik...' : 'Tarik Daftar Grup dari Fonnte'}
              </button>
            </div>

            {waGroups.length > 0 && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Pilih Grup WhatsApp Tujuan
                </label>
                <select
                  value={cfg.waGroupTarget}
                  onChange={(e) => {
                    const selected = waGroups.find((g) => g.id === e.target.value);
                    setCfg({
                      ...cfg,
                      waGroupTarget: e.target.value,
                      waGroupName: selected ? selected.name : cfg.waGroupName,
                    });
                  }}
                  className={input}
                >
                  <option value="">-- Pilih Salah Satu Grup --</option>
                  {waGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.id})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ID Target Grup / Nomor Tujuan
              </label>
              <input
                type="text"
                value={cfg.waGroupTarget}
                onChange={(e) => setCfg({ ...cfg, waGroupTarget: e.target.value })}
                placeholder="120363xxxx@g.us atau nomor 08xxxx"
                className={input}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Nama Grup WhatsApp (Tampilan)
              </label>
              <input
                type="text"
                value={cfg.waGroupName}
                onChange={(e) => setCfg({ ...cfg, waGroupName: e.target.value })}
                placeholder="Contoh: GRUP GURU SDN 1 REJOSO"
                className={input}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <input
                type="checkbox"
                id="waAutoSend"
                checked={cfg.waAutoSend}
                onChange={(e) => setCfg({ ...cfg, waAutoSend: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded cursor-pointer"
              />
              <label htmlFor="waAutoSend" className="text-xs font-bold text-slate-700 cursor-pointer">
                Otomatis kirim notifikasi foto piket ke grup WhatsApp saat foto diunggah
              </label>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button type="button" onClick={saveWaSettings} className={btn.primary}>
              <Save className="w-3.5 h-3.5" />
              Simpan Pengaturan WhatsApp
            </button>
          </div>
        </div>
      )}

      {/* Modal Panduan Google Apps Script */}
      {showGasModal && (
        <Modal title="Panduan Pemasangan Google Drive Sekolah" onClose={() => setShowGasModal(false)} wide>
          <div className="space-y-4 text-xs text-slate-700">
            <div className="bg-blue-50 border border-blue-200 text-blue-900 p-3.5 rounded-2xl">
              <strong>Kelebihan Menggunakan Google Apps Script:</strong>
              <p className="mt-1">
                Metode ini 100% gratis, aman, dan langsung menyimpan foto ke akun Google Drive sekolah Anda tanpa masa kedaluwarsa token. Anda dapat langsung membuka folder arsip kapan saja dari komputer maupun smartphone.
              </p>
            </div>

            <ol className="list-decimal pl-5 space-y-2">
              <li>
                Buka <a href="https://script.google.com" target="_blank" rel="noreferrer" className="text-blue-600 underline font-bold">script.google.com</a> dengan akun Google resmi sekolah.
              </li>
              <li>Klik tombol <strong>Proyek Baru (New project)</strong>.</li>
              <li>Hapus semua teks yang ada di editor, lalu tempel kode di bawah ini.</li>
              <li>
                Ganti nilai <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">SECRET</code> dengan kunci rahasia buatan Anda sendiri (misal: gabungan huruf & angka acak).
              </li>
              <li>
                Klik menu <strong>Terapkan (Deploy) &gt; Deployment baru</strong>:
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  <li>Pilih jenis: <strong>Aplikasi web (Web app)</strong></li>
                  <li>Jalankan sebagai: <strong>Saya (akun sekolah)</strong></li>
                  <li>Yang memiliki akses: <strong>Siapa saja (Anyone)</strong></li>
                </ul>
              </li>
              <li>Klik <strong>Terapkan</strong>, lalu setujui perizinan Google Drive yang diminta.</li>
              <li>Salin <strong>URL Aplikasi Web</strong> yang dihasilkan (berakhiran <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">/exec</code>).</li>
              <li>Tempel URL tersebut dan Kunci Rahasia Anda di tab <strong>Google Drive Sekolah</strong> pada aplikasi ini, lalu klik Simpan.</li>
            </ol>

            <div className="mt-4">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-slate-800">Salin Kode Skrip (Code.gs):</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(GAS_CODE_SNIPPET);
                    ctx.notify('ok', 'Kode Google Apps Script berhasil disalin ke clipboard.');
                  }}
                  className={`${btn.primary} text-xs py-1 px-2.5`}
                >
                  <Copy className="w-3 h-3" />
                  Salin Kode
                </button>
              </div>
              <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl overflow-x-auto text-[11px] font-mono max-h-56">
                {GAS_CODE_SNIPPET}
              </pre>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Panduan & Skrip SQL Supabase */}
      {showSupabaseSqlModal && (
        <Modal title="Panduan & Skrip SQL Setup Supabase" onClose={() => setShowSupabaseSqlModal(false)} wide>
          <div className="space-y-4 text-xs text-slate-700">
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-3.5 rounded-2xl">
              <strong>Kelebihan Menggunakan Database Supabase (PostgreSQL):</strong>
              <p className="mt-1">
                Supabase adalah layanan PostgreSQL cloud modern gratis. Seluruh jadwal, daftar guru, konfigurasi, dan riwayat foto tersimpan di server database cloud dengan fitur pencadangan otomatis, performa tinggi, dan tabel terstruktur yang dapat Anda buka atau ekspor kapan saja melalui Supabase Table Editor.
              </p>
            </div>

            <ol className="list-decimal pl-5 space-y-2">
              <li>
                Masuk atau buat akun gratis di{' '}
                <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-emerald-700 underline font-bold">
                  supabase.com
                </a>
                .
              </li>
              <li>Klik <strong>New Project</strong>, beri nama proyek (misal: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">piket-gerbang</code>), lalu buat kata sandi database.</li>
              <li>Buka menu <strong>SQL Editor</strong> di bilah navigasi kiri, lalu klik <strong>New query</strong>.</li>
              <li>Salin skrip SQL di kotak bawah ini, tempel ke editor query, lalu klik tombol <strong>Run</strong> (atau tekan Ctrl+Enter).</li>
              <li>
                Buka menu <strong>Project Settings &gt; API</strong>:
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  <li>Salin <strong>Project URL</strong> (contoh: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">https://xxxx.supabase.co</code>)</li>
                  <li>Salin <strong>anon public key</strong> (atau <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">service_role</code>)</li>
                </ul>
              </li>
              <li>Tempel URL dan API Key tersebut di tab <strong>Database Supabase</strong> aplikasi ini, centang opsi aktif, lalu klik <strong>Simpan Pengaturan Supabase</strong>.</li>
              <li>Klik tombol <strong>Uji Koneksi Supabase</strong> untuk memastikan status terhubung!</li>
            </ol>

            <div className="mt-4">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-slate-800">Skrip SQL Supabase (schema.sql):</span>
                <button
                  type="button"
                  onClick={() => {
                    const sql = supabaseSqlSnippet || GAS_CODE_SNIPPET;
                    navigator.clipboard.writeText(supabaseSqlSnippet);
                    ctx.notify('ok', 'Skrip SQL Supabase berhasil disalin ke clipboard.');
                  }}
                  className={`${btn.primary} bg-emerald-700 hover:bg-emerald-800 text-xs py-1 px-2.5`}
                >
                  <Copy className="w-3 h-3" />
                  Salin Skrip SQL
                </button>
              </div>
              <pre className="p-3 bg-slate-900 text-emerald-300 rounded-xl overflow-x-auto text-[11px] font-mono max-h-64 select-all">
                {supabaseSqlSnippet}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
