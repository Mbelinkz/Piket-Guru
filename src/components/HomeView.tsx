import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, Clock, Image as ImageIcon, Loader2, RefreshCw, Upload } from 'lucide-react';
import type { Gate, PhotoMeta, PhotoSource, PhotoUploadBody, Condition } from '../../shared/types.ts';
import { CONDITIONS, GATES } from '../../shared/types.ts';
import { clockWIB, dutyStaffId, formatIndonesianDate, isWorkingDay, localDateISO } from '../../shared/piket.ts';
import { api, ApiError, loadQueue, saveQueue } from '../lib/api.ts';
import { compressImage, makeThumb, renderReportCard, validateImageFile } from '../lib/image.ts';
import type { AppCtx } from '../lib/ctx.ts';
import { PhotoCard } from './PhotoCard.tsx';
import { Avatar, Chip, Modal, btn, card, input } from './ui.tsx';

const DEFAULT_NOTE = 'Penyambutan siswa 5S (Senyum, Sapa, Salam, Sopan, Santun) dan penertiban kendaraan gerbang.';

const newId = () => `photo-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const HomeView: React.FC<{ ctx: AppCtx }> = ({ ctx }) => {
  const { config, staff, schedule } = ctx;
  const [now, setNow] = useState(new Date());
  const today = localDateISO(now);
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [queueCount, setQueueCount] = useState(() => loadQueue().length);
  const flushing = useRef(false);

  // form state
  const [date, setDate] = useState(today);
  const [gate, setGate] = useState<Gate>('Gerbang Depan');
  const [staffId, setStaffId] = useState('');
  const [kondisi, setKondisi] = useState<Condition>('Aman & Tertib');
  const [note, setNote] = useState(DEFAULT_NOTE);
  const [sumber, setSumber] = useState<PhotoSource>('kamera');
  const [galleryTime, setGalleryTime] = useState('');
  const [photoData, setPhotoData] = useState('');
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const assignment = schedule.find((a) => a.tanggal === today);
  const picketToday = isWorkingDay(today, config);

  const loadToday = useCallback(async () => {
    setLoading(true);
    try {
      setPhotos((await api.photosByDate(localDateISO())).photos);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'network')) ctx.notify('err', (e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadToday();
    const t = setInterval(loadToday, 45000);
    return () => clearInterval(t);
  }, [loadToday]);

  /* ---- kirim otomatis ke Drive lalu WhatsApp (WA belakangan agar memuat tautan Drive) ---- */
  const dispatchAll = async (p: PhotoMeta, log?: (s: string) => void): Promise<PhotoMeta> => {
    let cur = p;
    if (config.driveEnabled && config.driveAutoUpload && !cur.driveUrl) {
      log?.('Mengunggah ke Google Drive sekolah…');
      try {
        const r = await api.dispatch('drive', cur.id, cur.tanggal);
        cur = r.photo;
        log?.(r.result.ok ? '✓ Tersimpan di Google Drive' : `✗ Drive: ${r.result.message}`);
      } catch (e) {
        log?.(`✗ Drive: ${(e as Error).message}`);
      }
    }
    if (config.waEnabled && config.waAutoSend && !cur.waAt) {
      log?.('Mengirim notifikasi ke grup WhatsApp…');
      try {
        const r = await api.dispatch('wa', cur.id, cur.tanggal);
        cur = r.photo;
        log?.(r.result.ok ? '✓ Notifikasi WhatsApp terkirim' : `✗ WhatsApp: ${r.result.message}`);
      } catch (e) {
        log?.(`✗ WhatsApp: ${(e as Error).message}`);
      }
    }
    return cur;
  };

  const upsert = (p: PhotoMeta) => setPhotos((prev) => (p.tanggal !== today ? prev : [p, ...prev.filter((x) => x.id !== p.id)]));

  /* ---- antrean offline ---- */
  const flushQueue = useCallback(async () => {
    if (flushing.current) return;
    const q = loadQueue();
    if (!q.length) return;
    flushing.current = true;
    try {
      const rest: PhotoUploadBody[] = [];
      for (const item of q) {
        try {
          const r = await api.uploadPhoto(item);
          await dispatchAll(r.photo);
        } catch (e) {
          // kesalahan permanen (data ditolak) dibuang agar tidak menyumbat; kesalahan jaringan dipertahankan
          if (e instanceof ApiError && e.code !== 'network' && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
            ctx.notify('err', `Foto antrean ditolak server: ${e.message}`);
          } else rest.push(item);
        }
      }
      saveQueue(rest);
      setQueueCount(rest.length);
      if (rest.length < q.length) {
        ctx.notify('ok', `${q.length - rest.length} foto dari antrean berhasil terkirim.`);
        loadToday();
      }
    } finally {
      flushing.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    flushQueue();
    window.addEventListener('online', flushQueue);
    return () => window.removeEventListener('online', flushQueue);
  }, [flushQueue]);

  /* ---- form ---- */
  const dutyFor = (d: string, g: Gate): string => {
    const a = schedule.find((x) => x.tanggal === d);
    if (g === 'Gerbang Depan') return dutyStaffId(a, 'front');
    if (g === 'Gerbang Belakang') return dutyStaffId(a, 'back');
    return '';
  };

  const openForm = (g: Gate) => {
    setDate(today);
    setGate(g);
    setStaffId(dutyFor(today, g));
    setKondisi('Aman & Tertib');
    setNote(DEFAULT_NOTE);
    setPhotoData('');
    setSteps([]);
    setFormError('');
    setSumber('kamera');
    const d = new Date();
    setGalleryTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    setFormOpen(true);
  };

  const onPick = async (file: File | undefined, from: PhotoSource) => {
    if (!file) return;
    const err = validateImageFile(file);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError('');
    setProcessing(true);
    try {
      setPhotoData(await compressImage(file));
      setSumber(from);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setProcessing(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (galleryRef.current) galleryRef.current.value = '';
    }
  };

  const staffName = staff.find((s) => s.id === staffId)?.nama || '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoData) return setFormError('Ambil foto dari kamera atau pilih dari galeri terlebih dahulu.');
    if (!staffName) return setFormError('Pilih nama guru piket.');
    setFormError('');
    setSubmitting(true);
    setSteps([]);
    const log = (s: string) => setSteps((prev) => [...prev, s]);
    try {
      const waktu = sumber === 'kamera' ? clockWIB() : `${galleryTime || '06:30'}:00 WIB`;
      const cardImg = await renderReportCard(photoData, {
        schoolName: config.schoolName,
        staffNama: staffName,
        tanggal: date,
        waktu,
        lokasi: gate,
        kondisi,
        keterangan: note,
        sumber,
        logoSekolahUrl: config.logoSekolahUrl,
      });
      const thumb = await makeThumb(cardImg);
      const body: PhotoUploadBody = {
        id: newId(),
        tanggal: date,
        waktu,
        lokasi: gate,
        staffId,
        staffNama: staffName,
        kondisi,
        keterangan: note,
        sumber,
        image: cardImg,
        thumb,
      };
      log('Menyimpan foto ke server…');
      try {
        const r = await api.uploadPhoto(body);
        log('✓ Foto tersimpan');
        upsert(r.photo);
        const done = await dispatchAll(r.photo, log);
        upsert(done);
        ctx.notify('ok', `Foto piket ${staffName} berhasil disimpan.`);
        setTimeout(() => setFormOpen(false), 1200);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'network') {
          const q = [...loadQueue(), body];
          if (saveQueue(q)) {
            setQueueCount(q.length);
            log('⚠ Tidak ada koneksi. Foto disimpan di antrean perangkat & akan dikirim otomatis saat online.');
            ctx.notify('info', 'Offline: foto masuk antrean dan dikirim otomatis nanti.');
            setTimeout(() => setFormOpen(false), 1800);
          } else {
            setFormError('Tidak ada koneksi dan memori antrean penuh. Hubungkan internet lalu coba lagi.');
          }
        } else {
          setFormError((err as Error).message);
        }
      }
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const gateStatus = (g: Gate) => photos.some((p) => p.lokasi === g);
  const duties = useMemo(
    () => [
      { gate: 'Gerbang Depan' as Gate, id: dutyStaffId(assignment, 'front'), replaced: !!assignment?.frontReplacementId, reason: assignment?.frontReplacementReason },
      { gate: 'Gerbang Belakang' as Gate, id: dutyStaffId(assignment, 'back'), replaced: !!assignment?.backReplacementId, reason: assignment?.backReplacementReason },
    ],
    [assignment]
  );

  return (
    <div className="space-y-5">
      <div className={`${card} p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-700 text-white flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-2xl font-black font-mono text-slate-800 leading-none">{clockWIB(now).replace(' WIB', '')}</p>
            <p className="text-xs text-slate-500 font-medium mt-1">{formatIndonesianDate(today)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="off">
            Jam piket {config.jamMulai}–{config.jamSelesai}
          </Chip>
          {queueCount > 0 && (
            <button type="button" className={btn.danger} onClick={flushQueue}>
              <RefreshCw className="w-3.5 h-3.5" /> {queueCount} foto menunggu terkirim
            </button>
          )}
          <button type="button" className={btn.primary} onClick={() => openForm('Gerbang Depan')}>
            <Camera className="w-4 h-4" /> Foto Piket Baru
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {duties.map((d) => {
          const done = gateStatus(d.gate);
          const staffMember = d.id ? ctx.staffObj(d.id) : undefined;
          const isFront = d.gate === 'Gerbang Depan';
          return (
            <div
              key={d.gate}
              className={`${card} p-5 relative overflow-hidden transition-all duration-300 hover:shadow-lg`}
            >
              <div
                className={`absolute top-0 left-0 right-0 h-1.5 ${
                  isFront
                    ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500'
                    : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-400'
                }`}
              />

              <div className="flex items-center justify-between pt-1">
                <span
                  className={`text-xs font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                    isFront
                      ? 'bg-blue-50 text-blue-800 border border-blue-200'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  }`}
                >
                  {d.gate}
                </span>

                {picketToday && assignment ? (
                  done ? (
                    <Chip tone="ok">Sudah Foto ✓</Chip>
                  ) : (
                    <Chip tone="warn">Menunggu Foto</Chip>
                  )
                ) : (
                  <Chip tone="off">Tidak Ada Jadwal</Chip>
                )}
              </div>

              <div className="flex items-center gap-3.5 my-3.5">
                <Avatar
                  name={staffMember?.nama || (d.id ? ctx.staffName(d.id) : 'Guru')}
                  fotoUrl={staffMember?.fotoUrl}
                  size="lg"
                  className="ring-3 ring-blue-500/20 shadow-md"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-black text-slate-800 leading-snug truncate">
                    {d.id ? ctx.staffName(d.id) : '— Belum Ditugaskan —'}
                  </p>
                  <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
                    {staffMember?.jabatan || 'Guru Piket Sekolah'}
                  </p>
                  {d.replaced && (
                    <span className="inline-block text-[10px] font-extrabold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded-md mt-1">
                      Pengganti: {d.reason}
                    </span>
                  )}
                </div>
              </div>

              {!picketToday && (
                <p className="text-[11px] text-slate-400 italic mb-2">Hari ini libur atau bukan hari piket efektif.</p>
              )}

              <button
                type="button"
                className={`w-full ${isFront ? btn.primary : btn.green} py-2.5 mt-1`}
                onClick={() => openForm(d.gate)}
              >
                <Camera className="w-4 h-4" /> Foto {d.gate}
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black text-slate-800">Foto Piket Hari Ini ({photos.length})</h2>
        <button type="button" className={btn.ghost} onClick={loadToday} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Muat ulang
        </button>
      </div>
      {photos.length === 0 ? (
        <div className={`${card} p-10 text-center text-xs text-slate-500`}>Belum ada foto piket hari ini.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {photos.map((p) => (
            <PhotoCard
              key={p.id}
              photo={p}
              ctx={ctx}
              onChanged={(np) => setPhotos((prev) => (np ? prev.map((x) => (x.id === np.id ? np : x)) : prev.filter((x) => x.id !== p.id)))}
            />
          ))}
        </div>
      )}

      {formOpen && (
        <Modal title="Dokumentasi Piket Gerbang" onClose={() => !submitting && setFormOpen(false)}>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <p className="text-xs font-bold text-slate-700 mb-2">Foto dokumentasi</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={btn.primary} disabled={processing || submitting} onClick={() => cameraRef.current?.click()}>
                  <Camera className="w-4 h-4" /> Ambil dari Kamera
                </button>
                <button type="button" className={btn.green} disabled={processing || submitting} onClick={() => galleryRef.current?.click()}>
                  <ImageIcon className="w-4 h-4" /> Pilih dari Galeri
                </button>
              </div>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e.target.files?.[0], 'kamera')} />
              <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0], 'galeri')} />
              <div className="mt-3 rounded-2xl bg-slate-100 border border-dashed border-slate-300 min-h-40 flex items-center justify-center overflow-hidden">
                {processing ? (
                  <span className="text-xs text-slate-500 inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Memproses foto…
                  </span>
                ) : photoData ? (
                  <img src={photoData} alt="Pratinjau foto piket" className="w-full max-h-72 object-contain" />
                ) : (
                  <span className="text-xs text-slate-400 px-4 text-center">Belum ada foto. Gunakan kamera langsung atau pilih dari galeri HP.</span>
                )}
              </div>
              {photoData && (
                <p className="text-[11px] text-slate-500 mt-1">
                  Sumber: <b>{sumber === 'kamera' ? 'Kamera langsung' : 'Galeri perangkat'}</b>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-bold text-slate-700">
                Tanggal
                <input type="date" className={`${input} mt-1`} value={date} max={today} onChange={(e) => { setDate(e.target.value); setStaffId(dutyFor(e.target.value, gate) || staffId); }} />
              </label>
              <label className="text-xs font-bold text-slate-700">
                Lokasi
                <select className={`${input} mt-1`} value={gate} onChange={(e) => { const g = e.target.value as Gate; setGate(g); setStaffId(dutyFor(date, g) || staffId); }}>
                  {GATES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
            </div>
            {date !== today && <p className="text-[11px] font-bold text-amber-700">Tanggal bukan hari ini — pastikan ini unggahan susulan yang benar.</p>}

            <label className="block text-xs font-bold text-slate-700">
              Guru piket
              <select className={`${input} mt-1`} value={staffId} onChange={(e) => setStaffId(e.target.value)} required>
                <option value="">— pilih nama guru —</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nama}
                    {s.id === dutyFor(date, gate) ? '  (jadwal)' : ''}
                  </option>
                ))}
              </select>
            </label>

            {sumber === 'galeri' ? (
              <label className="block text-xs font-bold text-slate-700">
                Jam foto diambil (dari galeri)
                <input type="time" className={`${input} mt-1`} value={galleryTime} onChange={(e) => setGalleryTime(e.target.value)} required />
              </label>
            ) : (
              <p className="text-[11px] text-slate-500">Jam dicatat otomatis saat foto disimpan: <b>{clockWIB(now)}</b></p>
            )}

            <label className="block text-xs font-bold text-slate-700">
              Kondisi gerbang
              <select className={`${input} mt-1`} value={kondisi} onChange={(e) => setKondisi(e.target.value as Condition)}>
                {CONDITIONS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-700">
              Kegiatan / catatan
              <textarea className={`${input} mt-1`} rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>

            <div className="text-[11px] text-slate-500 flex flex-wrap gap-1.5">
              <Chip tone={config.driveEnabled && config.driveAutoUpload ? 'ok' : 'off'}>Google Drive {config.driveEnabled && config.driveAutoUpload ? 'otomatis' : 'nonaktif'}</Chip>
              <Chip tone={config.waEnabled && config.waAutoSend ? 'ok' : 'off'}>WhatsApp {config.waEnabled && config.waAutoSend ? 'otomatis' : 'nonaktif'}</Chip>
            </div>

            {formError && <p role="alert" className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{formError}</p>}
            {steps.length > 0 && (
              <ul className="text-xs space-y-1 bg-slate-50 rounded-xl p-3 border border-slate-200">
                {steps.map((s, i) => (
                  <li key={i} className="text-slate-700">{s}</li>
                ))}
              </ul>
            )}

            <button type="submit" className={`${btn.primary} w-full py-3`} disabled={submitting || processing}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {submitting ? 'Menyimpan…' : 'Simpan Foto Piket'}
            </button>
            {steps.some((s) => s.startsWith('✓ Foto')) && (
              <p className="text-[11px] text-emerald-700 font-bold inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Selesai
              </p>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
};

