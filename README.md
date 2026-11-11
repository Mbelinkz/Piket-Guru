# 🏫 Aplikasi Piket Gerbang Guru (Mandiri & Siap Deploy ke Vercel & Netlify)
**SD NEGERI 1 REJOSO**

Aplikasi dokumentasi dan manajemen piket gerbang pagi guru yang berdiri sendiri (*standalone*), elegan, modern, responsif untuk smartphone guru, serta siap di-deploy langsung ke **Vercel**, **Netlify**, maupun dijalankan di **Server Lokal (port 3333)** dengan integrasi **Google Drive sekolah** & **WhatsApp Fonnte**.

---

## ⚡ Pilihan Deploy ke Vercel (Sangat Cepat & Modern)

Aplikasi ini telah dirancang dengan fungsi serverless khusus Vercel ([`api/piket.ts`](file:///E:/RESTU%20DIGITAL/piket-gerbang/api/piket.ts)) dan file konfigurasi [`vercel.json`](file:///E:/RESTU%20DIGITAL/piket-gerbang/vercel.json).

### 🚀 Cara Deploy ke Vercel via Dasbor / GitHub:
1. Masuk ke akun Anda di **[vercel.com](https://vercel.com)**.
2. Klik tombol **Add New...** > **Project**.
3. Hubungkan akun GitHub Anda dan pilih repositori `piket-gerbang` (atau import dari Git).
4. Vercel akan otomatis mendeteksi:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./` (atau folder `piket-gerbang`)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Buka bagian **Environment Variables**, lalu tambahkan:
   - `ACCESS_CODE` = `sdn1rejoso` *(atau kode akses pilihan Anda)*
   - `ADMIN_PIN` = `123456` *(atau PIN admin pilihan Anda)*
   - *(Direkomendasikan)* `SUPABASE_URL` & `SUPABASE_KEY` *(simpan jadwal, guru, konfigurasi, & foto ke Supabase PostgreSQL)*
   - `GDRIVE_SCRIPT_URL` = *(URL Web App Google Apps Script sekolah berakhiran `/exec`)*
   - `GDRIVE_SECRET` = *(Kunci rahasia Google Drive yang sama)*
   - *(Opsional)* `FONNTE_TOKEN` = *(Token WhatsApp Fonnte jika ingin notifikasi WA)*
   - *(Opsional)* `KV_REST_API_URL` & `KV_REST_API_TOKEN` *(jika menambahkan Vercel KV / Upstash Redis di Vercel Marketplace Storage)*
6. Klik **Deploy**.
7. Dalam 30 detik, aplikasi Anda sudah tayang online dengan domain gratis seperti `https://piket-gerbang-xxx.vercel.app`!

> [!TIP]
> **Tanpa Konfigurasi Rumit**: Jika Anda belum memasang Vercel KV, aplikasi secara otomatis mengaktifkan **Mode Cerdas Web**: guru tetap dapat mengambil foto, melihat jadwal, dan seluruh dokumentasi foto & rekap otomatis terkirim langsung ke Google Drive sekolah!

---

## 🌐 Pilihan Deploy ke Netlify

Selain Vercel, aplikasi tetap mendukung penuh Netlify:

### 🟢 CARA 1: Drag & Drop Folder `dist` (Tanpa Perlu Git)
1. Buka peramban internet ke: **[app.netlify.com/drop](https://app.netlify.com/drop)**.
2. Seret (*drag and drop*) folder **`E:\RESTU DIGITAL\piket-gerbang\dist`** ke area kotak Netlify Drop.
3. Dalam 10 detik, situs langsung online!

### 🔵 CARA 2: Git Continuous Deployment (GitHub)
1. Hubungkan repositori GitHub Anda ke Netlify (**Add new site** > **Import an existing project**).
2. Netlify akan membaca konfigurasi resmi dari [`netlify.toml`](file:///E:/RESTU%20DIGITAL/piket-gerbang/netlify.toml).
3. Tambahkan environment variable (`ACCESS_CODE`, `ADMIN_PIN`, dsb.) di **Site configuration** > **Environment variables**.
4. Klik **Deploy site**.

---

## 🚀 Cara Menjalankan Secara Lokal (Port 3333)

Cukup klik dua kali salah satu file peluncur berikut:
- **`E:\RESTU DIGITAL\piket-gerbang\Jalankan_Piket_3333.bat`**
- atau dari folder utama: **`E:\RESTU DIGITAL\Jalankan_Portal_Piket_3333.bat`**

Aplikasi akan otomatis mengompilasi (jika belum di-build), menjalankan server lokal di `http://localhost:3333`, dan membuka peramban web (browser).
Foto piket harian disimpan secara rinci dan teratur di folder `data/arsip-piket/YYYY-MM/YYYY-MM-DD/`.

### Kredensial Bawaan:
- **Kode Akses Guru**: `sdn1rejoso`
- **PIN Administrator**: `123456`
*(Dapat disesuaikan melalui file `.env` atau menu Pengaturan).*

---

## 📁 Panduan Integrasi Google Drive Sekolah

Aplikasi menggunakan skrip **Google Apps Script** yang dipasang di akun Google sekolah:
1. Buka [script.google.com](https://script.google.com) dengan akun Google resmi sekolah.
2. Buat proyek baru, hapus teks default, lalu tempel kode dari file [`google-apps-script/Code.gs`](file:///E:/RESTU%20DIGITAL/piket-gerbang/google-apps-script/Code.gs) (atau dari tombol **Panduan Pasang Skrip Drive** di menu Pengaturan aplikasi).
3. Ubah baris `const SECRET = 'GANTI_DENGAN_KUNCI_RAHASIA_ANDA';` dengan kunci rahasia buatan Anda sendiri.
4. Klik **Terapkan (Deploy)** > **Deployment baru**:
   - Jenis: **Aplikasi Web (Web app)**
   - Jalankan sebagai: **Saya (akun sekolah)**
   - Yang memiliki akses: **Siapa saja (Anyone)**
5. Salin URL Aplikasi Web yang dihasilkan (berakhiran `/exec`).
6. Masuk ke aplikasi Piket Gerbang > menu **Pengaturan** > tab **Google Drive Sekolah**:
   - Tempel **URL Web App** dan **Kunci Rahasia**.
   - Klik **Simpan Pengaturan Google Drive**, lalu klik **Uji Koneksi Google Drive**.

---

## 🗄️ Panduan Integrasi Database Supabase (PostgreSQL Cloud)

Aplikasi kini mendukung penuh database **Supabase** (PostgreSQL cloud gratis) untuk menyimpan konfigurasi, data guru, jadwal piket harian, dan arsip foto:

### 1. Buat Proyek di Supabase
1. Buka **[supabase.com](https://supabase.com)** dan masuk dengan akun Anda.
2. Klik **New Project**, tentukan nama proyek (mis. `piket-gerbang`) dan password database.
3. Tunggu sekitar 1 menit hingga database selesai disiapkan.

### 2. Jalankan Skrip SQL Setup Tabel
1. Di bilah navigasi kiri dasbor Supabase, klik ikon **SQL Editor** (atau buka menu **SQL Editor** > **New query**).
2. Salin isi berkas [`supabase/schema.sql`](file:///supabase/schema.sql) (atau klik tombol **Panduan & Skrip SQL Supabase** di menu Pengaturan aplikasi).
3. Tempel ke editor SQL Supabase lalu klik **Run** (Ctrl + Enter).
4. Kelima tabel utama (`piket_kv`, `piket_staff`, `piket_schedule`, `piket_photos`, `piket_config`) beserta kebijakan keamanan (Row Level Security) akan otomatis terpasang!

### 3. Hubungkan Kredensial ke Aplikasi
1. Buka menu **Project Settings** > **API**:
   - Salin **Project URL** (misal: `https://xxxxxxxx.supabase.co`).
   - Salin **Project API keys** (anon public key atau service_role).
2. Masuk ke aplikasi Piket Gerbang > menu **Pengaturan** > tab **Database Supabase**:
   - Tempel **Project URL** dan **API Key**.
   - Centang **Aktifkan penyimpanan database Supabase**.
   - Klik **Simpan Pengaturan Supabase**, lalu klik **Uji Koneksi Supabase**.
   - *(Opsional)* Klik **Sinkronkan Semua Data ke Supabase** untuk mengunggah seluruh data guru, jadwal, dan arsip foto yang sudah ada ke database Supabase!

> [!TIP]
> Anda juga dapat menyetel variabel lingkungan `SUPABASE_URL` dan `SUPABASE_KEY` di file `.env` (lokal) atau di panel Environment Variables Vercel & Netlify.

---

## 🗂️ Struktur Direktori Proyek

```
piket-gerbang/
├── .env.example                     # Contoh variabel lingkungan (termasuk Supabase)
├── Jalankan_Piket_3333.bat          # File peluncur otomatis Windows
├── index.html                       # Entry HTML aplikasi
├── vercel.json                      # Konfigurasi routing, cache, & serverless Vercel
├── netlify.toml                     # Konfigurasi build, headers, & rewrite Netlify
├── package.json                     # Dependensi (React 19, Lucide, XLSX, Tailwind v4)
├── server.ts                        # Server Node.js mandiri lokal port 3333
├── tsconfig.json                    # Konfigurasi TypeScript
├── vite.config.ts                   # Konfigurasi Vite bundler
├── api/
│   └── piket.ts                     # Vercel Serverless Function (/api/piket)
├── google-apps-script/
│   └── Code.gs                      # Skrip backend Google Drive sekolah
├── supabase/
│   └── schema.sql                   # Skrip setup tabel & RLS PostgreSQL Supabase
├── netlify/
│   └── functions/
│       └── piket.mts                # Netlify Functions v2 handler (@netlify/blobs)
├── public/
│   ├── _redirects                   # Aturan routing & SPA fallback otomatis
│   ├── logo-sekolah.png             # Logo resmi SDN 1 Rejoso
│   ├── logo-visi.png                # Logo visi sekolah
│   └── manifest.webmanifest         # PWA Manifest
├── dist/                            # Hasil kompilasi siap deploy (Drag & Drop)
├── shared/
│   ├── api-core.ts                  # Logika API murni (otentikasi, rate limit, upload)
│   ├── integrations.ts              # Driver Fonnte WhatsApp & Google Drive
│   ├── piket.ts                     # Logika rotasi jadwal, tanggal, rekap, & format pesan
│   ├── supabase.ts                  # Driver PostgREST Supabase & Kv adapter
│   └── types.ts                     # Definisi TypeScript bersama (termasuk foto profil & logo)
├── src/
│   ├── App.tsx                      # Header, status koneksi, modal PIN, logo, & navigasi tab
│   ├── main.tsx                     # Entry point React
│   ├── index.css                    # Tailwind CSS v4 styling & background radial mesh gradient
│   ├── components/
│   │   ├── HomeView.tsx             # Pengambilan foto kamera/galeri, kartu tugas guru berfoto
│   │   ├── GalleryView.tsx          # Galeri dokumentasi foto per bulan & pencarian
│   │   ├── ScheduleView.tsx         # Jadwal piket 2-3 hari & edit pengganti dengan avatar guru
│   │   ├── RecapView.tsx            # Rekap bulanan, cetak kop resmi berlogo, & sinkron Drive
│   │   ├── SettingsView.tsx         # Upload foto profil guru, logo sekolah, visi, & Drive
│   │   ├── PhotoCard.tsx            # Komponen kartu pratinjau & avatar petugas
│   │   └── ui.tsx                   # Modal, Toast, Badge, Avatar, Button reusable
│   ├── data/
│   │   ├── initialConfig.json       # Konfigurasi awal SDN 1 Rejoso
│   │   ├── initialSchedule.json     # Jadwal aktif SDN 1 Rejoso (79 penugasan)
│   │   └── initialStaff.json        # Data 20 guru SDN 1 Rejoso
│   └── lib/
│       ├── api.ts                   # API client, antrean upload offline, & client-side fallback
│       ├── ctx.ts                   # Antarmuka AppCtx
│       └── image.ts                 # Kompresi gambar canvas & pembubuhan stempel + logo sekolah
└── test/
    └── run.ts                       # Unit test 25 skenario pengujian komprehensif (termasuk Vercel)
```
