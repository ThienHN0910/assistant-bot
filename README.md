# Dev Assistant Bot

[![Case Study](https://img.shields.io/badge/Case_Study-Portfolio-007ACC?style=flat-square&logo=vercel)](https://thienhn.io.vn/projects/assisstantbot-telegram-overview)
[![Blog](https://img.shields.io/badge/Blog-VPS_Orchestration-orange?style=flat-square)](https://thienhn.io.vn/blog/zero-overhead-vps-orchestration-telegram-bot-pm2-nginx)
[![Author](https://img.shields.io/badge/Author-ThienHN-4FC08D?style=flat-square)](https://thienhn.io.vn/)

Telegram Dev Assistant & Web Sandbox Suite cho lập trình viên, xây dựng bằng Node.js và Telegraf.  
Được tối ưu hóa đặc biệt cho máy chủ cấu hình thấp (GCP 1 vCPU / 1 GB RAM e2-micro/f1-micro) chạy dưới sự quản lý của PM2.  
Dự án được phát triển và lưu trữ trong portfolio kỹ thuật của [ThienHN](https://thienhn.io.vn/).

---

## 🌟 Tính năng chính

### 1. 🖥️ Quản trị hệ thống & Giám sát (Host Health Suite)
- `/status`: Báo cáo thời gian thực về CPU (%), RAM (dùng/tổng), SWAP, và dung lượng đĩa trống (`/`).
- `/ps`: Top 5 tiến trình ngốn RAM & CPU nhiều nhất server (chẩn đoán nhanh tiến trình gây nghẽn/OOM).
- `/uptime`: Xem thời gian máy chủ đã hoạt động liên tục và thời điểm boot server.
- `/ip`: Lấy địa chỉ IP Public hiện tại của server.
- `/logs`: Đọc 20 dòng log lỗi PM2 gần nhất bằng cơ chế `tail -n 20` **miễn nhiễm OOM** (tiêu thụ 0 MB RAM).
- `/cleancache`: Xả RAM đệm an toàn và dọn sạch lịch sử log cũ của PM2 (`pm2 flush`).
- `/restart`: Khởi động lại bot từ xa qua PM2 an toàn (gửi phản hồi trước khi restart).
- `/notes`: Xem 10 dòng ghi chú gần nhất đã lưu (hoặc `/notes clear` để dọn dẹp file ghi chú).
- 🚨 **Background Watchdog**: Worker chạy nền định kỳ 5 phút tự động ping báo động Telegram khi **RAM > 85%** hoặc **Disk > 90%** (có cooldown 30 phút chống spam).

### 2. 🚀 Web Sandbox & Deploy 1 chạm (Interactive Web Deploy)
- `/deploy`: Tự động quét file `.zip` từ thư mục upload (`~` hoặc `~/uploads`), hiển thị **Inline Buttons** trên Telegram.
- **Nhận diện thông minh**:
  - **Web tĩnh / SPA** (React, Vue, Vite, HTML/CSS): Nginx phục vụ trực tiếp qua HTTPS subdomain, không cấp port ứng dụng.
  - **Node.js Backend**: Tự chạy `npm install --omit=dev`, bật tiến trình con qua PM2 và cấu hình Nginx reverse proxy.
- **Backend Node.js**: Port chỉ dùng nội bộ localhost phía sau Nginx; URL công khai luôn dùng subdomain HTTPS.
- `/deploy_web <project> <file.zip>`: Triển khai ZIP lên VPS qua cùng luồng với `/deploy`.
- Vercel/Render tạm ẩn khỏi luồng deploy cho đến khi provider xác nhận website thật sự sẵn sàng; xóa deployment cloud cũ vẫn hoạt động (issue #36).
- `/web_list`: Xem danh sách web, trạng thái, dung lượng đĩa và URL HTTPS.
- `/web_remove <name>`: Gỡ bỏ web và bản ghi DNS thuộc deployment; lỗi được giữ để thử lại.

### 3. ⚡ Đo đạc hiệu năng (Performance Benchmarking)
- `/perf <name | domain | url>`:
  - **Đo độ trễ tại chỗ qua `curl -w` (0 MB RAM)**: Phân rã chi tiết thời gian phản hồi: DNS Lookup, TCP Connect, **TTFB (Time To First Byte)**, Total Duration, Size.
  - **Tích hợp Google PageSpeed Insights API**: Gọi API Google từ xa để chấm điểm Lighthouse Mobile (Score, FCP, LCP, TBT, CLS) mà không tốn 1MB RAM nào của VPS.

### 4. 🔒 Bảo mật & An toàn (Zero-Leakage Security)
- **Middleware lọc ID**: Chỉ duy nhất `AUTHORIZED_TELEGRAM_ID` mới có quyền gửi lệnh và tương tác với bot.
- `/sh`: Thực thi lệnh shell giới hạn nghiêm ngặt theo danh mục whitelist (`config/whitelist.js`).

---

## ⚙️ Biến môi trường (.env)

Tham khảo file [`.env.example`](.env.example):

| Biến | Ý nghĩa | Mặc định / Ví dụ |
| :--- | :--- | :--- |
| `BOT_TOKEN` | Token Telegram bot lấy từ @BotFather | *(Bắt buộc)* |
| `AUTHORIZED_TELEGRAM_ID` | Telegram user ID được phép điều khiển bot | *(Bắt buộc)* |
| `PM2_ERROR_LOG_PATH` | Đường dẫn file error log của PM2 | `/home/hnt/.pm2/logs/assistant-bot-error.log` |
| `TIMEZONE` | Múi giờ ghi nhận timestamp ghi chú | `Asia/Ho_Chi_Minh` |
| `NOTES_FILE_PATH` | Đường dẫn file ghi chú cục bộ | `./notes.txt` |
| `PM2_PROCESS_NAME` | Tên tiến trình PM2 của bot | `assistant-bot` |
| `WEB_DEPLOY_DIR` | Thư mục chứa các web sandbox | `/home/hnt/web` |
| `UPLOAD_DIR` | Thư mục nhận file zip upload | `/home/hnt/uploads` |
| `WEB_PORT_START` | Port localhost khởi đầu cho backend Node.js | `8081` |
| `PAGESPEED_API_KEY` | API Key Google PageSpeed Insights | *(Tuỳ chọn)* |

---

## 🛠️ Cài đặt & Vận hành

### 1. Cài đặt trên server
```bash
git clone https://github.com/ThienHN0910/assistant-bot.git app
cd app
npm install --omit=dev
cp .env.example .env
nano .env # điền token và authorized id
pm2 start bot.js --name assistant-bot
pm2 save
```

### 2. Kiểm thử & Đảm bảo chất lượng (Verification Gate)
```bash
# Kiểm tra cú pháp toàn bộ file mã nguồn
npm run check:syntax

# Chạy toàn bộ test suites
npm test
```

### 3. Cập nhật mã nguồn tự động
Trên Telegram, chỉ cần gõ:
```
/update
```
Bot sẽ tự động `git pull origin main`, cài gói thư viện và restart tiến trình PM2.

---

## 📁 Cấu trúc thư mục

```text
assistant-bot/
├── bot.js                  # Điểm khởi động chính, nạp command và khởi tạo Watchdog
├── commands/               # Các mô-đun lệnh bot độc lập
│   ├── cleancache.js       # Xả RAM cache và pm2 flush
│   ├── deploy.js           # Deploy web tương tác qua file ZIP và inline keyboard
│   ├── deploy_web.js       # Alias ZIP deploy trên VPS
│   ├── ip.js               # Lấy IP public server
│   ├── logs.js             # Đọc log lỗi PM2 an toàn (OOM-safe tail)
│   ├── notes.js            # Xem và xóa ghi chú
│   ├── perf.js             # Đo đạc độ trễ TTFB và PageSpeed
│   ├── ps.js               # Top 5 tiến trình ngốn RAM/CPU
│   ├── restart.js          # Khởi động lại bot an toàn qua PM2
│   ├── sh.js               # Chạy shell theo whitelist an toàn
│   ├── start.js            # Menu hướng dẫn và reply keyboard
│   ├── status.js           # Báo cáo phần cứng thời gian thực
│   ├── update.js           # Tự động cập nhật code từ GitHub
│   ├── uptime.js           # Thời gian hoạt động liên tục của server
│   ├── web_list.js         # Liệt kê danh sách các web đang host
│   └── web_remove.js       # Gỡ bỏ web test và giải phóng tài nguyên
├── config/
│   ├── env.js              # Nạp và kiểm định biến môi trường
│   ├── middleware.js       # Middleware kiểm soát quyền truy cập ID
│   ├── utils.js            # Tiện ích định dạng, escape HTML và OOM-safe tailing
│   └── whitelist.js        # Cấu hình danh mục lệnh shell được phép
├── handlers/
│   └── textHandler.js      # Bắt tin nhắn text thường để lưu ghi chú
├── lib/
│   ├── perf.js             # Đo độ trễ HTTP bằng curl/node & PageSpeed API
│   ├── runner.js           # Bộ thực thi child_process an toàn
│   ├── sandbox.js          # Quản lý vòng đời web deploy, unzipping, Nginx & PM2
│   └── whitelist.js        # Logic xử lý alias whitelist
├── services/
│   └── watchdog.js         # Service giám sát RAM/Disk định kỳ 5 phút
├── test/                   # Toàn bộ test suites
│   ├── monitoring.test.js
│   ├── perf.test.js
│   ├── sandbox.test.js
│   ├── utils.test.js
│   └── whitelist.test.js
├── docs/                   # Tài liệu chi tiết & agent skills config
│   ├── agents/
│   ├── commands-guide.md
│   ├── feature-matrix.md
│   ├── shell-maintenance-spec.md
│   └── whitelist.md
├── .env.example
├── .gitignore
├── AGENTS.md
├── package.json
└── README.md
```

---

## 🌐 Case Study & Kỹ thuật chuyên sâu

Dự án này là một phần trong danh mục giải pháp DevOps & Bot Automation của [ThienHN](https://thienhn.io.vn/):
- 📌 **Chi tiết Case Study dự án**: [Assistant Bot Telegram Overview](https://thienhn.io.vn/projects/assisstantbot-telegram-overview)
- 📖 **Bài viết chuyên sâu về kiến trúc**: [Zero-Overhead VPS Orchestration: Telegram Bot + PM2 + Nginx](https://thienhn.io.vn/blog/zero-overhead-vps-orchestration-telegram-bot-pm2-nginx)
- ⚖️ **So sánh kiến trúc Bot**: [Bot Engineering Showdown: Facebook Webhooks vs Telegram API](https://thienhn.io.vn/blog/bot-engineering-showdown-facebook-webhooks-vs-telegram-api)
- 🚀 **Khám phá thêm các dự án khác**: [Portfolio Projects Showcase](https://thienhn.io.vn/projects)
