/**
 * Google Apps Script - Penyimpanan Foto Piket Gerbang ke Google Drive sekolah + Rekap (Google Sheets)
 *
 * CARA PASANG (sekali saja, dengan akun Google sekolah):
 *  1. Buka https://script.google.com  >  Proyek baru  >  hapus isi, tempel seluruh berkas ini.
 *  2. Ganti nilai SECRET di bawah dengan kunci rahasia buatan sendiri (min. 12 karakter, acak).
 *  3. (Opsional) Isi ROOT_FOLDER_ID bila ingin memakai folder Drive yang sudah ada
 *     (ID = bagian akhir URL folder). Jika kosong, folder "Piket Gerbang - <Nama Sekolah>" dibuat otomatis.
 *  4. Klik Terapkan (Deploy) > Deployment baru > Jenis: Aplikasi web
 *        - Jalankan sebagai : Saya (akun sekolah)
 *        - Yang memiliki akses : Siapa saja (Anyone)
 *     Setujui izin Drive & Spreadsheet saat diminta.
 *  5. Salin "URL aplikasi web" (https://script.google.com/macros/s/.../exec).
 *  6. Di aplikasi Piket Gerbang: Pengaturan > Google Drive > tempel URL & SECRET yang sama > Simpan > Uji Koneksi.
 *
 * Struktur hasil di Drive:
 *   Piket Gerbang - <Sekolah>/
 *     <Tahun>/<MM - Bulan>/<YYYY-MM-DD (Hari)>/ foto-foto piket (bertambah, tidak menimpa)
 *     <Tahun>/<MM>/Rekap/ berkas rekap Excel bulanan
 *     Rekap Piket Gerbang (Google Sheets, satu tab per bulan, tiap foto = 1 baris + tautan)
 */

const SECRET = 'GANTI_DENGAN_KUNCI_RAHASIA_ANDA';
const ROOT_FOLDER_ID = '';

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!SECRET || SECRET.indexOf('GANTI_') === 0) return out_({ ok: false, error: 'SECRET di skrip belum diganti.' });
    if (!safeEq_(String(req.secret || ''), SECRET)) return out_({ ok: false, error: 'Kunci rahasia salah.' });

    const root = rootFolder_(String(req.schoolName || 'Sekolah'));
    switch (req.action) {
      case 'ping':
        return out_({ ok: true, message: 'Terhubung ke Google Drive sekolah.', folderUrl: root.getUrl() });
      case 'uploadPhoto':
        return out_(uploadPhoto_(root, req));
      case 'uploadRecap':
        return out_(uploadRecap_(root, req));
      default:
        return out_({ ok: false, error: 'Aksi tidak dikenal.' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return out_({ ok: true, app: 'piket-gerbang-drive', message: 'Skrip aktif. Gunakan dari aplikasi Piket Gerbang.' });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeEq_(a, b) {
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function rootFolder_(schoolName) {
  if (ROOT_FOLDER_ID) return DriveApp.getFolderById(ROOT_FOLDER_ID);
  const name = 'Piket Gerbang - ' + schoolName;
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function ensurePath_(root, parts) {
  var cur = root;
  (parts || []).forEach(function (p) {
    const name = String(p).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
    const it = cur.getFoldersByName(name);
    cur = it.hasNext() ? it.next() : cur.createFolder(name);
  });
  return cur;
}

function uploadPhoto_(root, req) {
  const folder = ensurePath_(root, req.folderPath);
  const name = String(req.fileName || 'foto.jpg');
  // Idempoten: bila berkas bernama sama sudah ada (percobaan ulang), jangan duplikat.
  const existing = folder.getFilesByName(name);
  let file;
  if (existing.hasNext()) {
    file = existing.next();
  } else {
    const bytes = Utilities.base64Decode(String(req.base64 || ''));
    file = folder.createFile(Utilities.newBlob(bytes, String(req.mimeType || 'image/jpeg'), name));
  }
  try {
    appendRecapRow_(root, req.meta || {}, file.getUrl(), folder.getUrl());
  } catch (err) {
    // Foto sudah aman di Drive; kegagalan rekap tidak menggagalkan unggahan.
  }
  return { ok: true, fileUrl: file.getUrl(), folderUrl: folder.getUrl() };
}

function recapSpreadsheet_(root) {
  const name = 'Rekap Piket Gerbang';
  const it = root.getFilesByName(name);
  while (it.hasNext()) {
    const f = it.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS) return SpreadsheetApp.openById(f.getId());
  }
  const ss = SpreadsheetApp.create(name);
  const f = DriveApp.getFileById(ss.getId());
  root.addFile(f);
  DriveApp.getRootFolder().removeFile(f);
  return ss;
}

function appendRecapRow_(root, meta, fileUrl, folderUrl) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = recapSpreadsheet_(root);
    const tab = String(meta.tanggal || '').slice(0, 7) || 'Lainnya';
    let sh = ss.getSheetByName(tab);
    if (!sh) {
      sh = ss.insertSheet(tab);
      sh.appendRow(['Tanggal', 'Hari', 'Waktu', 'Lokasi', 'Guru Piket', 'Kondisi', 'Keterangan', 'Sumber Foto', 'Foto (Drive)', 'ID']);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#047857').setFontColor('#ffffff');
      const first = ss.getSheetByName('Sheet1') || ss.getSheetByName('Sheet 1') || ss.getSheetByName('Lembar1');
      if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
    }
    const id = String(meta.id || '');
    if (id && sh.getLastRow() > 1) {
      const ids = sh.getRange(2, 10, sh.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return; // sudah tercatat
    }
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const parts = String(meta.tanggal || '').split('-');
    const hari = parts.length === 3 ? days[new Date(+parts[0], +parts[1] - 1, +parts[2]).getDay()] : '';
    sh.appendRow([
      meta.tanggal || '', hari, meta.waktu || '', meta.lokasi || '', meta.staffNama || '',
      meta.kondisi || '', meta.keterangan || '', meta.sumber || '', '', id,
    ]);
    const row = sh.getLastRow();
    sh.getRange(row, 9).setFormula('=HYPERLINK("' + fileUrl + '";"Buka foto")');
  } finally {
    lock.releaseLock();
  }
}

function uploadRecap_(root, req) {
  const folder = ensurePath_(root, req.folderPath);
  const name = String(req.fileName || 'Rekap.xlsx');
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true); // versi terbaru menggantikan versi lama
  const bytes = Utilities.base64Decode(String(req.base64 || ''));
  const file = folder.createFile(
    Utilities.newBlob(bytes, String(req.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), name)
  );
  return { ok: true, fileUrl: file.getUrl(), folderUrl: folder.getUrl() };
}

