import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Camera,
  CheckCircle,
  Clock,
  Database,
  HardDrive,
  Images,
  KeyRound,
  Lock,
  LogOut,
  MessageSquare,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { Assignment, Config, SecretsStatus, Staff } from '../shared/types.ts';
import { DEFAULT_CONFIG } from '../shared/types.ts';
import { GalleryView } from './components/GalleryView.tsx';
import { HomeView } from './components/HomeView.tsx';
import { RecapView } from './components/RecapView.tsx';
import { ScheduleView } from './components/ScheduleView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { Chip, Modal, ToastItem, ToastKind, ToastStack, btn, card, input } from './components/ui.tsx';
import { api, session } from './lib/api.ts';
import type { AppCtx } from './lib/ctx.ts';

type Tab = 'home' | 'gallery' | 'schedule' | 'recap' | 'settings';

export const App: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState('');
  const [tab, setTab] = useState<Tab>('home');

  // Status data
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [schedule, setSchedule] = useState<Assignment[]>([]);
  const [secrets, setSecrets] = useState<SecretsStatus>({
    hasFonnteToken: false,
    hasDriveScript: false,
    hasDriveSecret: false,
    hasSupabase: false,
    fonnteFromEnv: false,
    driveFromEnv: false,
    supabaseFromEnv: false,
  });
  const [defaultCredentials, setDefaultCredentials] = useState(false);
  const [isAdmin, setIsAdmin] = useState(Boolean(session.pin));

  // Koneksi jaringan
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextToastId = useRef(1);

  const notify = useCallback((kind: ToastKind, text: string) => {
    const id = nextToastId.current++;
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Modal Akses & Admin PIN
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [inputCode, setInputCode] = useState(session.code || 'sdn1rejoso');
  const [codeError, setCodeError] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);

  const [showPinModal, setShowPinModal] = useState(false);
  const [inputPin, setInputPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinResolver, setPinResolver] = useState<((val: boolean) => void) | null>(null);

  // Event online / offline
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      notify('ok', 'Koneksi internet terhubung kembali.');
    };
    const handleOffline = () => {
      setIsOnline(false);
      notify('err', 'Koneksi internet terputus. Mode offline aktif.');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [notify]);

  // Muat data awal (bootstrap)
  const loadBootstrap = useCallback(async () => {
    try {
      setLoading(true);
      setInitError('');
      const data = await api.bootstrap();
      setConfig(data.config);
      setStaff(data.staff);
      setSchedule(data.schedule);
      setSecrets(data.secrets);
      setDefaultCredentials(data.defaultCredentials);
      setShowCodeModal(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data piket.';
      setInitError(msg);
      // Bila belum punya kode akses atau ditolak, buka dialog kode akses
      if (!session.code || (err as { status?: number }).status === 401) {
        setShowCodeModal(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session.code) {
      // Default pengisian kode bawaan SDN 1 Rejoso agar guru langsung bisa pakai
      session.code = 'sdn1rejoso';
    }
    loadBootstrap();
  }, [loadBootstrap]);

  // Verifikasi Kode Akses Guru
  const submitCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputCode.trim()) {
      setCodeError('Kode akses tidak boleh kosong.');
      return;
    }
    setVerifyingCode(true);
    setCodeError('');
    try {
      const ping = await api.ping(inputCode.trim());
      if (ping.authorized) {
        session.code = inputCode.trim();
        setShowCodeModal(false);
        notify('ok', 'Kode akses diterima. Selamat datang di Piket Gerbang!');
        await loadBootstrap();
      } else {
        setCodeError('Kode akses salah. Periksa kembali.');
      }
    } catch {
      setCodeError('Gagal memverifikasi kode. Periksa koneksi internet.');
    } finally {
      setVerifyingCode(false);
    }
  };

  // Minta PIN Admin
  const requireAdmin = useCallback((): Promise<boolean> => {
    if (session.pin) {
      setIsAdmin(true);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      setInputPin('');
      setPinError('');
      setPinResolver(() => resolve);
      setShowPinModal(true);
    });
  }, []);

  const submitPin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputPin.trim()) {
      setPinError('PIN Admin tidak boleh kosong.');
      return;
    }
    try {
      await api.verifyAdmin(inputPin.trim());
      setIsAdmin(true);
      setShowPinModal(false);
      notify('ok', 'Akses Admin dibuka.');
      if (pinResolver) {
        pinResolver(true);
        setPinResolver(null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'PIN Admin salah.';
      setPinError(msg);
    }
  };

  const cancelPinModal = () => {
    setShowPinModal(false);
    if (pinResolver) {
      pinResolver(false);
      setPinResolver(null);
    }
  };

  const logoutAdmin = () => {
    session.pin = '';
    setIsAdmin(false);
    notify('info', 'Keluar dari mode Admin.');
  };

  // Helper nama guru & objek guru
  const staffNameMap = useMemo(() => new Map(staff.map((s) => [s.id, s.nama])), [staff]);
  const staffName = useCallback((id: string) => staffNameMap.get(id) || id, [staffNameMap]);
  const staffObjMap = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const staffObj = useCallback((id: string) => staffObjMap.get(id), [staffObjMap]);

  // Context value
  const ctx: AppCtx = useMemo(
    () => ({
      config,
      staff,
      schedule,
      secrets,
      isAdmin,
      defaultCredentials,
      staffName,
      staffObj,
      notify,
      reload: loadBootstrap,
      requireAdmin,
    }),
    [config, staff, schedule, secrets, isAdmin, defaultCredentials, staffName, staffObj, notify, loadBootstrap, requireAdmin]
  );

  return (
    <div className="min-h-screen text-slate-900 pb-20 md:pb-8 flex flex-col">
      {/* HEADER UTAMA */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80 shadow-xs no-print">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-18 flex items-center justify-between gap-3">
          {/* Logo & Judul Sekolah */}
          <div className="flex items-center gap-3">
            <div className="relative group shrink-0">
              {config.logoSekolahUrl ? (
                <img
                  src={config.logoSekolahUrl}
                  alt="Logo Sekolah"
                  className="w-11 h-11 object-contain rounded-2xl p-0.5 bg-white ring-2 ring-blue-500/20 shadow-md shadow-blue-500/10 transition-transform duration-200 group-hover:scale-105"
                />
              ) : (
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-700 via-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 ring-2 ring-white">
                  <Camera className="w-5 h-5" />
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-black text-slate-900 tracking-tight leading-none uppercase">
                  {config.schoolName || 'SD NEGERI 1 REJOSO'}
                </h1>
                {config.logoVisiUrl && (
                  <img
                    src={config.logoVisiUrl}
                    alt="Logo Visi Sekolah"
                    className="hidden sm:inline-block h-6 object-contain opacity-90 hover:opacity-100 transition shrink-0"
                    title="Visi Sekolah"
                  />
                )}
                {isAdmin ? (
                  <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-xs">
                    <ShieldCheck className="w-3 h-3" />
                    Admin
                  </span>
                ) : (
                  <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200/60">
                    Guru
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-semibold leading-tight mt-1 flex items-center gap-1.5">
                <span className="text-blue-700 font-bold">{config.schoolSub || 'Piket Gerbang Guru 5S'}</span>
                <span className="text-slate-300">•</span>
                <Clock className="w-3 h-3 text-slate-400 inline" />
                <span>Jam {config.jamMulai} - {config.jamSelesai} WIB</span>
              </p>
            </div>
          </div>

          {/* Status Badges & Admin Trigger */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Status Online */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                isOnline ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}
              title={isOnline ? 'Terhubung ke Internet' : 'Mode Offline'}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span>{isOnline ? 'Online' : 'Offline'}</span>
            </div>

            {/* Status Mode Mandiri / Server Cloud */}
            {api.isClientMode ? (
              <div
                className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200"
                title="Aplikasi berjalan dalam mode mandiri web (Data & foto tersimpan aman di browser dan langsung disinkronkan ke Google Drive)"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>Mode Mandiri Web</span>
              </div>
            ) : (
              <div
                className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"
                title="Terhubung ke server cloud / lokal"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Server Aktif</span>
              </div>
            )}

            {/* Status Google Drive */}
            {secrets.hasDriveScript ? (
              <div
                onClick={() => setTab('settings')}
                className="hidden md:flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 cursor-pointer hover:bg-blue-100 transition"
                title="Google Drive Sekolah Terhubung"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>Drive Siap</span>
              </div>
            ) : (
              <div
                onClick={() => setTab('settings')}
                className="hidden md:flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200 cursor-pointer hover:bg-amber-100 transition"
                title="Google Drive belum diatur. Klik untuk mengatur."
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>Atur Drive</span>
              </div>
            )}

            {/* Status Database Supabase */}
            {secrets.hasSupabase && (
              <div
                onClick={() => setTab('settings')}
                className="hidden md:flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-pointer hover:bg-emerald-100 transition"
                title="Database Supabase PostgreSQL Terhubung"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Supabase Siap</span>
              </div>
            )}

            {/* Tombol Masuk/Keluar Admin */}
            {isAdmin ? (
              <button
                type="button"
                onClick={logoutAdmin}
                className={`${btn.ghost} py-1.5 px-2.5 text-xs text-rose-700 hover:bg-rose-50 border border-rose-200`}
                title="Kunci Kembali Mode Admin"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Kunci Admin</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => requireAdmin()}
                className={`${btn.ghost} py-1.5 px-2.5 text-xs border border-slate-200`}
                title="Buka Menu Admin dengan PIN"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">PIN Admin</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Bar Desktop */}
        <div className="hidden md:block max-w-6xl mx-auto px-4 sm:px-6">
          <nav className="flex space-x-1 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setTab('home')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-black border-b-2 transition cursor-pointer ${
                tab === 'home'
                  ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Camera className="w-4 h-4" />
              Hari Ini
            </button>

            <button
              type="button"
              onClick={() => setTab('gallery')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-black border-b-2 transition cursor-pointer ${
                tab === 'gallery'
                  ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Images className="w-4 h-4" />
              Galeri Foto
            </button>

            <button
              type="button"
              onClick={() => setTab('schedule')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-black border-b-2 transition cursor-pointer ${
                tab === 'schedule'
                  ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <CalendarDays className="w-4 h-4" />
              Jadwal Piket
            </button>

            <button
              type="button"
              onClick={() => setTab('recap')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-black border-b-2 transition cursor-pointer ${
                tab === 'recap'
                  ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              Rekap & Laporan
            </button>

            <button
              type="button"
              onClick={() => setTab('settings')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-black border-b-2 transition cursor-pointer ${
                tab === 'settings'
                  ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Settings className="w-4 h-4" />
              Pengaturan
            </button>
          </nav>
        </div>
      </header>

      {/* ISI KONTEN UTAMA */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full">
        {loading ? (
          <div className="py-24 text-center">
            <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
            <div className="text-sm font-bold text-slate-700">Memuat data Piket Gerbang...</div>
            <div className="text-xs text-slate-400 mt-1">Mengambil jadwal, guru, dan arsip Google Drive</div>
          </div>
        ) : initError && !showCodeModal ? (
          <div className={`${card} p-8 text-center max-w-md mx-auto my-12`}>
            <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-3" />
            <h2 className="text-base font-black text-slate-800 mb-2">Gagal Menghubungkan ke Server</h2>
            <p className="text-xs text-slate-600 mb-4">{initError}</p>
            <div className="flex justify-center gap-2">
              <button type="button" onClick={loadBootstrap} className={btn.primary}>
                <RefreshCw className="w-3.5 h-3.5" />
                Coba Lagi
              </button>
              <button
                type="button"
                onClick={() => setShowCodeModal(true)}
                className={`${btn.ghost} border border-slate-200`}
              >
                Ganti Kode Akses
              </button>
            </div>
          </div>
        ) : (
          <>
            {tab === 'home' && <HomeView ctx={ctx} />}
            {tab === 'gallery' && <GalleryView ctx={ctx} />}
            {tab === 'schedule' && <ScheduleView ctx={ctx} />}
            {tab === 'recap' && <RecapView ctx={ctx} />}
            {tab === 'settings' && <SettingsView ctx={ctx} />}
          </>
        )}
      </main>

      {/* FOOTER INFORMASI */}
      <footer className="mt-auto py-6 border-t border-slate-200/80 bg-white/60 text-center text-xs text-slate-400 no-print">
        <div className="max-w-6xl mx-auto px-4">
          <p>
            {config.schoolName} • Aplikasi Piket Gerbang Guru Mandiri
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Mendukung penyimpanan otomatis Google Drive sekolah, notifikasi WhatsApp Fonnte, dan siap deploy Netlify.
          </p>
        </div>
      </footer>

      {/* BOTTOM TAB BAR (KHUSUS MOBILE SMARTPHONE) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 flex items-center justify-around py-2 shadow-lg no-print">
        <button
          type="button"
          onClick={() => setTab('home')}
          className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-bold ${
            tab === 'home' ? 'text-blue-700' : 'text-slate-400'
          }`}
        >
          <Camera className="w-5 h-5" />
          <span>Hari Ini</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('gallery')}
          className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-bold ${
            tab === 'gallery' ? 'text-blue-700' : 'text-slate-400'
          }`}
        >
          <Images className="w-5 h-5" />
          <span>Galeri</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('schedule')}
          className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-bold ${
            tab === 'schedule' ? 'text-blue-700' : 'text-slate-400'
          }`}
        >
          <CalendarDays className="w-5 h-5" />
          <span>Jadwal</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('recap')}
          className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-bold ${
            tab === 'recap' ? 'text-blue-700' : 'text-slate-400'
          }`}
        >
          <TrendingUp className="w-5 h-5" />
          <span>Rekap</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('settings')}
          className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-bold ${
            tab === 'settings' ? 'text-blue-700' : 'text-slate-400'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span>Pengaturan</span>
        </button>
      </div>

      {/* TOAST NOTIFIKASI */}
      <ToastStack items={toasts} onDismiss={dismissToast} />

      {/* MODAL KODE AKSES SEKOLAH */}
      {showCodeModal && (
        <Modal title="Kode Akses Piket Gerbang" onClose={() => {}} wide={false}>
          <form onSubmit={submitCode} className="space-y-4">
            <p className="text-xs text-slate-600">
              Masukkan kode akses sekolah untuk membuka aplikasi Piket Gerbang ini.
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Kode Akses</label>
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                placeholder="Contoh: sdn1rejoso"
                autoFocus
                className={input}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Kode bawaan sekolah: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono font-bold">sdn1rejoso</code>
              </p>
            </div>

            {codeError && <div className="text-xs font-bold text-rose-600">{codeError}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setInputCode('sdn1rejoso')}
                className={`${btn.ghost} text-xs`}
              >
                Gunakan Bawaan
              </button>
              <button type="submit" disabled={verifyingCode} className={btn.primary}>
                {verifyingCode ? 'Memverifikasi...' : 'Masuk Aplikasi'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL PIN ADMIN */}
      {showPinModal && (
        <Modal title="Masukkan PIN Admin" onClose={cancelPinModal} wide={false}>
          <form onSubmit={submitPin} className="space-y-4">
            <p className="text-xs text-slate-600">
              Operasi ini membutuhkan otorisasi Administrator (PIN 6 Digit).
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">PIN Admin</label>
              <input
                type="password"
                maxLength={10}
                value={inputPin}
                onChange={(e) => setInputPin(e.target.value)}
                placeholder="••••••"
                autoFocus
                className={input}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                PIN bawaan: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono font-bold">123456</code>
              </p>
            </div>

            {pinError && <div className="text-xs font-bold text-rose-600">{pinError}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={cancelPinModal} className={btn.ghost}>
                Batal
              </button>
              <button type="submit" className={btn.primary}>
                Konfirmasi PIN
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
export default App;

