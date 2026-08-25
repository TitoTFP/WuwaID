# Referensi terjemahan en -> id dari repo ini: [TitoTFP/wuwa-bahasa-indonesia](https://github.com/TitoTFP/wuwa-bahasa-indonesia)

# WuWa Bahasa Indonesia

[![Discord](https://img.shields.io/badge/Discord-Join-7289DA?style=plastic&logo=discord&logoColor=white)](https://discord.gg/rhUKsb7V8r)

Patch terjemahan Bahasa Indonesia untuk **Wuthering Waves**.

---

## Panduan Instalasi

### Metode 1: Instalasi Otomatis melalui Launcher _(Direkomendasikan)_

Unduh **WuwaID Launcher** — aplikasi yang secara otomatis mengunduh dan memasang patch terjemahan ke folder yang sesuai:

[![Download Launcher](https://img.shields.io/badge/Download%20WuwaID%20Launcher-Latest-blue?style=for-the-badge&logo=github)](https://github.com/TitoTFP/WuwaID/releases/latest)

1. Unduh file `.zip` dari link di atas, lalu ekstrak.
2. Jalankan `WuwaIDLauncher.exe`.
3. Pilih folder instalasi game, lalu klik **Install**. Launcher akan menangani proses sisanya secara otomatis.

---

### Metode 2: Instalasi Manual

### 1. Unduh file

Buka halaman [**Releases**](../../releases), lalu unduh file berikut:

| File          | Deskripsi                                                        |
| ------------- | ---------------------------------------------------------------- |
| `WuwaID.zip`  | PAK normal dan varian Hide UID; ekstrak lalu pilih salah satunya |
| `winhttp.dll` | Loader untuk me-mount patch terjemahan secara otomatis           |

`WuwaID.zip` berisi:

```text
pakchunk0-ID-WindowsNoEditor_1000_P.pak
pakchunk0-ID-WindowsNoEditor-HideUID_1000_P.pak
```

### 2. Instalasi

**Langkah 1** — Ekstrak `WuwaID.zip`, pilih PAK normal atau Hide UID, lalu salin
satu file `.pak` tersebut ke folder berikut:

```text
{Folder game}\Client\Binaries\Win64\wuwaIndonesia\
```

> Jika folder `wuwaIndonesia` belum ada, buat folder baru dengan nama tersebut.

**Langkah 2** — Salin `winhttp.dll` ke folder yang sama dengan file `.exe` game:

```text
{Folder game}\Client\Binaries\Win64\
```

### Struktur folder setelah instalasi

```text
Client\Binaries\Win64\
├── winhttp.dll
├── Client-Win64-Shipping.exe
└── wuwaIndonesia\
    └── <PAK normal atau Hide UID yang dipilih>.pak
```

### 3. Uninstall

Hapus file `winhttp.dll` dan folder `wuwaIndonesia`.

### Kontrak Asset Release

Release baru memuat `WuwaID.zip`, `winhttp.dll`, dan `SHA256sums.txt`.
`WuwaID.zip` wajib berisi tepat dua member pada root archive:
`pakchunk0-ID-WindowsNoEditor_1000_P.pak` dan
`pakchunk0-ID-WindowsNoEditor-HideUID_1000_P.pak`. Daftar checksum memuat hash
ZIP, kedua byte stream PAK internal, dan `winhttp.dll`, tetapi tidak memuat
checksum untuk dirinya sendiri. Launcher baru memilih PAK sesuai pengaturan Hide
UID dan tetap dapat memasang rilis lama yang hanya menyediakan PAK mentah. Setelah
release beralih ke kontrak ZIP, launcher lama tidak dapat mengonsumsi asset baru dan
pengguna harus memperbarui launcher terlebih dahulu.

---

## Catatan

- Patch terjemahan bekerja dengan cara me-mount file `.pak` tambahan melalui proxy `winhttp.dll`.
- Patch ini **tidak mengubah file asli game**.
- Setelah game mendapatkan update, kamu mungkin perlu mengunduh ulang patch terjemahan terbaru dari halaman Releases.
- Gunakan patch ini dengan risiko masing-masing.

---

## Struktur Repositori (Monorepo)

Repositori **WuwaID** mengintegrasikan loader game, data terjemahan, WebUI terpadu, dan perkakas ekspor data:

```text
WuwaID/
├── src/ & sdk/           # C++ WinHTTP proxy loader & PakBypass DLL loader
├── data/                 # Export lokal; manifest versi dilacak, hasil export diabaikan
├── webui/                # Vite + React + Express reader, workbench, ops, dan database tools
├── scripts/              # Skrip Python untuk ekspor database lokalisasi game
└── release/              # Artefak packaging dan validasi release
```

`webui/` adalah satu-satunya aplikasi web aktif di repository ini. Data runtime seperti
`data/quests/`, `webui/data/db_uploads/`, `webui/data/database_jobs/`, dan database
snapshot row-level `data/version_history.db` sengaja tidak disimpan di Git. Sebaliknya,
`data/version_history.json` dan `data/version_manifests/` menyimpan metadata sumber
database yang reproducible dan dilacak Git.

---

## Pengembangan & Kontribusi (Developer)

### Persiapan Release Lokal

Dari folder versi di bawah `release/`, jalankan:

```sh
cd release/v3.6.1-id.3
python ../../scripts/prepare_release.py --repak /path/to/repak
```

Path `repak` juga dapat diberikan melalui environment `REPAK` atau `PATH`. Script
memvalidasi input, membuat PAK Hide UID dengan repak V12, lalu menghasilkan
`WuwaID.zip` dan `SHA256sums.txt` secara atomik. PAK normal, `winhttp.dll`, dan
folder hasil unpack yang sudah ada tidak diubah. Script ini hanya menyiapkan dan
memverifikasi artifact lokal; script tidak melakukan commit, tag, push, upload,
atau publikasi GitHub Release.

### 1. Ekspor Data Lokalisasi

Repositori ini menyediakan skrip Python untuk mengekstrak teks lokalisasi dari database game Wuthering Waves (`ConfigDB` atau `WuwaDBExport`).

#### Persiapan

Pastikan folder database game (`ConfigDB` atau `WuwaDBExport`) diletakkan di direktori yang sesuai atau tentukan path secara manual saat menjalankan skrip.

#### Ekspor database langsung dari game

Untuk mengambil database dari game yang sedang berjalan, jalankan workflow
`Build Windows DLLs` secara manual dari GitHub Actions, lalu salin kedua DLL
hasil build ke folder berikut:

```text
{Folder game}\Client\Binaries\Win64\
├── winhttp.dll
└── export_localization_db.dll
```

Mulai game dari kondisi tertutup. Setelah SDK siap, console exporter akan
menampilkan pilihan ekspor. Pilih `[2] Export ConfigDB only` untuk mengambil
database lokalisasi tanpa mengekspor dialog.

Output disimpan ke:

```text
%USERPROFILE%\Desktop\WuwaDBExport\
├── base\
├── zh-Hans\
├── en\
└── ja\
```

Mode DB-only tidak memerlukan file `.pak` di folder `wuwaIndonesia`. Log loader
berada di `pakbypass_logs`, sedangkan log exporter berada di
`%USERPROFILE%\Desktop\WuwaDBExport\export_log.txt` atau di sebelah DLL sebagai
`export_localization_db.log` jika folder Desktop tidak dapat ditulis.

Gunakan opsi `--version` untuk mencatat manifest sumber database sebelum dan sesudah
pergantian data:

```sh
# Simpan baseline sebelum mengganti data/db_exports
python scripts/export_text_grouped.py --version v3.5 --record-only

# Setelah data/db_exports diganti dengan export game terbaru
python scripts/export_text_grouped.py --version v3.6
```

Ringkasan fingerprint dan perubahan disimpan di `data/version_history.json`,
sedangkan hash SHA-256 setiap database disimpan di
`data/version_manifests/`. Kedua metadata sumber tersebut dilacak Git. Setelah
data WebUI selesai digenerasi, login sebagai editor lalu gunakan **Create immutable
tag** pada halaman Versions untuk membuat snapshot row-level resmi di
`data/version_history.db`. Database ini lokal dan sengaja tidak disimpan Git.

Untuk membuat snapshot dari generated dataset lain tanpa mengganti working tree:

```sh
cd webui
npx tsx server/textVersionsCli.ts \
  --tag v3.5 \
  --source /path/to/generated-data \
  --note "Remote generated official dataset"
```

#### Ekspor Dialog Quest Terurut

```sh
python scripts/export_quest_ordered.py [path_ke_ConfigDB]
```

Output disimpan di `scripts/export_quest_ordered/`.

#### Ekspor Semua Teks Lokalisasi Terkelompok (Direkomendasikan)

```sh
python scripts/export_text_grouped.py [path_ke_ConfigDB]
```

Output disimpan di `data/quests/`.

### 2. Perbarui background launcher

Background video launcher resmi dapat diperbarui tanpa reverse engineering ulang
dengan downloader berikut:

```sh
python scripts/update_launcher_background.py
```

Script mengambil konfigurasi background dari CDN launcher Kuro, mencoba host CDN
media alternatif jika diperlukan, lalu memperbarui:

- `Web/Video/bg-video.mp4`
- `Web/assets.json` hanya pada `sha256` entry `bg-video.mp4`

Field `update_date` **tidak pernah diubah** oleh script ini karena field tersebut
digunakan launcher untuk countdown jadwal update game berikutnya. Entry `bgm.mp3`
dan URL publik asset juga dipertahankan.

Untuk mengambil dan memvalidasi asset tanpa mengubah file repository:

```sh
python scripts/update_launcher_background.py --dry-run
```

---

### 3. WebUI terpadu

Pastikan utilitas `zip` tersedia jika ingin memakai ekspor **Structured DB ZIP**.
Generate data lokal terlebih dahulu jika diperlukan, lalu jalankan aplikasi:

```sh
python scripts/export_text_grouped.py [path_ke_ConfigDB]
cd webui
npm install
npm run dev        # Vite :3000 + Express API :3001
npm run build      # Typecheck dan production build
npm run build:reader-index -- --force  # Bangun ulang read model SQLite dari JSON
npm start          # Menjalankan server hasil build
```

Dari root repository, alias verifikasi berikut meneruskan ke `webui/`:

```sh
npm run check
npm run build
npm run test:integration
```

`npm run dev` dan `npm start` mempertahankan kontrak login legacy WebUI.
Read model `data/quests/index.db` dihasilkan dari JSON mentah oleh
`build:reader-index`; server memverifikasi/provision index tersebut saat startup.
Read model menyimpan baris quest dan key dialog/option untuk pagination serta pencarian.
Endpoint request tidak melakukan fallback scan seluruh korpus jika index gagal.

Halaman aktif: **Reader**, **Workbench**, **Translation QA**, **Operations**, **Databases**, **Drafts**, dan **Versions**.

#### Translation QA

Dashboard `/qa` memeriksa placeholder/markup, teks kosong, sisa bahasa Inggris,
rasio panjang, tanda baca, glosarium, serta inkonsistensi salinan. Temuan dibagi
menjadi **Pass otomatis**, **Perlu review**, dan **Approved** setelah dikonfirmasi
editor. Setiap item menampilkan konteks baris sebelum/sesudah, dapat diberi catatan,
dan dapat diekspor untuk review offline. Issue `attachment_mismatch` menandai target
yang memiliki evidence kuat lebih cocok dengan source line lain dalam quest, termasuk
kandidat alternatif, confidence, skor, dan alasan. Detector ini hanya memberi sinyal
review dan tidak memindahkan teks secara otomatis.

```sh
# Scan korpus dan tampilkan ringkasan
npm run qa

# Ekspor temuan yang perlu direview
npm run qa -- --format csv --status review --output /tmp/wuwaid-translation-qa.csv
```

Status serta catatan review disimpan secara lokal di `data/translation_qa_reviews.json`;
hasil scan SQLite berada di `data/translation_qa.db`. Keduanya diabaikan Git dan
akan dibuat ulang atau dipertahankan otomatis oleh server.
Ekspor QA memerlukan login editor/admin dan dibatasi maksimal 10.000 item per request.

---

## Credits

- **[Lai-Hoang](https://github.com/Lai-Hoang)** — Terima kasih untuk repo [wuwa-viet-hoa](https://github.com/Lai-Hoang/wuwa-viet-hoa) dan metode code injector.
- **[CallMeDangDev](https://github.com/CallMeDangDev)** — Terima kasih untuk referensi WuwaVH dan launcher. Source code launcher WuwaID mengacu pada repo [WuwaVHLauncher](https://github.com/CallMeDangDev/WuwaVHLauncher).

## License

[MIT](LICENSE)
