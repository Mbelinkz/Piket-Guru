import React, { useEffect, useState } from 'react';
import { User, X } from 'lucide-react';
import { api } from '../lib/api.ts';

export const btn = {
  primary:
    'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-600 hover:from-blue-800 hover:via-blue-700 hover:to-indigo-700 text-white text-xs font-black shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-98',
  green:
    'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-black shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-98',
  ghost:
    'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100/80 hover:bg-slate-200/90 text-slate-700 text-xs font-bold transition-all duration-200 disabled:opacity-50 cursor-pointer active:scale-98 border border-slate-200/60',
  danger:
    'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100/90 text-rose-700 border border-rose-200 text-xs font-bold transition-all duration-200 disabled:opacity-50 cursor-pointer active:scale-98',
};

export const input =
  'w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200/90 bg-white/90 backdrop-blur-xs focus:border-blue-600 focus:ring-3 focus:ring-blue-600/15 shadow-2xs outline-none transition-all';

export const card =
  'bg-white/85 backdrop-blur-md rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all duration-300';

/* ---- Palet Gradien Elegan untuk Inisial Avatar ---- */
const AVATAR_GRADIENTS = [
  'from-blue-600 to-indigo-600',
  'from-emerald-600 to-teal-600',
  'from-violet-600 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-sky-500 to-cyan-600',
  'from-indigo-600 to-cyan-600',
  'from-fuchsia-600 to-rose-600',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  if (!name) return '??';
  // Hapus gelar umum agar inisial fokus pada nama guru
  const cleaned = name
    .replace(/(,\s*(S\.Pd|M\.Pd|S\.Ag|M\.Ag|S\.Kom|M\.Kom|S\.E|M\.M|A\.Ma|Drs|Dra|H|Hj)\.?.*)/gi, '')
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Komponen Avatar Elegan: Menampilkan foto profil guru atau inisial bergradien modern */
export const Avatar: React.FC<{
  name: string;
  fotoUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}> = ({ name, fotoUrl, size = 'md', className = '' }) => {
  const [imgError, setImgError] = useState(false);
  const initials = getInitials(name);
  const gradIdx = hashString(name || 'guru') % AVATAR_GRADIENTS.length;
  const gradient = AVATAR_GRADIENTS[gradIdx];

  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-xs font-black',
    lg: 'w-12 h-12 text-sm font-black',
    xl: 'w-16 h-16 text-base font-black',
  }[size];

  if (fotoUrl && !imgError) {
    return (
      <img
        src={fotoUrl}
        alt={name}
        onError={() => setImgError(true)}
        className={`${sizeClasses} rounded-full object-cover shrink-0 ring-2 ring-white shadow-xs ${className}`}
      />
    );
  }

  return (
    <div
      title={name}
      className={`${sizeClasses} rounded-full bg-gradient-to-tr ${gradient} flex items-center justify-center text-white font-extrabold shrink-0 ring-2 ring-white/90 shadow-xs select-none ${className}`}
    >
      {initials}
    </div>
  );
};

export const Modal: React.FC<{ title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }> = ({
  title,
  onClose,
  wide,
  children,
}) => (
  <div
    className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 no-print animate-in fade-in duration-200"
    role="dialog"
    aria-modal="true"
    onMouseDown={(e) => e.target === e.currentTarget && onClose()}
  >
    <div
      className={`bg-white/95 backdrop-blur-lg w-full ${
        wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
      } max-h-[94vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100`}
    >
      <div className="sticky top-0 bg-white/90 backdrop-blur px-5 py-3.5 border-b border-slate-100 flex items-center justify-between z-10">
        <h3 className="text-sm font-black text-slate-800 tracking-tight">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 cursor-pointer transition"
          aria-label="Tutup"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);

export type ToastKind = 'ok' | 'err' | 'info';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

export const ToastStack: React.FC<{ items: ToastItem[]; onDismiss: (id: number) => void }> = ({ items, onDismiss }) => (
  <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] space-y-2 sm:w-96 no-print">
    {items.map((t) => (
      <div
        key={t.id}
        onClick={() => onDismiss(t.id)}
        className={`px-4 py-3 rounded-2xl text-xs font-bold shadow-xl cursor-pointer text-white flex items-center gap-2 transition-all hover:scale-102 ${
          t.kind === 'ok'
            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 shadow-emerald-500/20'
            : t.kind === 'err'
            ? 'bg-gradient-to-r from-rose-600 to-red-600 shadow-rose-500/20'
            : 'bg-gradient-to-r from-slate-800 to-slate-900 shadow-slate-900/20'
        }`}
      >
        <span>{t.text}</span>
      </div>
    ))}
  </div>
);

export const Chip: React.FC<{ tone: 'ok' | 'warn' | 'bad' | 'off'; children: React.ReactNode; title?: string }> = ({
  tone,
  children,
  title,
}) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-2xs ${
      tone === 'ok'
        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        : tone === 'warn'
        ? 'bg-amber-50 text-amber-700 border border-amber-200'
        : tone === 'bad'
        ? 'bg-rose-50 text-rose-700 border border-rose-200'
        : 'bg-slate-100 text-slate-600 border border-slate-200'
    }`}
  >
    {children}
  </span>
);

/** Gambar yang memerlukan header otorisasi → dimuat via fetch lalu dijadikan blob URL. */
export const AuthImage: React.FC<{ id: string; alt: string; className?: string }> = ({ id, alt, className }) => {
  const [src, setSrc] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let url = '';
    let cancelled = false;
    api
      .fetchPhotoBlobUrl(id)
      .then((u) => {
        url = u;
        if (!cancelled) setSrc(u);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [id]);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 text-slate-400 text-xs ${className}`}>
        Gambar tidak tersedia
      </div>
    );
  }
  if (!src) {
    return <div className={`animate-pulse bg-slate-200 ${className}`} />;
  }
  return <img src={src} alt={alt} className={className} />;
};
