import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { CloudUpload, Download, FileSpreadsheet, HardDrive, Printer, RefreshCw, UserCheck, Users } from 'lucide-react';
import type { PhotoMeta } from '../../shared/types.ts';
import { MONTH_NAMES } from '../../shared/types.ts';
import {
  buildMonthRecap,
  buildTeacherRecap,
  formatIndonesianDate,
  localDateISO,
} from '../../shared/piket.ts';
import { api } from '../lib/api.ts';
import type { AppCtx } from '../lib/ctx.ts';
import { Avatar, Chip, btn, card } from './ui.tsx';

export const RecapView: React.FC<{ ctx: AppCtx }> = ({ ctx }) => {
  const { config, staff, schedule, secrets } = ctx;
  const [month, setMonth] = useState(localDateISO().slice(0, 7));
  const [tab, setTab] = useState<'daily' | 'teacher'>('daily');
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingDrive, setUploadingDrive] = useState(false);

  const fetchPhotos = async () => {
    setLoading(true);
    try {
      const res = await api.photosByMonth(month);
      setPhotos(res.photos || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal memuat foto rekap.';
      ctx.notify('err', msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPhotos();
  }, [month]);

  const dailyRecap = useMemo(() => buildMonthRecap(month, schedule, photos), [month, schedule, photos]);
  const teacherRecap = useMemo(() => buildTeacherRecap(month, schedule, photos, staff), [month, schedule, photos, staff]);

  // Statistik ringkas
  const stats = useMemo(() => {
    const totalScheduled = dailyRecap.filter((d) => d.scheduled).length;
    const totalPhotos = photos.filter((p) => !p.deleted).length;
    const totalDrive = photos.filter((p) => !p.deleted && p.driveUrl).length;
    const totalWa = photos.filter((p) => !p.deleted && p.waAt).length;

    let totalFrontDuty = 0;
    let frontDone = 0;
    let totalBackDuty = 0;
    let backDone = 0;

    for (const d of dailyRecap) {
      if (d.frontStaffId) {
        totalFrontDuty++;
        if (d.frontDone) frontDone++;
      }
      if (d.backStaffId) {
        totalBackDuty++;
        if (d.backDone) backDone++;
      }
    }

    return {
      totalScheduled,
      totalPhotos,
      totalDrive,
      totalWa,
      frontRate: totalFrontDuty ? Math.round((frontDone / totalFrontDuty) * 100) : 0,
      backRate: totalBackDuty ? Math.round((backDone / totalBackDuty) * 100) : 0,
    };
  }, [dailyRecap, photos]);

  const [yStr, mStr] = month.split('-');
  const monthName = `${MONTH_NAMES[Number(mStr) - 1]} ${yStr}`;
  const coordinator = staff.find((s) => s.id === config.coordinatorStaffId);

  // Helper pembuat workbook XLSX
  const buildWorkbook = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Rekap Harian
    const dailyRows = [
      [`REKAP KEGIATAN PIKET GERBANG - ${config.schoolName.toUpperCase()}`],
      [`Bulan: ${monthName}`],
      [''],
      [
        'No',
        'Tanggal',
        'Hari',
        'Petugas Gerbang Depan',
        'Status Depan',
        'Petugas Gerbang Belakang',
        'Status Belakang',
        'Jumlah Foto',
        'Arsip Drive',
        'Notifikasi WA',
      ],
      ...dailyRecap.map((r, i) => [
        i + 1,
        r.tanggal,
        r.hari,
        ctx.staffName(r.frontStaffId) || '-',
        r.frontDone ? 'Hadir / Terlaksana' : r.frontStaffId ? 'Belum Ada Foto' : '-',
        ctx.staffName(r.backStaffId) || '-',
        r.backDone ? 'Hadir / Terlaksana' : r.backStaffId ? 'Belum Ada Foto' : '-',
        r.photos,
        r.drive > 0 ? `${r.drive} foto` : '-',
        r.wa > 0 ? `${r.wa} kali` : '-',
      ]),
    ];
    const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows);
    XLSX.utils.book_append_sheet(wb, wsDaily, 'Rekap Harian');

    // Sheet 2: Rekap Per Guru
    const teacherRows = [
      [`REKAP KEHADIRAN GURU PIKET - ${config.schoolName.toUpperCase()}`],
      [`Bulan: ${monthName}`],
      [''],
      ['No', 'Nama Guru', 'Tugas Dijadwalkan', 'Tugas Terlaksana', 'Persentase (%)', 'Total Foto'],
      ...teacherRecap.map((t, i) => {
        const pct = t.dijadwalkan ? Math.round((t.terlaksana / t.dijadwalkan) * 100) : 0;
        return [i + 1, t.nama, t.dijadwalkan, t.terlaksana, `${pct}%`, t.foto];
      }),
    ];
    const wsTeacher = XLSX.utils.aoa_to_sheet(teacherRows);
    XLSX.utils.book_append_sheet(wb, wsTeacher, 'Rekap Guru');

    return wb;
  };

  const downloadExcel = () => {
    const wb = buildWorkbook();
    const fileName = `Rekap_Piket_${config.schoolName.replace(/\s+/g, '_')}_${month}.xlsx`;
    XLSX.writeFile(wb, fileName);
    ctx.notify('ok', `Berkas Excel ${fileName} berhasil diunduh.`);
  };

  const uploadToGoogleDrive = async () => {
    if (!secrets.hasDriveScript) {
      return ctx.notify('err', 'Google Apps Script Drive belum dipasang. Buka Pengaturan > Google Drive.');
    }
    setUploadingDrive(true);
    try {
      const wb = buildWorkbook();
      const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const fileName = `Rekap_Piket_${config.schoolName.replace(/\s+/g, '_')}_${month}.xlsx`;
      const res = await api.uploadRecap(month, fileName, base64);
      if (res.result && res.result.ok) {
        ctx.notify('ok', 'Rekap Excel berhasil diunggah dan disimpan ke Google Drive sekolah!');
      } else {
        ctx.notify('err', res.result?.message || 'Gagal menyimpan rekap ke Google Drive.');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal mengirim rekap ke Drive.';
      ctx.notify('err', msg);
    } finally {
      setUploadingDrive(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Filter */}
      <div className={`${card} p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 no-print`}>
        <div>
          <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            Rekap Bulanan Piket Gerbang
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Laporan keterlaksanaan tugas piket guru, arsip foto Google Drive, dan pengiriman notifikasi WhatsApp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-300 bg-white text-slate-800 focus:border-blue-600 outline-none"
          />

          <button
            type="button"
            onClick={fetchPhotos}
            disabled={loading}
            className={`${btn.ghost} py-1.5 px-2.5`}
            title="Muat Ulang Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={downloadExcel}
            className={`${btn.primary} bg-emerald-700 hover:bg-emerald-800 text-xs py-1.5`}
          >
            <Download className="w-3.5 h-3.5" />
            Unduh Excel (.xlsx)
          </button>

          <button
            type="button"
            onClick={uploadToGoogleDrive}
            disabled={uploadingDrive}
            className={`${btn.primary} bg-blue-700 hover:bg-blue-800 text-xs py-1.5`}
            title="Simpan berkas Excel ke folder Rekap di Google Drive sekolah"
          >
            <CloudUpload className={`w-3.5 h-3.5 ${uploadingDrive ? 'animate-spin' : ''}`} />
            {uploadingDrive ? 'Mengirim...' : 'Kirim ke Drive'}
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className={`${btn.ghost} py-1.5`}
            title="Cetak Laporan Resmi"
          >
            <Printer className="w-3.5 h-3.5" />
            Cetak
          </button>
        </div>
      </div>

      {/* KPI Ringkas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 no-print">
        <div className={`${card} p-3.5`}>
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Hari Terjadwal</div>
          <div className="text-2xl font-black text-slate-800 mt-1">{stats.totalScheduled} <span className="text-xs font-normal text-slate-500">hari</span></div>
          <div className="text-[11px] text-slate-500 mt-1">Pada bulan {monthName}</div>
        </div>

        <div className={`${card} p-3.5`}>
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Foto Dokumentasi</div>
          <div className="text-2xl font-black text-blue-700 mt-1">{stats.totalPhotos} <span className="text-xs font-normal text-slate-500">foto</span></div>
          <div className="text-[11px] text-slate-500 mt-1">Dokumentasi tersimpan</div>
        </div>

        <div className={`${card} p-3.5`}>
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tersinkron Drive</div>
          <div className="text-2xl font-black text-emerald-700 mt-1">{stats.totalDrive} <span className="text-xs font-normal text-slate-500">foto</span></div>
          <div className="text-[11px] text-slate-500 mt-1">
            {secrets.hasDriveScript ? 'Google Drive Aktif' : 'Drive Belum Diatur'}
          </div>
        </div>

        <div className={`${card} p-3.5`}>
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Keterlaksanaan Depan/Belakang</div>
          <div className="text-2xl font-black text-slate-800 mt-1">
            <span className="text-emerald-600">{stats.frontRate}%</span> / <span className="text-blue-600">{stats.backRate}%</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Realisasi per gerbang</div>
        </div>
      </div>

      {/* Navigasi Tab */}
      <div className="flex border-b border-slate-200 no-print">
        <button
          type="button"
          onClick={() => setTab('daily')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-black border-b-2 cursor-pointer transition ${
            tab === 'daily'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Rekap Harian ({dailyRecap.length} hari)
        </button>

        <button
          type="button"
          onClick={() => setTab('teacher')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-black border-b-2 cursor-pointer transition ${
            tab === 'teacher'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          Rekap Per Guru ({teacherRecap.length} guru)
        </button>
      </div>

      {/* TAB 1: REKAP HARIAN */}
      {tab === 'daily' && (
        <div className={`${card} overflow-hidden shadow-sm`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-3 w-10 text-center">No</th>
                  <th className="py-3 px-3 w-32">Tanggal & Hari</th>
                  <th className="py-3 px-4">Gerbang Depan</th>
                  <th className="py-3 px-4">Gerbang Belakang</th>
                  <th className="py-3 px-3 text-center">Foto</th>
                  <th className="py-3 px-3 text-center">Drive</th>
                  <th className="py-3 px-3 text-center">WhatsApp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {dailyRecap.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      Tidak ada jadwal atau foto pada bulan {monthName}.
                    </td>
                  </tr>
                ) : (
                  dailyRecap.map((r, i) => (
                    <tr key={r.tanggal} className="hover:bg-slate-50/60 transition">
                      <td className="py-2.5 px-3 text-center text-slate-400">{i + 1}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-800">{r.tanggal}</div>
                        <div className="text-[11px] text-slate-500">{r.hari}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800">{ctx.staffName(r.frontStaffId) || '-'}</span>
                          {r.frontStaffId && (
                            r.frontDone ? (
                              <Chip tone="ok">Hadir</Chip>
                            ) : (
                              <Chip tone="warn">Belum Foto</Chip>
                            )
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800">{ctx.staffName(r.backStaffId) || '-'}</span>
                          {r.backStaffId && (
                            r.backDone ? (
                              <Chip tone="ok">Hadir</Chip>
                            ) : (
                              <Chip tone="warn">Belum Foto</Chip>
                            )
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`font-bold ${r.photos > 0 ? 'text-blue-700' : 'text-slate-300'}`}>
                          {r.photos}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {r.drive > 0 ? (
                          <Chip tone="ok">{r.drive} file</Chip>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {r.wa > 0 ? (
                          <Chip tone="ok">{r.wa} kali</Chip>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: REKAP PER GURU */}
      {tab === 'teacher' && (
        <div className={`${card} overflow-hidden shadow-sm`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-extrabold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-3 w-10 text-center">No</th>
                  <th className="py-3 px-4">Nama Guru / Staf</th>
                  <th className="py-3 px-3 text-center">Dijadwalkan</th>
                  <th className="py-3 px-3 text-center">Terlaksana</th>
                  <th className="py-3 px-3 text-center">Persentase (%)</th>
                  <th className="py-3 px-3 text-center">Dokumentasi Foto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {teacherRecap.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      Belum ada data kegiatan guru pada bulan {monthName}.
                    </td>
                  </tr>
                ) : (
                  teacherRecap.map((t, i) => {
                    const pct = t.dijadwalkan ? Math.round((t.terlaksana / t.dijadwalkan) * 100) : 0;
                    return (
                      <tr key={t.staffId} className="hover:bg-slate-50/60 transition">
                        <td className="py-2.5 px-3 text-center text-slate-400">{i + 1}</td>
                        <td className="py-2.5 px-4 font-bold text-slate-800">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={t.nama} fotoUrl={ctx.staffObj(t.staffId)?.fotoUrl} size="sm" />
                            <span>{t.nama}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center text-slate-600 font-bold">{t.dijadwalkan} kali</td>
                        <td className="py-2.5 px-3 text-center text-emerald-700 font-bold">{t.terlaksana} kali</td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full font-black text-[11px] ${
                              pct >= 80 ? 'bg-emerald-100 text-emerald-800' : pct >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {pct}%
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-blue-700">{t.foto}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FORMAT RESMI CETAK (Hanya Muncul Saat window.print()) */}
      <div className="hidden print:block font-serif text-slate-900 p-4">
        <div className="flex items-center justify-between pb-3 border-b-2 border-black">
          {config.logoSekolahUrl && (
            <img src={config.logoSekolahUrl} alt="Logo Sekolah" className="w-16 h-16 object-contain shrink-0" />
          )}
          <div className="text-center flex-1 px-4">
            <div className="text-sm font-bold tracking-wider">PEMERINTAH KABUPATEN NGANJUK - DINAS PENDIDIKAN</div>
            <div className="text-base font-black uppercase mt-0.5">{config.schoolName}</div>
            <div className="text-xs uppercase tracking-wide mt-0.5">{config.schoolSub}</div>
            <div className="text-xs italic mt-1 font-sans">{config.documentTitle} - BULAN {monthName.toUpperCase()}</div>
          </div>
          {config.logoVisiUrl && (
            <img src={config.logoVisiUrl} alt="Logo Visi" className="w-16 h-16 object-contain shrink-0" />
          )}
        </div>

        <div className="my-4">
          <table className="w-full text-[10px] border-collapse border border-black font-sans">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-black p-1 text-center w-8">No</th>
                <th className="border border-black p-1 w-24">Tanggal</th>
                <th className="border border-black p-1 w-20">Hari</th>
                <th className="border border-black p-1">Petugas Gerbang Depan</th>
                <th className="border border-black p-1 text-center w-16">Status</th>
                <th className="border border-black p-1">Petugas Gerbang Belakang</th>
                <th className="border border-black p-1 text-center w-16">Status</th>
                <th className="border border-black p-1 text-center w-12">Foto</th>
              </tr>
            </thead>
            <tbody>
              {dailyRecap.map((r, i) => (
                <tr key={r.tanggal}>
                  <td className="border border-black p-1 text-center">{i + 1}</td>
                  <td className="border border-black p-1">{r.tanggal}</td>
                  <td className="border border-black p-1">{r.hari}</td>
                  <td className="border border-black p-1">{ctx.staffName(r.frontStaffId) || '-'}</td>
                  <td className="border border-black p-1 text-center">{r.frontDone ? 'Hadir' : '-'}</td>
                  <td className="border border-black p-1">{ctx.staffName(r.backStaffId) || '-'}</td>
                  <td className="border border-black p-1 text-center">{r.backDone ? 'Hadir' : '-'}</td>
                  <td className="border border-black p-1 text-center">{r.photos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 mt-8 text-center text-xs font-sans">
          <div>
            <div>Mengetahui,</div>
            <div className="font-bold">Kepala Sekolah</div>
            <div className="h-16" />
            <div className="font-bold underline">_________________________</div>
            <div>NIP. ........................................</div>
          </div>
          <div>
            <div>Rejoso, {formatIndonesianDate(localDateISO())}</div>
            <div className="font-bold">Koordinator Piket Gerbang</div>
            <div className="h-16" />
            <div className="font-bold underline">{coordinator ? coordinator.nama : '_________________________'}</div>
            <div>{coordinator ? coordinator.jabatan : 'NIP. ........................................'}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

