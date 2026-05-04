# Referensi terjemahan en -> id dari repo ini: [TitoTFP/wuwa-bahasa-indonesia](https://github.com/TitoTFP/wuwa-bahasa-indonesia)

# WuWa Bahasa Indonesia
[![Discord](https://img.shields.io/badge/Discord-Join-7289DA?style=plastic&logo=discord&logoColor=white)](https://discord.com/)

Patch terjemahan Bahasa Indonesia untuk **Wuthering Waves**.

---

## Panduan Instalasi

### Metode 1: Instalasi Otomatis melalui Launcher *(Direkomendasikan)*

Unduh **WuwaVH Launcher** — aplikasi yang secara otomatis mengunduh dan memasang patch terjemahan ke folder yang sesuai:

[![Download Launcher](https://img.shields.io/badge/Download%20WuwaVH%20Launcher-Latest-blue?style=for-the-badge&logo=github)](https://github.com/CallMeDangDev/WuwaVHLauncher/releases/latest)

1. Unduh file `.zip` dari link di atas, lalu ekstrak.
2. Jalankan `WuwaVHLauncher.exe`.
3. Pilih folder instalasi game, lalu klik **Install**. Launcher akan menangani proses sisanya secara otomatis.

---

### Metode 2: Instalasi Manual

### 1. Unduh file

Buka halaman [**Releases**](../../releases), lalu unduh file berikut:

| File | Deskripsi |
|------|-----------|
| `WuWaID_99_P.pak` | File utama terjemahan Bahasa Indonesia |
| `UTMAlexander_100_P.pak` | Font pendukung |
| `version.dll` | Loader untuk me-mount patch terjemahan secara otomatis |

<!-- > Catatan: jika nama file di Releases masih menggunakan nama lama seperti `WuWaVH_99_P.pak`, sesuaikan nama file pada instruksi ini dengan file yang tersedia di release repo kamu. -->

### 2. Instalasi

**Langkah 1** — Salin file `.pak` ke folder berikut:

```text
{Folder game}\Client\Binaries\Win64\wuwaVietHoa\
```

> Jika folder `wuwaVietHoa` belum ada, buat folder baru dengan nama tersebut.

**Langkah 2** — Salin `version.dll` ke folder yang sama dengan file `.exe` game:

```text
{Folder game}\Client\Binaries\Win64\
```

### Struktur folder setelah instalasi

```text
Client\Binaries\Win64\
├── version.dll
├── Client-Win64-Shipping.exe
└── wuwaVietHoa\
    ├── WuWaID_99_P.pak
    └── UTMAlexander_100_P.pak
```

### 3. Uninstall

Hapus file `version.dll` dan folder `wuwaVietHoa`.

---

## Catatan

- Patch terjemahan bekerja dengan cara me-mount file `.pak` tambahan melalui proxy `version.dll`.
- Patch ini **tidak mengubah file asli game**.
- Setelah game mendapatkan update, kamu mungkin perlu mengunduh ulang patch terjemahan terbaru dari halaman Releases.
- Gunakan patch ini dengan risiko masing-masing.

## Credits

- **[Lai-Hoang](https://github.com/Lai-Hoang)** — Terima kasih untuk repo [wuwa-viet-hoa](https://github.com/Lai-Hoang/wuwa-viet-hoa) dan metode code injector.
- **[CallMeDangDev](https://github.com/CallMeDangDev)** — Terima kasih untuk referensi WuwaVH dan launcher.

## License

[MIT](LICENSE)
