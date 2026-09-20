# HumanText AI V2

> **Write naturally. Understand clearly.**
> An AI writing assistant for analyzing, improving, and personalizing your writing.

Project ini adalah versi mandiri (standalone) dari HumanText AI V2 yang sebelumnya berjalan sebagai Claude Artifact. Semua fitur V2 dipertahankan. Bagian yang butuh AI dipisahkan ke backend proxy sendiri, sehingga **API key tidak pernah ada di frontend**.

- Frontend: HTML + CSS + JavaScript biasa (tanpa framework, tanpa build step)
- Backend: dua Vercel Serverless Function (`/api/ai`, `/api/health`), tanpa dependency
- Deploy: GitHub → Vercel

---

## Daftar isi

1. [Fitur](#fitur)
2. [Arsitektur](#arsitektur)
3. [Struktur project](#struktur-project)
4. [Menjalankan di komputer sendiri](#menjalankan-di-komputer-sendiri)
5. [Deploy ke Vercel (GitHub → Vercel)](#deploy-ke-vercel-github--vercel)
6. [Environment variables](#environment-variables)
7. [Keamanan](#keamanan)
8. [Ketergantungan Claude Artifact](#ketergantungan-claude-artifact)
9. [Kalau AI tidak tersedia](#kalau-ai-tidak-tersedia)
10. [Testing](#testing)
11. [Kustomisasi](#kustomisasi)
12. [Troubleshooting](#troubleshooting)
13. [Yang belum teruji / batasan](#yang-belum-teruji--batasan)

---

## Fitur

Semua fitur di bawah sudah ada di versi Artifact dan tetap ada di sini.

| Halaman | Isi |
|---|---|
| **Home** | Hero, 6 feature card, banner Student Mode, ilustrasi ritme kalimat, cara kerja, privasi, FAQ |
| **AI Detector** | 6 skor 0–100 (AI-like pattern indicator, Naturalness, Sentence variation, Vocabulary diversity, Repetition, Readability), "Why did we get this result?", analisis per paragraf + tombol *Review this paragraph*, ritme kalimat, statistik teks. Wording "Indicative AI-like patterns" dan disclaimer bahwa hasil bukan bukti kepengarangan |
| **Natural Rewriter** | 6 style (Natural Student, Casual Professional, Academic but Natural, Simple & Clear, Formal, Custom), slider Tone dan Length, pilihan Personality, tampilan Original vs Natural Version dengan highlight perubahan, Copy Result / Replace Original / Try Again / Clear / Download |
| **Answer Improver** | Input Question + My Answer, *Analyze My Answer* (5 skor + 8 pertanyaan cek), *Improve My Answer* yang mempertahankan ide pengguna dan melaporkan hal yang belum ada (tidak mengarang) |
| **🎓 Student Mode** | Alur 6 langkah: Question → My idea → My answer → Analyze → Improve → Final version. Versi final baru bisa dibuat setelah *Show what needs improvement* |
| **Reference Assistant** | Format APA 7 / IEEE / MLA / Harvard (tidak mengarang sumber; elemen yang hilang ditandai), dan *Check citation consistency* yang berjalan lokal di browser |
| **Writing Coach** | Feedback lokal + feedback AI yang tidak menulis ulang teks |
| **History** | Simpan lokal (localStorage): title, tanggal, jumlah kata, hasil analisis, teks asli, teks hasil rewrite. Open / Rename / Copy / Delete |
| **Settings** | Theme (System/Light/Dark), default writing style, bahasa (Same as text / Indonesian / English), pengaturan riwayat dan draft, Export history, Clear local history, Clear all saved drafts |
| **About** | Penjelasan cara kerja dan batasan |

Analisis teks, cek jawaban, coach lokal, dan cek konsistensi sitasi berjalan **sepenuhnya di browser**. Hanya fitur AI (rewrite, Improve My Answer, review AI, format referensi, coaching mendalam) yang mengirim teks ke server.

---

## Arsitektur

```
Browser (public/)                     Server (Vercel Function)               Anthropic
─────────────────                     ────────────────────────               ─────────
index.html + css + js
  ├─ analisis lokal  (tanpa jaringan)
  └─ js/runtime.js ── POST /api/ai ──▶ api/ai.js
                        {prompt,tier}   ├─ cek origin, access code, rate limit
                                        ├─ validasi ukuran & tier
                                        └─ ANTHROPIC_API_KEY (env, hanya di sini)
                                           ── POST /v1/messages (stream) ──▶ Claude
                      ◀── NDJSON stream ─┘
                          {"type":"delta","text":"…"} … {"type":"done"}
```

Frontend hanya tahu dua hal: `sample(prompt, opts)` dan `downloads.save(...)` (lihat `public/js/runtime.js`). Untuk mengganti backend (mis. server sendiri, model lain), cukup ubah `aiEndpoint` di `public/js/config.js` atau implementasikan endpoint dengan kontrak yang sama:

```
POST  <aiEndpoint>   Content-Type: application/json
Body: { "prompt": "<string>", "tier": "default" | "fast" }

200 → application/x-ndjson, satu objek JSON per baris:
      {"type":"delta","text":"..."}        (berulang)
      {"type":"done","stop":"end_turn"}    ("max_tokens" jika terpotong)
      {"type":"error","code":"..."}        (jika gagal setelah streaming mulai)
non-200 → {"error":{"code":"..."}}
Kode error yang dikenali UI: rate_limited, prompt_too_large, refused, empty_completion,
                              upstream_error, not_configured, access_required, access_denied

GET   <healthEndpoint>  →  {"ok":true,"ai":{"configured":true|false,"accessCodeRequired":true|false}}
```

---

## Struktur project

```
humantext-ai/
├─ package.json            scripts: dev, dev:mock, check, test  (tanpa dependency)
├─ vercel.json             output = public/, security headers (CSP dll), maxDuration fungsi
├─ .env.example            daftar environment variable (salin ke .env)
├─ .gitignore              .env tidak ikut ke Git
├─ README.md
│
├─ public/                 ← seluruh frontend (yang di-deploy sebagai situs statis)
│  ├─ index.html           markup semua halaman
│  ├─ favicon.svg  robots.txt
│  ├─ css/styles.css       seluruh CSS (tema terang/gelap, responsif)
│  └─ js/                  script klasik, dimuat berurutan oleh index.html
│     ├─ config.js         konfigurasi publik (endpoint AI)
│     ├─ engine.js         mesin analisis + diff (lokal, tanpa jaringan)
│     ├─ runtime.js        adapter AI → /api/ai, download via Blob
│     ├─ runtime-artifact.js  [OPSIONAL, TIDAK DIMUAT] adapter lama untuk Claude Artifact
│     ├─ core.js           helper, storage, dialog, routing, editor, UI AI Detector
│     ├─ ai.js             error mapping, prompt, Natural Rewriter, tampilan before/after
│     ├─ answer.js         Answer Improver + Student Mode
│     ├─ references.js     Reference Assistant
│     ├─ coach.js          Writing Coach
│     ├─ history.js  settings.js  main.js
│
├─ api/                    ← backend (Vercel Serverless Functions, Node.js ESM)
│  ├─ ai.js                POST /api/ai       proxy ke Anthropic (streaming)
│  ├─ health.js            GET  /api/health   status konfigurasi (hanya boolean)
│  └─ _lib/                config, security (rate limit, origin, access code), klien Anthropic
│
├─ scripts/
│  ├─ dev-server.mjs       server lokal (menyajikan public/ + api/ dengan header seperti produksi)
│  └─ check.mjs            cek sintaks, cek tidak ada secret di public/, dll.
├─ tests/
│  ├─ api.test.mjs         tes backend (Node test runner, tanpa dependency)
│  ├─ mock-anthropic.mjs   Anthropic palsu untuk dev/test (jawaban canned)
│  └─ e2e/run.mjs          tes UI end-to-end (butuh Playwright, opsional)
└─ legacy/
   └─ artifact-v2.html     salinan utuh versi Claude Artifact terakhir (arsip, tidak di-deploy)
```

Urutan `<script>` di `index.html` penting: semua file berbagi satu scope global (sama seperti saat masih satu file di Artifact), jadi urutannya tidak boleh diubah.

---

## Menjalankan di komputer sendiri

Prasyarat: **Node.js 20 atau lebih baru**. Tidak perlu `npm install` (tidak ada dependency).

### A. Coba UI tanpa API key (mode mock)

```bash
npm run dev:mock
# buka http://localhost:3000
```

Mode ini menyalakan Anthropic palsu di port 8788. Jawaban AI-nya **jawaban tetap (canned), bukan AI sungguhan**. Cocok untuk mencoba semua alur UI secara gratis dan offline.

### B. Dengan API key sungguhan

```bash
cp .env.example .env
# edit .env, isi ANTHROPIC_API_KEY=sk-ant-...   (buat di https://console.anthropic.com/)
npm run dev
# buka http://localhost:3000
```

### C. Tanpa AI sama sekali

Jalankan `npm run dev` tanpa `.env`. Analisis lokal tetap berfungsi penuh; tombol AI otomatis nonaktif dengan penjelasan.

### Alternatif: `vercel dev`

`npm run vercel:dev` menjalankan runtime Vercel yang asli (butuh login Vercel CLI dan `.env`).

> Jangan membuka `public/index.html` langsung lewat `file://`. Fitur AI butuh server, dan browser memblokir sebagian API pada `file://`.

---

## Deploy ke Vercel (GitHub → Vercel)

1. **Buat repository GitHub** dan unggah isi folder ini.
   ```bash
   git init
   git add .
   git commit -m "HumanText AI V2"
   git branch -M main
   git remote add origin https://github.com/<akun-anda>/humantext-ai.git
   git push -u origin main
   ```
   Pastikan `.env` **tidak** ikut ter-commit (sudah ada di `.gitignore`).

2. Di [vercel.com](https://vercel.com) pilih **Add New → Project**, lalu impor repository tadi.

3. Pengaturan project:
   - **Framework Preset:** `Other`
   - **Root Directory:** `./`
   - **Build Command:** kosongkan (tidak ada build step)
   - **Output Directory:** `public` (sudah diatur di `vercel.json`)

4. Buka **Environment Variables** dan tambahkan (lihat tabel di bawah):
   - `ANTHROPIC_API_KEY` = key Anda (wajib untuk fitur AI)
   - `AI_ACCESS_CODE` = kode akses pilihan Anda (**sangat disarankan** untuk situs publik)

5. Klik **Deploy**.

6. Verifikasi setelah deploy:
   - Buka `https://<domain-anda>/api/health`. Harus menampilkan `{"ok":true,"ai":{"configured":true,...}}`.
   - Buka situs, coba *Analyze Text*, lalu satu fitur AI (mis. *Make more natural*).

Setiap kali mengubah environment variable, lakukan **Redeploy** agar berlaku.

Catatan: `vercel.json` mengatur `maxDuration: 60` detik untuk `api/ai.js`. Sesuaikan dengan batas paket Vercel Anda jika berbeda.

---

## Environment variables

Semua diatur di server (`.env` lokal atau dashboard Vercel). **Tidak satu pun boleh ditaruh di `public/`.**

| Nama | Wajib | Default | Fungsi |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | untuk fitur AI | – | API key Anthropic. Tanpa ini situs tetap jalan, fitur AI nonaktif |
| `AI_ACCESS_CODE` | tidak (disarankan) | kosong | Jika diisi, pengunjung harus memasukkan kode ini sekali per tab sebelum fitur AI bisa dipakai. Mencegah orang asing menghabiskan kredit API Anda |
| `ANTHROPIC_MODEL` | tidak | `claude-sonnet-5` | Model untuk tier `default` |
| `ANTHROPIC_MODEL_FAST` | tidak | `claude-haiku-4-5-20251001` | Model untuk tier `fast` |
| `MAX_OUTPUT_TOKENS` | tidak | `4096` | Batas panjang jawaban per permintaan (256–16000). Lebih tinggi = rewrite lebih panjang, biaya lebih besar |
| `RATE_LIMIT_PER_MINUTE` | tidak | `20` | Permintaan per IP per menit |
| `MAX_PROMPT_BYTES` | tidak | `62000` | Ukuran prompt maksimum. UI juga memakai batas 62.000 byte, jadi jangan diturunkan di bawah itu tanpa menyesuaikan `public/js/ai.js` |
| `ALLOWED_ORIGINS` | tidak | kosong | Daftar origin browser yang boleh memanggil `/api/ai` (pisah koma). Kosong = hanya origin yang sama |
| `UPSTREAM_TIMEOUT_MS` | tidak | `55000` | Batas waktu menunggu Anthropic |
| `ANTHROPIC_API_URL`, `ANTHROPIC_VERSION` | tidak | API resmi, `2023-06-01` | Untuk pengujian / proxy |
| `PORT` | tidak | `3000` | Hanya untuk server lokal |

Nama model berasal dari daftar model Anthropic saat project ini disiapkan. Cek nama terbaru di dokumentasi/console Anthropic sebelum go-live, dan ubah lewat `ANTHROPIC_MODEL` bila perlu (tanpa mengubah kode).

---

## Keamanan

- **API key hanya ada di server.** `api/_lib/anthropic.js` adalah satu-satunya tempat key dipakai. `npm run check` dan `npm test` memeriksa bahwa tidak ada `sk-ant-…` atau `ANTHROPIC_API_KEY` di `public/`, dan tes e2e memeriksa key tidak muncul di response apa pun yang diterima browser.
- **Prompt dan jawaban tidak pernah di-log** oleh server. Log hanya berisi kode error, status HTTP, dan pesan error singkat dari Anthropic (mis. "invalid x-api-key"), tanpa isi teks pengguna.
- **Kode error upstream tidak dibocorkan** ke pengunjung (mis. key salah → pengunjung hanya melihat "connection dropped"; detailnya hanya di log server Anda).
- **Header keamanan** (`vercel.json`): Content-Security-Policy ketat (`script-src 'self'`, `connect-src 'self'`, hanya Google Fonts sebagai pengecualian), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS. Tidak ada inline script, sehingga CSP bisa seketat ini.
- **Pemeriksaan origin:** permintaan lintas-origin dari browser ke `/api/ai` ditolak (kecuali ada di `ALLOWED_ORIGINS`).
- **Access code** (opsional) dibandingkan dengan perbandingan waktu-konstan; disimpan di `sessionStorage` tab pengunjung saja.
- **Validasi input:** hanya `POST`, prompt harus string tidak kosong, ukuran dibatasi, `tier` hanya `default`/`fast`.
- **Path traversal** pada server lokal diblokir dan diuji.

**Rate limiting:** limiter bawaan ada di memori tiap instance serverless, jadi sifatnya *best-effort* (memperlambat penyalahgunaan, bukan jaminan). Untuk batas yang ketat gunakan salah satu: Vercel Firewall / Rate Limiting di dashboard, atau penyimpanan bersama (mis. Upstash Redis / Vercel KV) yang bisa dihubungkan di `api/_lib/security.js`. Kombinasikan dengan `AI_ACCESS_CODE` dan atur **batas pengeluaran (spend limit)** di console Anthropic.

---

## Ketergantungan Claude Artifact

Versi Artifact memakai runtime bawaan Claude (`window.claude`), yang hanya ada di dalam Claude Artifact dan tidak tersedia di domain sendiri. Semua titik ketergantungan itu sudah dipisahkan dan ditandai dengan komentar `[ARTIFACT-RUNTIME]` di kode:

| Di Artifact (dulu) | Di project ini (sekarang) | Lokasi |
|---|---|---|
| `window.claude.use("sample")`: pembuatan teks AI, streaming, pembatalan, model tier | `sample()` yang memanggil `POST /api/ai` → Anthropic, API key di server | `public/js/runtime.js`, `api/ai.js` |
| `window.claude.use("downloads")`: dialog simpan file | Download browser biasa (Blob + `<a download>`) | `public/js/runtime.js` |
| Izin "boleh pakai Claude?" saat pertama kali | Dihapus. Diganti opsional `AI_ACCESS_CODE` | `api/ai.js`, `runtime.js` |
| Kode error runtime (`not_granted`, `sampling_disabled`, `not_declared`, `capability_*`, `session_expired`) | Tetap dikenali UI, tapi hanya muncul jika adapter Artifact dipakai. Kode baru: `not_configured`, `access_denied` | `public/js/ai.js` |
| Batas CSP Artifact | Digantikan `vercel.json` milik Anda sendiri | `vercel.json` |

**Tidak dihapus:** integrasi lama tetap ada sebagai `public/js/runtime-artifact.js`. File itu **tidak dimuat** secara default (tag `<script>`-nya dikomentari di `index.html`, dan `useArtifactRuntime: false` di `config.js`). Situs mandiri tidak membutuhkannya. Untuk mengaktifkannya kembali (hanya berguna jika halaman ini dijalankan di dalam Claude Artifact): hapus komentar tag `<script>` dan set `useArtifactRuntime: true`.

`npm run check` memastikan tidak ada script yang dimuat `index.html` yang memakai `window.claude`.

Salinan utuh versi Artifact terakhir ada di `legacy/artifact-v2.html` sebagai arsip (tidak ikut di-deploy karena berada di luar `public/`).

---

## Kalau AI tidak tersedia

Frontend memanggil `/api/health` saat dimuat.

- **Key belum diset / server tidak terjangkau:** tombol AI nonaktif dengan pesan yang jelas. Analisis, cek jawaban (estimasi lokal), coach lokal, dan cek sitasi tetap berjalan.
- **Error saat dipakai** (limit, timeout, dll.): pesan ramah dalam bahasa sederhana. Kode teknis tidak ditampilkan; error yang tidak dikenal menjadi "Something went wrong. Please try again."
- **Stop / Cancel:** pembatalan menghentikan permintaan ke server, dan teks parsial yang sudah tiba tetap ditampilkan.

---

## Testing

```bash
npm run check    # sintaks, tidak ada secret di public/, semua file yang dirujuk ada
npm test         # 11 tes backend (proxy, validasi, access code, origin, rate limit, error mapping, header)
```

Tes UI end-to-end (opsional, butuh Playwright):

```bash
npm i -D playwright
npx playwright install chromium
node tests/e2e/run.mjs
```

Tes e2e menjalankan seluruh rantai (browser → dev server → `/api/ai` → Anthropic palsu) dengan ±125 pemeriksaan: navigasi, semua halaman dan fitur, locale Indonesia, mode tanpa AI, jalur error, tombol Stop, alur access code, download nyata, overflow mobile, audit jaringan (hanya situs ini + Google Fonts), audit kebocoran key, dan pelanggaran CSP.

---

## Kustomisasi

- **Ganti model:** set `ANTHROPIC_MODEL`.
- **Backend lain / domain terpisah:** ubah `aiEndpoint` di `public/js/config.js` dan tambahkan origin frontend ke `ALLOWED_ORIGINS` di backend.
- **Self-host font:** situs memuat Literata dan Spline Sans dari Google Fonts (satu-satunya permintaan pihak ketiga). Untuk menghilangkannya, unduh font ke `public/fonts/`, tambahkan `@font-face` di `css/styles.css`, hapus tiga tag `<link>` Google Fonts di `index.html`, dan hapus dua domain Google dari CSP di `vercel.json`.
- **Ubah teks prompt AI:** ada di `public/js/ai.js` (rewriter), `answer.js`, `references.js`, `coach.js`. Karena prompt disusun di frontend dan diteruskan apa adanya oleh server, batas ukuran dan validasi tetap dipaksa di server.
- **Domain sendiri:** Vercel → Project → Settings → Domains.

---

## Troubleshooting

| Gejala | Penyebab / solusi |
|---|---|
| Tombol AI abu-abu, pesan "not set up on this site yet" | `ANTHROPIC_API_KEY` belum diset di environment (atau belum redeploy). Cek `/api/health` |
| "AI features could not be reached right now" | `/api/health` gagal. Pastikan folder `api/` ikut ter-deploy dan Anda tidak membuka lewat `file://` |
| Setiap permintaan AI gagal dengan "connection dropped" | Key salah/tidak valid, nama model salah, atau kredit habis. Lihat log fungsi di Vercel (`[api/ai] upstream failure: … status 401/404/…`) |
| Modal "Access code required" muncul | `AI_ACCESS_CODE` diset. Masukkan kodenya, atau hapus variabelnya |
| "usage limit" / rate limited | Melewati `RATE_LIMIT_PER_MINUTE` atau limit akun Anthropic |
| Rewrite terpotong | Naikkan `MAX_OUTPUT_TOKENS`, atau rewrite per beberapa paragraf |
| Font terlihat berbeda / tidak termuat | Google Fonts diblokir jaringan. Aplikasi tetap jalan dengan font cadangan. Lihat "Self-host font" |
| Riwayat dari versi Artifact tidak muncul | localStorage terikat per domain, jadi tidak ikut pindah otomatis. Belum ada fitur import (yang ada: *Export history*) |

---

## Yang belum teruji / batasan

Jujur soal apa yang sudah dan belum diverifikasi saat project ini disiapkan:

- **Integrasi ke Anthropic API sungguhan belum diuji.** Lingkungan penyusunan tidak punya akses internet/API key, jadi proxy diuji terhadap Anthropic palsu (`tests/mock-anthropic.mjs`) yang meniru format streaming Messages API. Klien mengikuti format dokumentasi resmi (`x-api-key`, `anthropic-version: 2023-06-01`, event `content_block_delta` / `message_delta` / `error`), tetapi lakukan satu uji nyata setelah deploy (langkah 6 di atas) dan periksa nama model.
- **Deploy ke Vercel belum dijalankan** dari sini. Konfigurasi (`vercel.json`, struktur `api/`, ESM) mengikuti konvensi Vercel, tetapi build pertama Anda adalah pembuktiannya. Jika ada pesan error Vercel, kirimkan ke saya.
- Rate limiting bawaan bersifat best-effort (lihat bagian Keamanan).
- Analisis "AI-like pattern" adalah heuristik probabilistik, bukan bukti kepengarangan, dan tidak boleh diperlakukan sebagai bukti. Ini dinyatakan di UI dan halaman About.
- Fitur import History belum ada (hanya export).
