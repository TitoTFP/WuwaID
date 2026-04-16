# WuWa Việt Hóa
[![Discord](https://img.shields.io/badge/Discord-Join-7289DA?style=plastic&logo=discord&logoColor=white)](https://discord.gg/KGqfAyzXBb)

Bản Việt hóa cho **Wuthering Waves**.

---

## Hướng dẫn cài đặt

### Phương thức 1: Cài đặt tự động qua Launcher *(Khuyến nghị)*

Tải **WuwaVH Launcher** — ứng dụng tự động tải và cài đặt bản Việt hóa vào đúng thư mục:

[![Download Launcher](https://img.shields.io/badge/Tải%20WuwaVH%20Launcher-Latest-blue?style=for-the-badge&logo=github)](https://github.com/CallMeDangDev/WuwaVHLauncher/releases/latest)

1. Tải file `.zip` từ link trên và giải nén.
2. Chạy `WuwaVHLauncher.exe`.
3. Chọn thư mục cài đặt game rồi nhấn **Cài đặt** — Launcher sẽ tự xử lý phần còn lại.

---

### Phương thức 2: Cài đặt thủ công

### 1. Tải file

Vào trang [**Releases**](../../releases) và tải về các file sau:

| File | Mô tả |
|------|--------|
| `WuWaVH_99_P.pak` | File Việt hóa chính |
| `UTMAlexander_100_P.pak` | Font tiếng Việt |
| `version.dll` | Loader tự động mount bản dịch |

### 2. Cài đặt

**Bước 1** — Copy các file `.pak` vào thư mục:

```
{Thư mục game}\Client\Binaries\Win64\wuwaVietHoa\
```

> Nếu chưa có thư mục `wuwaVietHoa`, hãy tạo mới.

**Bước 2** — Copy `version.dll` vào cùng thư mục với file `.exe` của game:

```
{Thư mục game}\Client\Binaries\Win64\
```

### Cấu trúc sau khi cài

```
Client\Binaries\Win64\
├── version.dll
├── Client-Win64-Shipping.exe
└── wuwaVietHoa\
    ├── WuWaVH_99_P.pak
    └── UTMAlexander_100_P.pak
```

### 3. Gỡ cài đặt

Xóa file `version.dll` và thư mục `wuwaVietHoa` là xong.

---

## Ghi chú

- Bản Việt hóa hoạt động bằng cách mount thêm file `.pak` qua `version.dll` proxy — **không** chỉnh sửa file gốc của game.
- Sau mỗi bản cập nhật game, có thể cần tải lại file Việt hóa mới từ Releases.

## Credits

- **[Lai-Hoang](https://github.com/Lai-Hoang)** — Cảm ơn bạn và repo [wuwa-viet-hoa](https://github.com/Lai-Hoang/wuwa-viet-hoa) cho code injector method.

## License

[MIT](LICENSE)
