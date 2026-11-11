import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { PhotoMeta } from '../../shared/types.ts';
import { GATES } from '../../shared/types.ts';
import { localDateISO } from '../../shared/piket.ts';
import { api } from '../lib/api.ts';
import type { AppCtx } from '../lib/ctx.ts';
import { PhotoCard } from './PhotoCard.tsx';
import { btn, card, input } from './ui.tsx';

export const GalleryView: React.FC<{ ctx: AppCtx }> = ({ ctx }) => {
  const [month, setMonth] = useState(localDateISO().slice(0, 7));
  const [gate, setGate] = useState('all');
  const [q, setQ] = useState('');
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPhotos((await api.photosByMonth(month)).photos);
    } catch (e) {
      ctx.notify('err', (e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return photos
      .filter((p) => (gate === 'all' ? true : p.lokasi === gate))
      .filter((p) => !s || p.staffNama.toLowerCase().includes(s) || p.keterangan.toLowerCase().includes(s))
      .sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.waktu.localeCompare(a.waktu));
  }, [photos, gate, q]);

  const groups = useMemo(() => {
    const m = new Map<string, PhotoMeta[]>();
    for (const p of list) m.set(p.tanggal, [...(m.get(p.tanggal) || []), p]);
    return [...m.entries()];
  }, [list]);

  return (
    <div className="space-y-5">
      <div className={`${card} p-4 flex flex-wrap items-center gap-3`}>
        <input type="month" className={`${input} !w-auto`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Bulan" />
        <select className={`${input} !w-auto`} value={gate} onChange={(e) => setGate(e.target.value)} aria-label="Lokasi">
          <option value="all">Semua lokasi</option>
          {GATES.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <div className="relative flex-1 min-w-48">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className={`${input} pl-9`} placeholder="Cari nama guru / catatan…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" className={btn.ghost} onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Muat ulang
        </button>
        <span className="text-xs font-bold text-slate-500">{list.length} foto</span>
      </div>

      {groups.length === 0 && <div className={`${card} p-10 text-center text-xs text-slate-500`}>{loading ? 'Memuat…' : 'Tidak ada foto pada filter ini.'}</div>}

      {groups.map(([date, items]) => (
        <section key={date}>
          <h3 className="text-xs font-black text-slate-700 mb-2">{new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ({items.length})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((p) => (
              <PhotoCard
                key={p.id}
                photo={p}
                ctx={ctx}
                onChanged={(np) => setPhotos((prev) => (np ? prev.map((x) => (x.id === np.id ? np : x)) : prev.filter((x) => x.id !== p.id)))}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

