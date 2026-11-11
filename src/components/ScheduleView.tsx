import React, { useEffect, useMemo, useState } from 'react';
import { Lock, Pencil, Plus, Printer, Save, Trash2, Wand2 } from 'lucide-react';
import type { Assignment, ReplacementReason } from '../../shared/types.ts';
import { REPLACEMENT_REASONS } from '../../shared/types.ts';
import { dayNameOf, formatIndonesianDate, generateMonthlySchedule, localDateISO } from '../../shared/piket.ts';
import { api } from '../lib/api.ts';
import type { AppCtx } from '../lib/ctx.ts';
import { Avatar, Chip, Modal, btn, card, input } from './ui.tsx';

type Side = 'front' | 'back';

export const ScheduleView: React.FC<{ ctx: AppCtx }> = ({ ctx }) => {
  const { config, staff } = ctx;
  const [month, setMonth] = useState(localDateISO().slice(0, 7));
  const [draft, setDraft] = useState<Assignment[]>(ctx.schedule);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(ctx.schedule);
  }, [ctx.schedule, dirty]);

  const rows = useMemo(() => draft.filter((a) => a.tanggal.startsWith(month)).sort((a, b) => a.tanggal.localeCompare(b.tanggal)), [draft, month]);
  const coordinator = staff.find((s) => s.id === config.coordinatorStaffId);

  const change = (next: Assignment[]) => {
    setDraft(next);
    setDirty(true);
  };

  const generate = async () => {
    if (!(await ctx.requireAdmin())) return;
    if (staff.length === 0) return ctx.notify('err', 'Daftar guru masih kosong. Isi di menu Pengaturan.');
    if (rows.length && !window.confirm(`Jadwal ${month} yang ada (${rows.length} hari) akan diganti dengan jadwal baru. Lanjutkan?`)) return;
    // lanjutkan rotasi dari guru terakhir bulan sebelumnya agar bergilir merata
    const before = draft.filter((a) => a.tanggal < `${month}-01`).sort((a, b) => b.tanggal.localeCompare(a.tanggal))[0];
    const lastIdx = before ? staff.findIndex((s) => s.id === before.backStaffId) : -1;
    const gen = generateMonthlySchedule(month, staff, config, lastIdx >= 0 ? lastIdx + 1 : 0);
    if (!gen.length) return ctx.notify('err', 'Tidak ada hari kerja pada bulan ini (periksa hari kerja & libur di Pengaturan).');
    change([...draft.filter((a) => !a.tanggal.startsWith(month)), ...gen]);
    ctx.notify('info', `Jadwal ${gen.length} hari dibuat. Klik "Simpan Jadwal" untuk menyimpan.`);
  };

  const save = async () => {
    if (!(await ctx.requireAdmin())) return;
    setSaving(true);
    try {
      await api.saveSchedule(draft);
      setDirty(false);
      await ctx.reload();
      ctx.notify('ok', 'Jadwal piket tersimpan.');
    } catch (e) {
      ctx.notify('err', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addDay = async () => {
    if (!(await ctx.requireAdmin())) return;
    const d = window.prompt('Tambah tanggal piket (format YYYY-MM-DD):', `${month}-01`);
    if (!d) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return ctx.notify('err', 'Format tanggal tidak valid.');
    if (draft.some((a) => a.tanggal === d)) return ctx.notify('err', 'Tanggal itu sudah ada di jadwal.');
    const a: Assignment = { id: `picket-${d}`, tanggal: d, hari: dayNameOf(d), frontStaffId: '', backStaffId: '' };
    change([...draft, a]);
    setMonth(d.slice(0, 7));
    setEditing(a);
  };

  const applyEdit = (a: Assignment) => {
    change(draft.map((x) => (x.tanggal === a.tanggal ? a : x)));
    setEditing(null);
  };

  return (
    <div className="space-y-5">
      <div className={`${card} p-4 flex flex-wrap items-center gap-3 no-print`}>
        <input type="month" className={`${input} !w-auto`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Bulan" />
        <span className="text-xs font-bold text-slate-500">{rows.length} hari piket</span>
        <div className="flex-1" />
        {ctx.isAdmin ? (
          <>
            <button type="button" className={btn.ghost} onClick={generate}>
              <Wand2 className="w-3.5 h-3.5" /> Buat Jadwal Bulan Ini
            </button>
            <button type="button" className={btn.ghost} onClick={addDay}>
              <Plus className="w-3.5 h-3.5" /> Tambah Hari
            </button>
            <button type="button" className={btn.primary} onClick={save} disabled={!dirty || saving}>
              <Save className="w-3.5 h-3.5" /> {saving ? 'Menyimpan…' : dirty ? 'Simpan Jadwal*' : 'Tersimpan'}
            </button>
          </>
        ) : (
          <button type="button" className={btn.ghost} onClick={() => ctx.requireAdmin()}>
            <Lock className="w-3.5 h-3.5" /> Masuk Admin untuk mengubah
          </button>
        )}
        <button type="button" className={btn.ghost} onClick={() => window.print()}>
          <Printer className="w-3.5 h-3.5" /> Cetak
        </button>
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="hidden print:block text-center p-4 border-b-2 border-slate-900">
          <h1 className="text-base font-black uppercase">{config.documentTitle}</h1>
          <p className="text-xs">{config.schoolName} — Bulan {month}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-[11px] uppercase font-bold text-slate-500 border-b border-slate-200">
                <th className="py-3 px-4 w-10">No</th>
                <th className="py-3 px-4">Hari, Tanggal</th>
                <th className="py-3 px-4">Gerbang Depan</th>
                <th className="py-3 px-4">Gerbang Belakang</th>
                <th className="py-3 px-4 no-print w-24 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-xs text-slate-400">
                    Belum ada jadwal pada bulan ini.
                  </td>
                </tr>
              )}
              {rows.map((a, i) => (
                <tr key={a.tanggal} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 text-xs text-slate-400 font-bold">{i + 1}</td>
                  <td className="py-2.5 px-4 font-bold text-slate-800">{formatIndonesianDate(a.tanggal)}</td>
                  {(['front', 'back'] as Side[]).map((side) => {
                    const orig = side === 'front' ? a.frontStaffId : a.backStaffId;
                    const rep = side === 'front' ? a.frontReplacementId : a.backReplacementId;
                    const reason = side === 'front' ? a.frontReplacementReason : a.backReplacementReason;
                    return (
                      <td key={side} className="py-2.5 px-4">
                        {rep ? (
                          <div className="flex items-center gap-2.5">
                            <Avatar name={ctx.staffName(rep)} fotoUrl={ctx.staffObj(rep)?.fotoUrl} size="sm" />
                            <div>
                              <span className="line-through text-slate-400 text-xs block leading-tight">{ctx.staffName(orig)}</span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-slate-800">{ctx.staffName(rep)}</span>
                                <Chip tone="warn">Pengganti: {reason}</Chip>
                              </div>
                            </div>
                          </div>
                        ) : orig ? (
                          <div className="flex items-center gap-2.5">
                            <Avatar name={ctx.staffName(orig)} fotoUrl={ctx.staffObj(orig)?.fotoUrl} size="sm" />
                            <span className="font-bold text-slate-800">{ctx.staffName(orig)}</span>
                          </div>
                        ) : (
                          <em className="text-rose-500 text-xs">belum diisi</em>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-2.5 px-4 text-right no-print whitespace-nowrap">
                    {ctx.isAdmin && (
                      <>
                        <button type="button" className={btn.ghost} onClick={() => setEditing(a)} aria-label="Ubah">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>{' '}
                        <button type="button" className={btn.danger} onClick={() => change(draft.filter((x) => x.tanggal !== a.tanggal))} aria-label="Hapus">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hidden print:flex justify-end p-8 text-xs">
          <div className="text-center">
            <p>Koordinator Piket</p>
            <div className="h-16" />
            <p className="font-bold underline">{coordinator?.nama || '………………………'}</p>
          </div>
        </div>
      </div>

      {editing && <EditModal a={editing} ctx={ctx} onClose={() => setEditing(null)} onApply={applyEdit} />}
    </div>
  );
};

const EditModal: React.FC<{ a: Assignment; ctx: AppCtx; onClose: () => void; onApply: (a: Assignment) => void }> = ({ a, ctx, onClose, onApply }) => {
  const [v, setV] = useState<Assignment>(a);
  const opts = ctx.staff.map((s) => (
    <option key={s.id} value={s.id}>
      {s.nama}
    </option>
  ));
  const set = <K extends keyof Assignment>(k: K, val: Assignment[K]) => setV((p) => ({ ...p, [k]: val }));

  const block = (side: Side, title: string) => {
    const idK = `${side}StaffId` as const;
    const repId = `${side}ReplacementId` as const;
    const repReason = `${side}ReplacementReason` as const;
    const repNotes = `${side}ReplacementNotes` as const;
    return (
      <div className="rounded-2xl border border-slate-200 p-3 space-y-2">
        <p className="text-xs font-black text-slate-700">{title}</p>
        <select className={input} value={v[idK]} onChange={(e) => set(idK, e.target.value)}>
          <option value="">— pilih guru —</option>
          {opts}
        </select>
        <p className="text-[11px] font-bold text-slate-500">Pengganti (dinas luar / izin / sakit / tukar jadwal) — opsional</p>
        <select className={input} value={v[repId] || ''} onChange={(e) => setV((p) => ({ ...p, [repId]: e.target.value || undefined, [repReason]: e.target.value ? p[repReason] || 'Tugas Luar / Dinas Luar' : undefined }))}>
          <option value="">— tanpa pengganti —</option>
          {opts}
        </select>
        {v[repId] && (
          <>
            <select className={input} value={v[repReason] || 'Lainnya'} onChange={(e) => set(repReason, e.target.value as ReplacementReason)}>
              {REPLACEMENT_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <input className={input} placeholder="Keterangan (opsional)" maxLength={200} value={v[repNotes] || ''} onChange={(e) => set(repNotes, e.target.value)} />
          </>
        )}
      </div>
    );
  };

  return (
    <Modal title={`Ubah Jadwal — ${formatIndonesianDate(a.tanggal)}`} onClose={onClose}>
      <div className="space-y-3">
        {block('front', 'Gerbang Depan')}
        {block('back', 'Gerbang Belakang')}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>
            Batal
          </button>
          <button type="button" className={btn.primary} onClick={() => onApply(v)}>
            Terapkan
          </button>
        </div>
      </div>
    </Modal>
  );
};

