# Countdown Date Automation Design

## Tujuan

Menghilangkan perubahan manual pada `Web/assets.json` dengan menyelaraskan
`update_date` terhadap waktu rilis versi game berikutnya yang ditampilkan oleh
`https://wuthering-countdown.gengamer.in/`.

## Ruang lingkup

- Menambahkan satu script Python berbasis standard library untuk mengambil,
  memvalidasi, mengonversi, dan menulis waktu rilis.
- Menambahkan satu GitHub Actions workflow terjadwal yang menjalankan script
  dan melakukan commit langsung ke branch `main` bila tanggal berubah.
- Menambahkan unit test untuk parsing tanggal, konversi zona waktu, validasi,
  dan pembaruan JSON.
- Tidak mengubah launcher, desain UI, atau entri `assets` lain.

## Sumber data

Halaman countdown menyimpan waktu rilis di JavaScript sebagai
`releaseTimeOriginal`, contohnya:

```javascript
const releaseTimeOriginal = new Date('August 20, 2026 11:00:00 UTC+8').getTime();
```

Script mengambil halaman melalui HTTPS dan hanya menerima nilai dari deklarasi
tersebut. Timestamp harus memiliki tanggal, waktu, dan offset UTC eksplisit.
Nilai kemudian dikonversi ke UTC. Contoh di atas menjadi
`2026-08-20T03:00:00`, sesuai format yang sudah dikonsumsi launcher.

## Komponen

### Script sinkronisasi

Satu file Python di `scripts/` memiliki batas tanggung jawab berikut:

1. Mengunduh HTML dengan timeout dan User-Agent yang jelas.
2. Mengekstrak tepat satu nilai `releaseTimeOriginal`.
3. Mem-parse offset seperti `UTC+8` tanpa dependency pihak ketiga.
4. Menghasilkan timestamp UTC berformat `YYYY-MM-DDTHH:MM:SS`.
5. Membaca `Web/assets.json` dan hanya mengganti `update_date` bila timestamp
   baru lebih besar daripada nilai yang tersimpan.
6. Menulis file hanya ketika nilai berubah dan melaporkan status melalui exit
   code serta output singkat.

Parser dan fungsi pembaruan JSON dipisahkan dari akses jaringan agar dapat
diuji tanpa memanggil situs eksternal.

### GitHub Actions

Workflow:

- berjalan satu kali per minggu dengan `schedule` (`0 0 * * 0`, setiap Minggu
  pukul 00:00 UTC);
- menyediakan `workflow_dispatch` untuk eksekusi manual;
- menggunakan Python bawaan runner Ubuntu;
- memiliki `permissions: contents: write`;
- memakai `concurrency` agar dua proses tidak menulis bersamaan;
- menjalankan unit test sebelum sinkronisasi;
- menjalankan script terhadap halaman countdown dan `Web/assets.json`;
- menghentikan proses tanpa commit ketika tidak ada perubahan;
- melakukan commit dan push langsung ke `main` ketika file berubah, dengan
  pesan `chore: update game countdown date`.

Checkout dilakukan dari branch `main`. Push menggunakan `GITHUB_TOKEN` bawaan,
tanpa secret tambahan.

## Validasi dan penanganan kegagalan

Workflow gagal tanpa mengubah atau meng-commit file apabila:

- halaman tidak dapat diambil sebelum timeout;
- deklarasi `releaseTimeOriginal` hilang, berjumlah lebih dari satu, atau
  formatnya berubah;
- timestamp sumber tidak valid;
- `assets.json` tidak valid atau tidak memiliki `update_date` string;
- timestamp sumber lebih lama daripada nilai tersimpan.

Timestamp yang sama dianggap kondisi normal tanpa perubahan, bukan kegagalan.
Timestamp yang lebih lama dianggap kegagalan agar situs yang belum diperbarui
atau kembali ke data lama tidak menurunkan countdown launcher.

Jika push ditolak karena `main` berubah sesudah checkout, workflow gagal dan
jadwal berikutnya mencoba lagi. Workflow tidak melakukan force-push atau merge
otomatis.

## Pengujian

Unit test berbasis `unittest` mencakup:

- ekstraksi dan konversi contoh `August 20, 2026 11:00:00 UTC+8` menjadi
  `2026-08-20T03:00:00`;
- penolakan halaman tanpa deklarasi atau dengan deklarasi ambigu;
- pembaruan hanya pada `update_date` tanpa mengubah isi `assets`;
- no-op untuk timestamp yang sama;
- penolakan timestamp yang lebih lama.

Workflow tidak menguji jaringan melalui mock. Unit test menguji HTML fixture
lokal, sedangkan eksekusi terjadwal menjadi pemeriksaan integrasi langsung
terhadap situs sumber.

## Kriteria keberhasilan

- Tanggal baru pada situs masuk ke `Web/assets.json` maksimal tujuh hari setelah
  situs diperbarui, atau segera melalui `workflow_dispatch`.
- Commit hanya dibuat ketika `update_date` meningkat.
- Kegagalan jaringan atau perubahan format sumber tidak merusak JSON dan tidak
  menghasilkan commit.
- Launcher tetap menerima format timestamp yang sama seperti sebelumnya.
