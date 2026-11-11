import React, { useState } from 'react';
import { Cloud, Download, Eye, MessageCircle, Trash2 } from 'lucide-react';
import type { PhotoMeta } from '../../shared/types.ts';
import { formatIndonesianDate } from '../../shared/piket.ts';
import { api } from '../lib/api.ts';
import type { AppCtx } from '../lib/ctx.ts';
import { AuthImage, Avatar, Chip, Modal, btn } from './ui.tsx';

interface Props {
  photo: PhotoMeta;
  ctx: AppCtx;
  onChanged: (p: PhotoMeta | null) => void;
}

export const PhotoCard: React.FC<Props> = ({ photo, ctx, onChanged }) => {
  const [busy, setBusy] = useState<'drive' | 'wa' | 'del' | null>(null);
  const [open, setOpen] = useState(false);
  const { config } = ctx;

  const send = async (kind: 'drive' | 'wa') => {
    setBusy(kind);
    try {
      const r = await api.dispatch(kind, photo.id, photo.tanggal);
      onChanged(r.photo);
      ctx.notify(r.result.ok ? 'ok' : 'err', r.result.message);
    } catch (e) {
      ctx.notify('err', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!(await ctx.requireAdmin())) return;
    if (!window.confirm(`Hapus foto piket ${photo.staffNama} (${photo.lokasi}, ${photo.tanggal}) dari aplikasi?\nSalinan di Google Drive/WhatsApp tidak ikut terhapus.`)) return;
    setBusy('del');
    try {
      await api.deletePhoto(photo.id, photo.tanggal);
      onChanged(null);
      ctx.notify('ok', 'Foto dihapus.');
    } catch (e) {
      ctx.notify('err', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    try {
      const url = await api.fetchPhotoBlobUrl(photo.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = photo.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      ctx.notify('err', (e as Error).message);
    }
  };

  const driveChip = photo.driveUrl ? (
    <a href={photo.driveUrl} target="_blank" rel="noopener noreferrer">
      <Chip tone="ok">Drive ✓</Chip>
    </a>
  ) : photo.driveError ? (
    <Chip tone="bad" title={photo.driveError}>
      Drive ✗
    </Chip>
  ) : (
    <Chip tone="off">{config.driveEnabled ? 'Drive: menunggu' : 'Drive: nonaktif'}</Chip>
  );
  const waChip = photo.waAt ? (
    <Chip tone="ok">WA ✓</Chip>
  ) : photo.waError ? (
    <Chip tone="bad" title={photo.waError}>
      WA ✗
    </Chip>
  ) : (
    <Chip tone="off">{config.waEnabled ? 'WA: menunggu' : 'WA: nonaktif'}</Chip>
  );

  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
        <button type="button" onClick={() => setOpen(true)} className="relative aspect-[4/3] bg-slate-100 cursor-pointer group" aria-label="Lihat foto">
          {photo.thumb ? (
            <img src={photo.thumb} alt={`Piket ${photo.staffNama}`} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">Tanpa pratinjau</div>
          )}
          <span className="absolute top-2 left-2 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-black/60 text-white">{photo.lokasi}</span>
          <span className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
            <Eye className="w-6 h-6 text-white" />
          </span>
        </button>
        <div className="p-3 space-y-2 flex-1">
          <div className="flex items-center gap-2.5">
            <Avatar name={photo.staffNama} fotoUrl={ctx.staffObj(photo.staffId)?.fotoUrl} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black text-slate-800 leading-snug truncate">{photo.staffNama}</p>
              <p className="text-[10px] text-slate-500 truncate">
                {formatIndonesianDate(photo.tanggal)} • {photo.waktu}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
            <span>{photo.kondisi}</span>
            <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
              {photo.sumber === 'kamera' ? 'Kamera' : 'Galeri'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {driveChip}
            {waChip}
          </div>
        </div>
        <div className="px-3 pb-3 flex flex-wrap gap-1.5">
          {config.driveEnabled && !photo.driveUrl && (
            <button type="button" className={btn.ghost} disabled={busy !== null} onClick={() => send('drive')}>
              <Cloud className="w-3.5 h-3.5" /> {busy === 'drive' ? 'Mengirim…' : 'Ke Drive'}
            </button>
          )}
          {config.waEnabled && !photo.waAt && (
            <button type="button" className={btn.ghost} disabled={busy !== null} onClick={() => send('wa')}>
              <MessageCircle className="w-3.5 h-3.5" /> {busy === 'wa' ? 'Mengirim…' : 'Ke WA'}
            </button>
          )}
          <button type="button" className={btn.ghost} onClick={download} aria-label="Unduh foto">
            <Download className="w-3.5 h-3.5" />
          </button>
          {ctx.isAdmin && (
            <button type="button" className={btn.danger} disabled={busy !== null} onClick={remove} aria-label="Hapus foto">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {open && (
        <Modal title={`${photo.staffNama} — ${photo.lokasi}`} onClose={() => setOpen(false)} wide>
          <AuthImage id={photo.id} alt={`Piket ${photo.staffNama}`} className="w-full rounded-2xl" />
          <p className="mt-3 text-xs text-slate-600">{photo.keterangan || '-'}</p>
          {photo.localPath && <p className="mt-1 text-[11px] text-slate-400 break-all">Arsip lokal: {photo.localPath}</p>}
          {photo.driveUrl && (
            <a href={photo.driveUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-bold text-blue-700 underline">
              Buka di Google Drive
            </a>
          )}
        </Modal>
      )}
    </>
  );
};

