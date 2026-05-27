# Referensi terjemahan en -> id dari repo ini: [TitoTFP/wuwa-bahasa-indonesia](https://github.com/TitoTFP/wuwa-bahasa-indonesia)

# WuWa Bahasa Indonesia
[![Discord](https://img.shields.io/badge/Discord-Join-7289DA?style=plastic&logo=discord&logoColor=white)](https://discord.gg/rhUKsb7V8r)

Patch terjemahan Bahasa Indonesia untuk **Wuthering Waves**.

---

## Panduan Instalasi

### Metode 1: Instalasi Otomatis melalui Launcher *(Direkomendasikan)*

Unduh **WuwaID Launcher** — aplikasi yang secara otomatis mengunduh dan memasang patch terjemahan ke folder yang sesuai:

[![Download Launcher](https://img.shields.io/badge/Download%20WuwaID%20Launcher-Latest-blue?style=for-the-badge&logo=github)](https://github.com/TitoTFP/WuwaID/releases/latest)

1. Unduh file `.zip` dari link di atas, lalu ekstrak.
2. Jalankan `WuwaIDLauncher.exe`.
3. Pilih folder instalasi game, lalu klik **Install**. Launcher akan menangani proses sisanya secara otomatis.

---

### Metode 2: Instalasi Manual

### 1. Unduh file

Buka halaman [**Releases**](../../releases), lalu unduh file berikut:

| File | Deskripsi |
|------|-----------|
| `WuWaID_99_P.pak` | File utama terjemahan Bahasa Indonesia |
| `hid.dll` | Loader untuk me-mount patch terjemahan secara otomatis |

<!-- > Catatan: jika nama file di Releases masih menggunakan nama lama seperti `WuWaID_99_P.pak`, sesuaikan nama file pada instruksi ini dengan file yang tersedia di release repo kamu. -->

### 2. Instalasi

**Langkah 1** — Salin file `.pak` ke folder berikut:

```text
{Folder game}\Client\Binaries\Win64\wuwaIndonesia\
```

> Jika folder `wuwaIndonesia` belum ada, buat folder baru dengan nama tersebut.

**Langkah 2** — Salin `hid.dll` ke folder yang sama dengan file `.exe` game:

```text
{Folder game}\Client\Binaries\Win64\
```

### Struktur folder setelah instalasi

```text
Client\Binaries\Win64\
├── hid.dll
├── Client-Win64-Shipping.exe
└── wuwaIndonesia\
    └── WuWaID_99_P.pak
```

### 3. Uninstall

Hapus file `hid.dll` dan folder `wuwaIndonesia`.

---

## Catatan

- Patch terjemahan bekerja dengan cara me-mount file `.pak` tambahan melalui proxy `hid.dll`.
- Patch ini **tidak mengubah file asli game**.
- Setelah game mendapatkan update, kamu mungkin perlu mengunduh ulang patch terjemahan terbaru dari halaman Releases.
- Gunakan patch ini dengan risiko masing-masing.

---

## Pengembangan (Development)

Untuk kontributor yang ingin mengembangkan terjemahan atau mengekstrak data dialog game:

### 1. Ekstraksi Database Game (`export_localization_db`)
Proyek C++ (DLL) untuk mengekstrak data SQLite dari virtual filesystem game (PAK) secara dinamis saat game berjalan.
* Hasil ekstraksi disimpan di folder `WuwaDBExport/`.
* Direktori `base/` berisi database konfigurasi utama (`db_flowState.db`, `db_QuestData.db`, dll).
* Direktori `zh-Hans/`, `en/`, `ja/` berisi database bahasa (`lang_multi_text.db`, `lang_speaker.db`).

### 2. Ekspor Dialog Terstruktur (`export_quest_ordered.py`)
Skrip Python untuk mengekstrak dialog/percakapan game dan menyusunnya rapi per chapter.
* Membaca basis data dari folder `WuwaDBExport/`.
* Menggunakan skema urutan quest dari `QUEST_ORDERED.json`.
* Jalankan dengan:
  ```bash
  python3 export_quest_ordered.py
  ```
* Hasil ekspor berupa file `dialogue.json` per quest yang disimpan di folder `export_quest_ordered/`.
* **Catatan Perbedaan Skema `QUEST_ORDERED.json` dengan Database Game:**
  * **Nama Act vs Nama Quest:** Beberapa quest utama di Journey Log menggunakan nama Act/Chapter sebagai display name (misal: `"By Moon's Grace"` dan `"To the Shore's End"`), sedangkan di basis data (`db_QuestData.db`) nama quest aslinya adalah `"Moonlit Reunion"` dan `"From the Echoes of Destruction"`. `QUEST_ORDERED.json` mengikuti nama tampilan di Journey Log.
  * **Pemisahan Quest UI:** Quest seperti `"Grand Warstorm"` dibagi menjadi `"Part I"` dan `"Part II"` di UI, serta sub-quest dropdown seperti `"Morning Star"` (Morning Star I - IV & Epilogue) tidak memiliki relasi parent-child langsung di database melainkan melalui `"A Stranger in a Strange Land"`.
  * **Placeholder:** Quest `"New journey awaits"` merupakan placeholder (`QuestTree_ToBeContinued`) untuk menandai kelanjutan cerita.

---

## Credits

- **[Lai-Hoang](https://github.com/Lai-Hoang)** — Terima kasih untuk repo [wuwa-viet-hoa](https://github.com/Lai-Hoang/wuwa-viet-hoa) dan metode code injector.
- **[CallMeDangDev](https://github.com/CallMeDangDev)** — Terima kasih untuk referensi WuwaVH dan launcher. Source code launcher WuwaID mengacu pada repo [WuwaVHLauncher](https://github.com/CallMeDangDev/WuwaVHLauncher).

## License

[MIT](LICENSE)
