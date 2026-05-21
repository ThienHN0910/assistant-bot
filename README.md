# assistant-bot

Telegram bot trợ lý cá nhân cho lập trình viên, xây dựng bằng Node.js và Telegraf.

Bot hiện hỗ trợ:
- Kiểm tra tài nguyên server: CPU, RAM, SWAP và dung lượng đĩa còn trống
- Lấy IP public qua ipify
- Đọc 20 dòng cuối của file PM2 error log
- Xem uptime và thời điểm boot của server
- Lưu ghi chú từ các tin nhắn text thường vào file local
- Giới hạn truy cập theo một Telegram ID được cấp quyền
- Liệt kê file và thư mục, đọc file text, đổi thư mục làm việc
- Dọn cache an toàn, dọn cache npm, và dừng process PM2 cơ bản
- Chạy shell theo whitelist an toàn

## Tính năng chính

- Bảo mật:
  - Middleware chặn toàn bộ Telegram ID không khớp với `AUTHORIZED_TELEGRAM_ID`
- Lệnh Telegram:
  - `/start`: Hiển thị menu và các lệnh có sẵn
  - `/status`: Báo cáo CPU, RAM, SWAP và disk
  - `/ip`: Lấy IP public hiện tại
  - `/logs`: Đọc 20 dòng log lỗi PM2 gần nhất
  - `/uptime`: Xem thời gian uptime của server
- Text handler:
  - Tin nhắn text không bắt đầu bằng `/` sẽ được append vào file ghi chú
- Vận hành:
  - Xử lý graceful shutdown với `SIGINT` và `SIGTERM`
  - Bọc lỗi runtime để bot không thoát đột ngột khi gặp lỗi xử lý

## Yêu cầu

- Node.js 18+ (khuyến nghị LTS)
- npm 9+
- Telegram bot token từ BotFather
- Một Telegram user ID được phép dùng bot
- File PM2 error log hợp lệ cho lệnh `/logs`

## Cài đặt và chạy local

```bash
npm install
```

Tạo file `.env` từ mẫu:

- Windows PowerShell:

  ```powershell
  Copy-Item .env.example .env
  ```

- macOS/Linux:

  ```bash
  cp .env.example .env
  ```

Sau đó sửa `.env` với giá trị thật và chạy:

```bash
npm start
```

Nếu muốn chạy trực tiếp ở chế độ phát triển, dùng `npm run dev`.

## Biến môi trường

Tham khảo file [.env.example](.env.example).

- `BOT_TOKEN`:
  - Token của Telegram bot
- `AUTHORIZED_TELEGRAM_ID`:
  - Telegram user ID duy nhất được phép sử dụng bot
- `PM2_ERROR_LOG_PATH`:
  - Đường dẫn tới file error log của PM2 để lệnh `/logs` đọc nội dung
- `TIMEZONE`:
  - Múi giờ dùng khi lưu ghi chú, mặc định là `Asia/Ho_Chi_Minh`
- `NOTES_FILE_PATH`:
  - Đường dẫn file ghi chú cục bộ, mặc định là `./notes.txt`
- `PM2_PROCESS_NAME`:
  - Tên process PM2 để dùng cho `/stop`, mặc định là `dev-assistant-bot`

Ví dụ `PM2_ERROR_LOG_PATH`:
- Linux: `/home/ubuntu/.pm2/logs/dev-assistant-bot-error.log`
- Windows: `C:/Users/<user>/.pm2/logs/dev-assistant-bot-error.log`

## Scripts

```bash
npm start
npm run dev
npm run check:syntax
```

Ý nghĩa:
- `start` và `dev`: chạy bot bằng Node.js
- `check:syntax`: kiểm tra cú pháp các file JS chính bằng `node --check`

Lưu ý: dự án hiện chưa có bước transpile hoặc bundling, nên không có script `build` riêng.

## Cấu trúc dự án

```text
assistant-bot/
├── bot.js
├── commands/
│   ├── cat.js
│   ├── cd.js
│   ├── cleancache.js
│   ├── ip.js
│   ├── ls.js
│   ├── logs.js
│   ├── npmcache.js
│   ├── sh.js
│   ├── start.js
│   ├── status.js
│   ├── stop.js
│   └── uptime.js
├── config/
│   ├── env.js
│   ├── middleware.js
│   └── utils.js
├── handlers/
│   └── textHandler.js
├── docs/
│   ├── feature-matrix.md
│   └── shell-maintenance-spec.md
├── .env.example
├── .gitignore
├── LICENSE
├── package.json
└── README.md
```

## Chạy với PM2

```bash
npm install -g pm2
pm2 start bot.js --name dev-assistant-bot
pm2 status
pm2 logs dev-assistant-bot
pm2 save
```

## Lưu ý

- Xem [docs/feature-matrix.md](docs/feature-matrix.md) để biết trạng thái hiện tại của bot và các tính năng an toàn đã được bổ sung.
- Xem [docs/shell-maintenance-spec.md](docs/shell-maintenance-spec.md) để hiểu rõ whitelist shell, flow dọn cache, và các ràng buộc bảo mật của nhóm lệnh mới.
- File ghi chú sẽ được tạo hoặc append tự động khi bot nhận text thường.
- Tính năng khởi động lại process qua PM2 đã được gỡ bỏ để tránh rủi ro tự lặp khi điều khiển bot.
