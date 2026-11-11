import { formatIndonesianDate } from '../../shared/piket.ts';

/** Muat berkas gambar (kamera/galeri) → HTMLImageElement, memperhatikan orientasi EXIF modern. */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Berkas bukan gambar yang valid.'));
    };
    img.src = url;
  });
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Pilih berkas gambar (JPG/PNG/WEBP/HEIC/SVG).';
  if (file.size > 25 * 1024 * 1024) return 'Ukuran foto terlalu besar (maks. 25 MB).';
  return null;
}

/** Perkecil foto agar hemat kuota & cepat terunggah (sisi terpanjang ≤ maxSide, JPEG). */
export async function compressImage(file: Blob, maxSide = 1280, quality = 0.82): Promise<string> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Peramban tidak mendukung pemrosesan gambar.');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/** Kompresi foto profil guru / logo sekolah (persegi, ringan ~240px) */
export async function compressAvatar(file: Blob, size = 240, quality = 0.85): Promise<string> {
  const img = await loadImage(file);
  const minDim = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - minDim) / 2;
  const sy = (img.naturalHeight - minDim) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Peramban tidak mendukung pemrosesan gambar.');
  ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
  return canvas.toDataURL(file.type.includes('png') ? 'image/png' : 'image/jpeg', quality);
}

export async function makeThumb(dataUrl: string, side = 220): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return compressImage(blob, side, 0.6);
}

export interface CardInfo {
  schoolName: string;
  staffNama: string;
  tanggal: string;
  waktu: string;
  lokasi: string;
  kondisi: string;
  keterangan: string;
  sumber: 'kamera' | 'galeri';
  logoSekolahUrl?: string;
  teacherPhotoUrl?: string;
}

/** Gabungkan foto + banner data piket menjadi satu kartu laporan resmi */
export async function renderReportCard(photoDataUrl: string, info: CardInfo): Promise<string> {
  const blob = await (await fetch(photoDataUrl)).blob();
  const img = await loadImage(blob);
  const width = 900;
  const photoH = 600;
  const footerH = 175;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = photoH + footerH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return photoDataUrl;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, photoH + footerH);

  // object-fit: cover untuk foto utama
  const ir = img.naturalWidth / img.naturalHeight;
  const tr = width / photoH;
  let dw = width;
  let dh = photoH;
  let ox = 0;
  let oy = 0;
  if (ir > tr) {
    dw = photoH * ir;
    ox = -(dw - width) / 2;
  } else {
    dh = width / ir;
    oy = -(dh - photoH) / 2;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, photoH);
  ctx.clip();
  ctx.drawImage(img, ox, oy, dw, dh);
  const g = ctx.createLinearGradient(0, 0, 0, 90);
  g.addColorStop(0, 'rgba(15,23,42,0.82)');
  g.addColorStop(1, 'rgba(15,23,42,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, 90);
  ctx.restore();

  // Badge Lokasi Gerbang
  const front = info.lokasi === 'Gerbang Depan';
  ctx.fillStyle = front ? '#1d4ed8' : '#047857';
  ctx.beginPath();
  ctx.roundRect(22, 18, 290, 38, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText(info.lokasi.toUpperCase(), 38, 42);

  // Badge Waktu WIB
  ctx.fillStyle = 'rgba(15,23,42,0.85)';
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(width - 235, 18, 213, 38, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fde047';
  ctx.font = 'bold 16px monospace';
  ctx.fillText(info.waktu, width - 220, 42);

  // Banner Footer Laporan
  const fg = ctx.createLinearGradient(0, photoH, width, photoH + footerH);
  fg.addColorStop(0, '#1e3a8a');
  fg.addColorStop(0.55, '#0f172a');
  fg.addColorStop(1, '#1e293b');
  ctx.fillStyle = fg;
  ctx.fillRect(0, photoH, width, footerH);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(0, photoH, width, 5);

  let textX = 26;

  // Render logo sekolah jika tersedia
  if (info.logoSekolahUrl) {
    try {
      const schoolLogo = await loadImageFromUrl(info.logoSekolahUrl);
      if (schoolLogo) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(62, photoH + 85, 38, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.clip();
        ctx.drawImage(schoolLogo, 24, photoH + 47, 76, 76);
        ctx.restore();
        textX = 118;
      }
    } catch {
      /* abaikan bila gagal render logo */
    }
  }

  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillText(`LAPORAN DOKUMENTASI PIKET GURU • ${info.schoolName.toUpperCase()}`, textX, photoH + 28);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(info.staffNama, textX, photoH + 60);
  ctx.fillStyle = '#bfdbfe';
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillText(`${formatIndonesianDate(info.tanggal)}  |  Pukul ${info.waktu}  |  Kondisi: ${info.kondisi}`, textX, photoH + 90);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(`Catatan: ${(info.keterangan || '-').slice(0, 105)}`, textX, photoH + 120);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px monospace';
  ctx.fillText(`Sumber foto: ${info.sumber === 'kamera' ? 'kamera langsung' : 'galeri perangkat'}`, textX, photoH + 148);

  return canvas.toDataURL('image/jpeg', 0.88);
}
