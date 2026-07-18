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

| File                                             | Deskripsi                                              |
| ------------------------------------------------ | ------------------------------------------------------ |
| `pakchunk0-ID-WindowsNoEditor_1000_P.pak`        | File utama terjemahan Bahasa Indonesia                 |
| `winhttp.dll`                                    | Loader untuk me-mount patch terjemahan secara otomatis |

### 2. Instalasi

**Langkah 1** — Salin file `.pak` ke folder berikut:

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
    └── pakchunk0-ID-WindowsNoEditor_1000_P.pak
```

### 3. Uninstall

Hapus file `winhttp.dll` dan folder `wuwaIndonesia`.

### Kontrak Asset Release

Release baru hanya memuat satu file patch `pakchunk0-ID-WindowsNoEditor_1000_P.pak`, `winhttp.dll`, dan `SHA256sums.txt`. Daftar checksum wajib memuat dua file binary tersebut dan tidak memuat checksum untuk dirinya sendiri. Gunakan WuwaID Launcher `2.6.0` atau lebih baru sebelum beralih metode instalasi; Method 2 pada launcher lama masih meminta nama asset lama.

---

## Catatan

- Patch terjemahan bekerja dengan cara me-mount file `.pak` tambahan melalui proxy `winhttp.dll`.
- Patch ini **tidak mengubah file asli game**.
- Setelah game mendapatkan update, kamu mungkin perlu mengunduh ulang patch terjemahan terbaru dari halaman Releases.
- Gunakan patch ini dengan risiko masing-masing.

## Pengembangan & Ekspor Data (Developer)

Repositori ini menyediakan skrip Python untuk mengekstrak teks lokalisasi dari database game Wuthering Waves (`ConfigDB` atau `WuwaDBExport`).

### Persiapan

Pastikan folder database game (`ConfigDB` atau `WuwaDBExport`) diletakkan di direktori yang sesuai (misal: sejajar dengan skrip ini) atau tentukan path secara manual saat menjalankan skrip.

### 1. Ekspor Dialog Quest Terurut

Skrip `export_quest_ordered.py` mengekstrak dialog quest yang diorganisasikan berdasarkan chapter cerita utama dan side quest.

```sh
python export_quest_ordered.py [path_ke_ConfigDB]
```

Output akan disimpan di folder `export_quest_ordered/`.

### 2. Ekspor Semua Teks Lokalisasi Terkelompok (Direkomendasikan)

Skrip `export_text_grouped.py` mengekstrak dan mengelompokkan semua teks lokalisasi (item, skill, dialog quest, UI, dll.) berdasarkan kategori ke dalam file JSON. Skrip ini menghasilkan format data yang dibutuhkan oleh aplikasi web [wuwaid-quests](../wuwaid-quests).

```sh
python export_text_grouped.py [path_ke_ConfigDB]
```

Output akan disimpan di folder `export_text_grouped/`.

## Credits

- **[Lai-Hoang](https://github.com/Lai-Hoang)** — Terima kasih untuk repo [wuwa-viet-hoa](https://github.com/Lai-Hoang/wuwa-viet-hoa) dan metode code injector.
- **[CallMeDangDev](https://github.com/CallMeDangDev)** — Terima kasih untuk referensi WuwaVH dan launcher. Source code launcher WuwaID mengacu pada repo [WuwaVHLauncher](https://github.com/CallMeDangDev/WuwaVHLauncher).

## License

[MIT](LICENSE)
