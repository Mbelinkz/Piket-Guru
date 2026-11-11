import assert from 'node:assert/strict';
import { createApiHandler, createLimiter, type Kv } from '../shared/api-core.ts';
import {
  buildFileName,
  buildMonthRecap,
  buildTeacherRecap,
  buildWaMessage,
  dutyStaffId,
  folderPathFor,
  formatIndonesianDate,
  generateMonthlySchedule,
  sanitizeConfig,
  sanitizePhotoUpload,
  sanitizeSchedule,
} from '../shared/piket.ts';
import { DEFAULT_CONFIG, type Assignment, type PhotoMeta, type Staff } from '../shared/types.ts';
import {
  createSupabaseKv,
  getSupabaseSchemaSql,
  isValidSupabaseUrl,
  testSupabase,
} from '../shared/supabase.ts';

let pass = 0;
let failed = 0;
const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (n: string, f: () => Promise<void> | void) => tests.push([n, f]);

const memKv = (): Kv & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(k: string) {
      return data.has(k) ? (JSON.parse(JSON.stringify(data.get(k))) as T) : null;
    },
    async set(k, v) {
      data.set(k, JSON.parse(JSON.stringify(v)));
    },
    async delete(k) {
      data.delete(k);
    },
    async list(p) {
      return [...data.keys()].filter((k) => k.startsWith(p));
    },
  };
};

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD'; // cukup untuk validasi format
const H = (code = 'kode-guru-1', pin?: string) => ({
  'x-access-code': code,
  'content-type': 'application/json',
  ...(pin ? { 'x-admin-pin': pin } : {}),
});
const URL_ = (q: string) => `https://x.test/api/piket?${q}`;

function setup(over: { fetchImpl?: any; hooks?: any } = {}) {
  const kv = memKv();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl =
    over.fetchImpl ??
    (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('fonnte.com/send')) return new Response(JSON.stringify({ status: true }));
      if (url.includes('get-whatsapp-group')) return new Response(JSON.stringify({ status: true, data: [{ id: '1@g.us', name: 'Dewan Guru' }] }));
      if (url.includes('fetch-group')) return new Response('{}');
      if (url.includes('script.google.com')) {
        const body = JSON.parse(String(init?.body));
        if (body.secret !== 'drive-secret') return new Response(JSON.stringify({ ok: false, error: 'Kunci rahasia salah.' }));
        return new Response(JSON.stringify({ ok: true, fileUrl: 'https://drive.google.com/file/d/ABC/view', folderUrl: 'https://drive.google.com/drive/folders/F' }));
      }
      if (url.includes('supabase.co')) {
        if (init?.headers && (init.headers as any).apikey === 'bad-key') {
          return new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 });
        }
        if (url.includes('/rest/v1/piket_kv')) {
          if (init?.method === 'POST') return new Response(JSON.stringify([{ key: 'k' }]), { status: 201 });
          if (init?.method === 'DELETE') return new Response(null, { status: 204 });
          return new Response(JSON.stringify([{ value: { test: 123 }, key: 'test' }]), { status: 200 });
        }
        if (url.includes('/rest/v1/')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
      }
      return new Response('{}', { status: 404 });
    });
  const handler = createApiHandler({
    kv,
    env: { accessCode: 'kode-guru-1', adminPin: 'pin-admin-1', usingDefaults: false },
    limiter: createLimiter(5),
    now: () => new Date('2026-11-10T01:00:00Z'),
    fetchImpl,
    hooks: over.hooks,
  });
  const call = (method: string, q: string, headers: Record<string, string>, body?: unknown) =>
    handler(new Request(URL_(q), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { kv, call, calls };
}

const upload = (id = 'photo-abc123', over: Record<string, unknown> = {}) => ({
  id,
  tanggal: '2026-11-10',
  waktu: '06:45:10 WIB',
  lokasi: 'Gerbang Depan',
  staffId: 's1',
  staffNama: 'Susilowati, S.Pd.',
  kondisi: 'Aman & Tertib',
  keterangan: 'Sambut siswa',
  sumber: 'galeri',
  image: JPEG,
  thumb: JPEG,
  ...over,
});

const staff: Staff[] = ['a', 'b', 'c', 'd', 'e'].map((x) => ({ id: x, nama: `Guru ${x}`, jabatan: 'Guru Kelas' }));

/* ---------------- logika murni ---------------- */
test('format tanggal & folder arsip per hari', () => {
  assert.equal(formatIndonesianDate('2026-11-10'), 'Selasa, 10 November 2026');
  assert.deepEqual(folderPathFor('2026-11-10'), ['2026', '11 - November', '2026-11-10 (Selasa)']);
});

test('nama berkas aman & unik per foto', () => {
  const n = buildFileName({ tanggal: '2026-11-10', waktu: '06:45:10 WIB', lokasi: 'Gerbang Depan', staffNama: 'Dr. Ibu/Ani <x>', id: 'photo-abc123' });
  assert.match(n, /^2026-11-10_06-45-10_Gerbang_Depan_Dr_Ibu_Ani_x__abc123\.jpg$/);
});

test('pesan WhatsApp memuat data piket & tautan Drive bila ada', () => {
  const m = { staffNama: 'Ani', tanggal: '2026-11-10', waktu: '06:45:10 WIB', lokasi: 'Gerbang Depan', kondisi: 'Aman & Tertib', keterangan: '', driveUrl: 'https://drive.google.com/x' } as PhotoMeta;
  const t = buildWaMessage(m, 'SDN 1');
  assert.ok(t.includes('Ani') && t.includes('Selasa, 10 November 2026') && t.includes('drive.google.com'));
});

test('sanitizePhotoUpload menolak data tidak valid', () => {
  assert.ok(sanitizePhotoUpload(upload()));
  assert.equal(sanitizePhotoUpload(upload('x')), null); // id pendek
  assert.equal(sanitizePhotoUpload(upload('photo-abc123', { tanggal: '2026-02-31' })), null);
  assert.equal(sanitizePhotoUpload(upload('photo-abc123', { lokasi: 'Kantin' })), null);
  assert.equal(sanitizePhotoUpload(upload('photo-abc123', { image: 'http://evil/x.jpg' })), null);
  assert.equal(sanitizePhotoUpload(upload('photo-abc123', { image: 'data:text/html;base64,PHNjcmlwdD4=' })), null);
});

test('jadwal bulanan: blok 2–3 hari, depan≠belakang, lewati Minggu & libur', () => {
  const cfg = { ...DEFAULT_CONFIG, liburDates: ['2026-11-17'] };
  const s = generateMonthlySchedule('2026-11', staff, cfg);
  assert.ok(s.length > 0);
  assert.ok(!s.some((a) => a.hari === 'Minggu' || a.tanggal === '2026-11-17'));
  assert.ok(s.every((a) => a.frontStaffId !== a.backStaffId));
  assert.equal(new Set(s.map((a) => a.tanggal)).size, s.length);
});

test('pengganti piket dipakai sebagai petugas efektif', () => {
  const a: Assignment = { id: 'picket-2026-11-10', tanggal: '2026-11-10', hari: 'Selasa', frontStaffId: 'a', backStaffId: 'b', frontReplacementId: 'c' };
  assert.equal(dutyStaffId(a, 'front'), 'c');
  assert.equal(dutyStaffId(a, 'back'), 'b');
});

test('rekap harian & per guru', () => {
  const sched: Assignment[] = [{ id: 'p', tanggal: '2026-11-10', hari: 'Selasa', frontStaffId: 'a', backStaffId: 'b' }];
  const photos = [{ id: 'p1', tanggal: '2026-11-10', lokasi: 'Gerbang Depan', staffId: 'a', staffNama: 'Guru a', driveUrl: 'u', waAt: 't' }] as PhotoMeta[];
  const r = buildMonthRecap('2026-11', sched, photos);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].frontDone, r[0].backDone, r[0].drive, r[0].wa], [true, false, 1, 1]);
  const t = buildTeacherRecap('2026-11', sched, photos, staff);
  assert.equal(t.find((x) => x.staffId === 'a')?.terlaksana, 1);
  assert.equal(t.find((x) => x.staffId === 'b')?.terlaksana, 0);
});

test('sanitizeConfig: nilai tidak valid kembali ke bawaan, tautan non-https dibuang', () => {
  const c = sanitizeConfig({ jamMulai: '25:99', waGroupInviteLink: 'javascript:alert(1)', driveFolderUrl: 'http://x', hariKerja: ['Foo'] });
  assert.equal(c.jamMulai, DEFAULT_CONFIG.jamMulai);
  assert.equal(c.waGroupInviteLink, '');
  assert.equal(c.driveFolderUrl, '');
  assert.deepEqual(c.hariKerja, DEFAULT_CONFIG.hariKerja);
});

test('sanitizeSchedule: dedup tanggal & pengganti', () => {
  const s = sanitizeSchedule([
    { tanggal: '2026-11-10', frontStaffId: 'a', backStaffId: 'b', frontReplacementId: 'c', frontReplacementReason: 'Sakit' },
    { tanggal: '2026-11-10', frontStaffId: 'x', backStaffId: 'y' },
    { tanggal: 'bukan-tanggal' },
  ]);
  assert.equal(s?.length, 1);
  assert.equal(s?.[0].frontReplacementReason, 'Sakit');
});

/* ---------------- API ---------------- */
test('tanpa/salah kode akses => 401; ping publik', async () => {
  const { call } = setup();
  assert.equal((await call('GET', 'op=ping', {})).status, 200);
  assert.equal((await call('GET', 'op=bootstrap', {})).status, 401);
  assert.equal((await call('GET', 'op=bootstrap', H('salah-salah'))).status, 401);
  assert.equal((await call('GET', 'op=bootstrap', H())).status, 200);
});

test('rate limit setelah percobaan salah beruntun => 429', async () => {
  const { call } = setup();
  for (let i = 0; i < 5; i++) await call('GET', 'op=bootstrap', H('salah-salah'));
  assert.equal((await call('GET', 'op=bootstrap', H())).status, 429);
});

test('aksi admin ditolak tanpa PIN, diterima dengan PIN', async () => {
  const { call } = setup();
  assert.equal((await call('PUT', 'op=config', H(), { schoolName: 'X' })).status, 403);
  assert.equal((await call('PUT', 'op=config', H('kode-guru-1', 'pin-salah'), { schoolName: 'X' })).status, 403);
  const ok = await call('PUT', 'op=config', H('kode-guru-1', 'pin-admin-1'), { schoolName: 'SDN X' });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as any).config.schoolName, 'SDN X');
});

test('foto: simpan, daftar per hari/bulan, idempoten, gambar dapat diambil', async () => {
  const { call } = setup();
  const r = await call('POST', 'op=photo', H(), upload());
  assert.equal(r.status, 200);
  const j = (await r.json()) as any;
  assert.equal(j.photo.fileName.endsWith('.jpg'), true);
  const again = (await (await call('POST', 'op=photo', H(), upload())).json()) as any;
  assert.equal(again.duplicate, true);
  const byDay = (await (await call('GET', 'op=photos&date=2026-11-10', H())).json()) as any;
  assert.equal(byDay.photos.length, 1);
  const byMonth = (await (await call('GET', 'op=photos&month=2026-11', H())).json()) as any;
  assert.equal(byMonth.photos.length, 1);
  const img = await call('GET', 'op=photo&id=photo-abc123', H());
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
});

test('foto baru TIDAK menghapus foto sebelumnya di hari yang sama', async () => {
  const { call } = setup();
  await call('POST', 'op=photo', H(), upload('photo-aaa111'));
  await call('POST', 'op=photo', H(), upload('photo-bbb222', { lokasi: 'Gerbang Belakang' }));
  const day = (await (await call('GET', 'op=photos&date=2026-11-10', H())).json()) as any;
  assert.equal(day.photos.length, 2);
});

test('foto: payload tidak valid ditolak 400; terlalu besar 413', async () => {
  const { call } = setup();
  assert.equal((await call('POST', 'op=photo', H(), upload('photo-abc123', { lokasi: 'X' }))).status, 400);
  const big = await call('POST', 'op=photo', { ...H(), 'content-length': String(9 * 1024 * 1024) }, upload());
  assert.equal(big.status, 413);
});

test('hook arsip lokal dipanggil & path tersimpan di metadata', async () => {
  let called = 0;
  const { call } = setup({ hooks: { onPhotoSaved: async () => ((called++), { localPath: 'E:\\Foto\\a.jpg' }) } });
  const j = (await (await call('POST', 'op=photo', H(), upload())).json()) as any;
  assert.equal(called, 1);
  assert.equal(j.photo.localPath, 'E:\\Foto\\a.jpg');
});

test('hapus foto butuh admin & menghapus gambar', async () => {
  const { call, kv } = setup();
  await call('POST', 'op=photo', H(), upload());
  assert.equal((await call('DELETE', 'op=photo&id=photo-abc123&date=2026-11-10', H())).status, 403);
  assert.equal((await call('DELETE', 'op=photo&id=photo-abc123&date=2026-11-10', H('kode-guru-1', 'pin-admin-1'))).status, 200);
  assert.equal(kv.data.has('img/photo-abc123'), false);
  const day = (await (await call('GET', 'op=photos&date=2026-11-10', H())).json()) as any;
  assert.equal(day.photos.length, 0);
});

test('rahasia integrasi tidak pernah bocor ke klien', async () => {
  const { call } = setup();
  await call('PUT', 'op=secrets', H('kode-guru-1', 'pin-admin-1'), { fonnteToken: 'TOKEN-RAHASIA-123', driveScriptUrl: 'https://script.google.com/macros/s/X/exec', driveSecret: 'drive-secret' });
  const boot = await (await call('GET', 'op=bootstrap', H())).text();
  assert.ok(!boot.includes('TOKEN-RAHASIA-123') && !boot.includes('drive-secret') && !boot.includes('script.google.com'));
  const j = JSON.parse(boot);
  assert.equal(j.secrets.hasFonnteToken, true);
  assert.equal(j.secrets.hasDriveSecret, true);
});

test('URL Apps Script non-Google ditolak (anti-SSRF)', async () => {
  const { call } = setup();
  const r = await call('PUT', 'op=secrets', H('kode-guru-1', 'pin-admin-1'), { driveScriptUrl: 'http://169.254.169.254/latest' });
  assert.equal(r.status, 400);
});

test('WhatsApp: dikirim hanya bila diaktifkan & lengkap; hasil tercatat di metadata', async () => {
  const { call, calls } = setup();
  const A = H('kode-guru-1', 'pin-admin-1');
  await call('POST', 'op=photo', H(), upload());
  const off = (await (await call('POST', 'op=wa&id=photo-abc123&date=2026-11-10', H())).json()) as any;
  assert.equal(off.result.skipped, true);
  await call('PUT', 'op=config', A, { waEnabled: true, waGroupTarget: '1@g.us' });
  const noToken = (await (await call('POST', 'op=wa&id=photo-abc123&date=2026-11-10', H())).json()) as any;
  assert.equal(noToken.result.skipped, true);
  await call('PUT', 'op=secrets', A, { fonnteToken: 'tok-12345' });
  const ok = (await (await call('POST', 'op=wa&id=photo-abc123&date=2026-11-10', H())).json()) as any;
  assert.equal(ok.result.ok, true);
  assert.ok(ok.photo.waAt);
  const sent = calls.find((c) => c.url.includes('/send'));
  assert.equal((sent?.init?.headers as any).Authorization, 'tok-12345');
});

test('Google Drive: unggah foto, tautan tersimpan; kunci salah => error tercatat', async () => {
  const { call } = setup();
  const A = H('kode-guru-1', 'pin-admin-1');
  await call('POST', 'op=photo', H(), upload());
  await call('PUT', 'op=config', A, { driveEnabled: true });
  await call('PUT', 'op=secrets', A, { driveScriptUrl: 'https://script.google.com/macros/s/X/exec', driveSecret: 'salah-banget' });
  const bad = (await (await call('POST', 'op=drive&id=photo-abc123&date=2026-11-10', H())).json()) as any;
  assert.equal(bad.result.ok, false);
  assert.ok(bad.photo.driveError);
  await call('PUT', 'op=secrets', A, { driveSecret: 'drive-secret' });
  const ok = (await (await call('POST', 'op=drive&id=photo-abc123&date=2026-11-10', H())).json()) as any;
  assert.equal(ok.result.ok, true);
  assert.match(ok.photo.driveUrl, /drive\.google\.com/);
  assert.equal(ok.photo.driveError, undefined);
});

test('Google Drive: kirim rekap bulanan', async () => {
  const { call } = setup();
  const A = H('kode-guru-1', 'pin-admin-1');
  await call('PUT', 'op=config', A, { driveEnabled: true });
  await call('PUT', 'op=secrets', A, { driveScriptUrl: 'https://script.google.com/macros/s/X/exec', driveSecret: 'drive-secret' });
  const r = (await (await call('POST', 'op=drive-recap', H(), { month: '2026-11', fileName: 'Rekap_2026-11.xlsx', base64: 'UEsDBA==' })).json()) as any;
  assert.equal(r.result.ok, true);
  const bad = await call('POST', 'op=drive-recap', H(), { month: '2026-13', base64: 'AA==' });
  assert.equal(bad.status, 400);
});

test('daftar grup WhatsApp & uji koneksi Drive hanya admin', async () => {
  const { call } = setup();
  const A = H('kode-guru-1', 'pin-admin-1');
  assert.equal((await call('GET', 'op=wa-groups', H())).status, 403);
  await call('PUT', 'op=secrets', A, { fonnteToken: 'tok-12345', driveScriptUrl: 'https://script.google.com/macros/s/X/exec', driveSecret: 'drive-secret' });
  const g = (await (await call('GET', 'op=wa-groups', A)).json()) as any;
  assert.equal(g.groups[0].id, '1@g.us');
  const d = (await (await call('POST', 'op=drive-test', A)).json()) as any;
  assert.equal(d.ok, true);
});

test('jadwal & guru: simpan hanya admin, data tersanitasi', async () => {
  const { call } = setup();
  const A = H('kode-guru-1', 'pin-admin-1');
  assert.equal((await call('PUT', 'op=schedule', H(), { schedule: [] })).status, 403);
  const r = await call('PUT', 'op=schedule', A, { schedule: [{ tanggal: '2026-11-10', frontStaffId: 'a', backStaffId: 'b' }] });
  assert.equal(r.status, 200);
  await call('PUT', 'op=staff', A, { staff: [{ id: 's1', nama: 'Ani', jabatan: 'Guru' }, { id: 's1', nama: 'Dup' }] });
  const boot = (await (await call('GET', 'op=bootstrap', H())).json()) as any;
  assert.equal(boot.staff.length, 1);
  assert.equal(boot.schedule.length, 1);
});

test('vercel handler: mendukung Web Request & Node.js Serverless req/res', async () => {
  const vercelHandler = (await import('../api/piket.ts')).default;
  // 1. Web Request
  const webReq = new Request('https://test.vercel.app/api/piket?op=ping');
  const webRes = await vercelHandler(webReq);
  assert(webRes instanceof Response);
  assert.equal(webRes.status, 200);
  const data = (await webRes.json()) as any;
  assert.equal(data.ok, true);
  assert.equal(data.app, 'piket-gerbang');

  // 2. Node.js req/res
  let nodeStatus = 0;
  let nodeBody = '';
  const nodeReq = {
    url: '/api/piket?op=ping',
    method: 'GET',
    headers: { host: 'test.vercel.app' },
    on: () => {},
  } as any;
  const nodeRes = {
    statusCode: 200,
    setHeader: () => {},
    end: (chunk?: any) => {
      nodeStatus = nodeRes.statusCode;
      nodeBody = chunk ? chunk.toString() : '';
    },
  } as any;
  await vercelHandler(nodeReq, nodeRes);
  assert.equal(nodeStatus, 200);
  const nodeData = JSON.parse(nodeBody);
  assert.equal(nodeData.ok, true);
  assert.equal(nodeData.app, 'piket-gerbang');
});

test('Supabase: validasi URL dan skrip schema SQL generator', () => {
  assert.equal(isValidSupabaseUrl('https://xyzcompany.supabase.co'), true);
  assert.equal(isValidSupabaseUrl('http://localhost:54321'), true);
  assert.equal(isValidSupabaseUrl('ftp://invalid.com'), false);
  assert.equal(isValidSupabaseUrl(''), false);

  const sql = getSupabaseSchemaSql();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS piket_kv/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS piket_staff/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS piket_schedule/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS piket_photos/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS piket_config/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
});

test('Supabase: createSupabaseKv operasi get, set, delete, list dengan fallback', async () => {
  const fallback = memKv();
  let remoteStore = new Map<string, unknown>();
  const mockFetch = async (url: string, init?: RequestInit) => {
    if (url.includes('/rest/v1/piket_kv')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Array<{ key: string; value: unknown }>;
        for (const row of body) remoteStore.set(row.key, row.value);
        return new Response(JSON.stringify(body), { status: 201 });
      }
      if (init?.method === 'DELETE') {
        const m = url.match(/key=eq\.([^&]+)/);
        if (m) remoteStore.delete(decodeURIComponent(m[1]));
        return new Response(null, { status: 204 });
      }
      const m = url.match(/key=eq\.([^&]+)/);
      if (m) {
        const val = remoteStore.get(decodeURIComponent(m[1]));
        return new Response(JSON.stringify(val !== undefined ? [{ value: val }] : []), { status: 200 });
      }
      if (url.includes('key=like.')) {
        return new Response(JSON.stringify([...remoteStore.keys()].map((k) => ({ key: k }))), { status: 200 });
      }
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };

  const supaKv = createSupabaseKv({
    url: 'https://test.supabase.co',
    key: 'test-key',
    fetchImpl: mockFetch as any,
    fallbackKv: fallback,
  });

  await supaKv.set('guru-1', { nama: 'Budi' });
  // Tersimpan di remote dan fallback
  assert.deepEqual(await supaKv.get('guru-1'), { nama: 'Budi' });
  assert.deepEqual(await fallback.get('guru-1'), { nama: 'Budi' });

  const list = await supaKv.list('guru-');
  assert.ok(list.includes('guru-1'));

  await supaKv.delete('guru-1');
  assert.equal(await supaKv.get('guru-1'), null);
  assert.equal(await fallback.get('guru-1'), null);
});

test('Supabase: endpoint op=supabase-test dan op=supabase-sync', async () => {
  const { call } = setup();
  const A = H('kode-guru-1', 'pin-admin-1');

  // Uji koneksi tanpa admin ditolak
  assert.equal((await call('POST', 'op=supabase-test', H())).status, 403);

  // Simpan kredensial Supabase
  await call('PUT', 'op=secrets', A, {
    supabaseUrl: 'https://sekolah.supabase.co',
    supabaseKey: 'anon-key-12345',
  });

  // Uji koneksi dengan admin
  const testRes = (await (await call('POST', 'op=supabase-test', A)).json()) as any;
  assert.equal(testRes.ok, true);

  // Sinkronkan semua data ke Supabase
  const syncRes = (await (await call('POST', 'op=supabase-sync', A)).json()) as any;
  assert.equal(syncRes.ok, true);
  assert.match(syncRes.message, /Berhasil menyinkronkan data ke Supabase/);

  // Ambil skrip schema SQL
  const schemaRes = (await (await call('GET', 'op=supabase-schema', H())).json()) as any;
  assert.equal(schemaRes.ok, true);
  assert.match(schemaRes.sql, /piket_kv/);
});

test('Supabase: mirror otomatis saat simpan config, staff, dan upload foto', async () => {
  let supaCalls: string[] = [];
  const customFetch = async (url: string, init?: RequestInit) => {
    supaCalls.push(url);
    if (url.includes('supabase.co')) {
      return new Response(JSON.stringify([{ key: 'ok' }]), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };

  const { call } = setup({ fetchImpl: customFetch });
  const A = H('kode-guru-1', 'pin-admin-1');

  // Aktifkan Supabase di config & secrets
  await call('PUT', 'op=config', A, { supabaseEnabled: true });
  await call('PUT', 'op=secrets', A, {
    supabaseUrl: 'https://test-mirror.supabase.co',
    supabaseKey: 'key-mirror-123',
  });

  supaCalls = [];
  // Simpan data staff
  await call('PUT', 'op=staff', A, { staff: [{ id: 's1', nama: 'Guru Supabase', jabatan: 'Kelas 1' }] });
  assert.ok(supaCalls.some((u) => u.includes('test-mirror.supabase.co')));

  supaCalls = [];
  // Upload foto baru
  await call('POST', 'op=photo', H(), upload('photo-supa-1'));
  assert.ok(supaCalls.some((u) => u.includes('test-mirror.supabase.co')));
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      pass++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n      ${(err as Error).message}`);
    }
  }
  console.log(`\n${pass} lulus, ${failed} gagal`);
  process.exit(failed ? 1 : 0);
})();

