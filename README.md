# Dev Assistant Bot

[![Case Study](https://img.shields.io/badge/Case_Study-Portfolio-007ACC?style=flat-square&logo=vercel)](https://thienhn.io.vn/projects/assisstantbot-telegram-overview)
[![Blog](https://img.shields.io/badge/Blog-VPS_Orchestration-orange?style=flat-square)](https://thienhn.io.vn/blog/zero-overhead-vps-orchestration-telegram-bot-pm2-nginx)
[![Author](https://img.shields.io/badge/Author-ThienHN-4FC08D?style=flat-square)](https://thienhn.io.vn/)

Telegram Dev Assistant & Multi-Target Deployment Suite cho lập trình viên, xây dựng bằng Node.js, Telegraf và Vue 3.  
Được thiết kế theo kiến trúc **Zero-Overhead** tối ưu hóa chuyên biệt cho máy chủ cấu hình thấp (GCP 1 vCPU / 1 GB RAM e2-micro/f1-micro) với giới hạn RAM nghiêm ngặt (200MB) và cơ chế tự động hóa DNS Cloudflare toàn diện.  
Dự án được phát triển và lưu trữ trong portfolio kỹ thuật của [ThienHN](https://thienhn.io.vn/).

---

## 🌟 Tính năng chính

### 1. 🖥️ Quản trị hệ thống & Giám sát (Host Health Suite)
- `/status`: Báo cáo thời gian thực về CPU (%), RAM (dùng/tổng), SWAP, Load Average và dung lượng đĩa trống (`/`).
- `/ps`: Top 5 tiến trình ngốn RAM & CPU nhiều nhất server (chẩn đoán nhanh tiến trình gây nghẽn/OOM).
- `/uptime`: Xem thời gian máy chủ đã hoạt động liên tục và thời điểm boot server.
- `/ip`: Lấy địa chỉ IP Public hiện tại của server (hỗ trợ kiểm tra qua API ifconfig/ipify).
- `/logs`: Đọc 20 dòng log lỗi PM2 gần nhất bằng cơ chế `tail -n 20` **miễn nhiễm OOM** (tiêu thụ 0 MB RAM).
- `/cleancache`: Xả RAM đệm an toàn và dọn sạch lịch sử log cũ của PM2 (`pm2 flush`).
- `/restart`: Khởi động lại bot từ xa qua PM2 an toàn kèm cờ giới hạn bộ nhớ `--max-memory-restart 200M`.
- `/update`: Tự động kéo mã nguồn mới nhất (`git pull`), cập nhật thư viện `npm` nếu cần, kiểm tra cú pháp và khởi động lại PM2 với trần 200MB RAM.
- `/notes`: Xem 10 dòng ghi chú gần nhất đã lưu (hoặc `/notes clear` để dọn dẹp file ghi chú).
- 🚨 **Background Watchdog**: Worker chạy nền định kỳ 5 phút tự động ping báo động Telegram khi **RAM > 85%** hoặc **Disk > 90%** (có cooldown 30 phút chống spam).

### 2. 🚀 Bộ công cụ triển khai đa nền tảng (Multi-Target Deployment Suite)
Hỗ trợ triển khai ứng dụng linh hoạt qua cả **Telegram Bot (1 chạm)** và **Web Dashboard**:

- **Nguồn triển khai (Deployment Sources)**:
  - 📦 **File ZIP Upload** (`/deploy`): Quét file `.zip` từ thư mục uploads hoặc gửi trực tiếp.
  - 🐙 **Public GitHub Repository**: Dán link GitHub public trực tiếp vào Telegram hoặc Dashboard.
- **Bộ nhận diện kho lưu trữ thông minh (Smart Repo Inspector)**:
  - **Web tĩnh thuần (`static_pure`)**: Trang HTML/CSS/JS không yêu cầu build -> Triển khai trực tiếp lên VPS Nginx. Không chạy `git clone` nặng đĩa, sử dụng GitHub zipball nhẹ và tự động làm phẳng (flatten) thư mục.
  - **Frontend SPA (`frontend_spa`)**: Dự án React, Vue, Vite, Next.js -> Triển khai lên Vercel Cloud để bảo toàn RAM cho VPS.
  - **Backend API (`backend_api`)**: Node.js/Express -> Triển khai lên Render hoặc VPS (quản lý PM2 nội bộ cổng riêng).
  - **Monorepo (`monorepo`)**: Tự động nhận diện cấu trúc Frontend + Backend -> Triển khai song song Frontend lên Vercel và Backend lên Render.
- **Tự động hóa Cloudflare DNS (Subdomain Routing)**:
  - Tự động tạo subdomain dạng `<project>.thienhn.io.vn`.
  - Tự động cấu hình **Bản ghi A** trỏ về IP VPS đối với ứng dụng host trên máy chủ.
  - Tự động cấu hình **Bản ghi CNAME** trỏ về `cname.vercel-dns.com` (Vercel) hoặc Render.
  - Tự động thu hồi bản ghi DNS khi gỡ bỏ dự án qua `/web_remove` hoặc Dashboard.
- **Quản lý vòng đời dịch vụ**:
  - `/web_list`: Xem danh sách toàn bộ dự án đang chạy (cả VPS, Vercel, Render), URL HTTPS và trạng thái.
  - `/web_remove <name>`: Gỡ bỏ web, giải phóng thư mục/tiến trình PM2 và xóa bản ghi Cloudflare DNS.

### 3. 📊 Web Dashboard điều khiển trung tâm (Vue 3 + Google OAuth)
- Giao diện trực quan hiện đại xây dựng bằng Vue 3 + Tailwind CSS, phục vụ tại `bot.thienhn.io.vn`.
- **Giám sát thời gian thực**: Trực quan hóa CPU, RAM, Disk, Uptime và trạng thái tiến trình PM2.
- **Bảng điều khiển Deployment**: Quản lý toàn bộ ứng dụng đã triển khai, huy hiệu phân loại nền tảng (VPS / Vercel / Render), đường dẫn truy cập và nút xóa (Undeploy) nhanh.
- **Modal Triển khai GitHub**: Phân tích trực tiếp cấu trúc repository từ GitHub URL, gợi ý nền tảng tối ưu và cho phép tùy biến subdomain trước khi deploy.
- **Bảo mật Google OAuth 2.0**: Chỉ duy nhất email được định danh trong `AUTHORIZED_GOOGLE_EMAIL` mới có quyền truy cập dashboard và thực thi API.

### 4. ⚡ Đo đạc hiệu năng (Performance Benchmarking)
- `/perf <name | domain | url>`:
  - **Đo độ trễ tại chỗ qua `curl -w` (0 MB RAM)**: Phân rã chi tiết thời gian phản hồi: DNS Lookup, TCP Connect, **TTFB (Time To First Byte)**, Total Duration, Size.
  - **Tích hợp Google PageSpeed Insights API**: Gọi API Google từ xa để chấm điểm Lighthouse Mobile (Score, FCP, LCP, TBT, CLS) mà không tốn 1MB RAM nào của VPS.

### 5. 🔒 Bảo mật & An toàn tài nguyên (Zero-Leakage Security & RAM Ceiling)
- **Kiểm soát truy cập nghiêm ngặt**:
  - Telegram ID whitelist (`AUTHORIZED_TELEGRAM_ID`) cho mọi tương tác bot.
  - Google OAuth whitelist (`AUTHORIZED_GOOGLE_EMAIL`) cho Web Dashboard.
  - Lệnh shell `/sh` giới hạn nghiêm ngặt theo danh mục an toàn (`config/whitelist.js`).
- **Trần giới hạn bộ nhớ (200MB RAM Ceiling)**:
  - Cấu hình `--max-memory-restart 200M` cho PM2 đảm bảo tiến trình tự động khởi động lại nếu vượt ngưỡng bộ nhớ, triệt tiêu nguy cơ OOM trên máy chủ cấu hình thấp.
- **An toàn chứng chỉ & Biến môi trường**:
  - Toàn bộ thông tin nhạy cảm lưu độc quyền trong `.env`, không ghi log hay phản hồi token/key ra giao diện.

---

## ⚙️ Biến môi trường (.env)

Tham khảo mẫu hoàn chỉnh tại [`.env.example`](.env.example):

| Biến | Mục đích | Bắt buộc | Mặc định / Ví dụ |
| :--- | :--- | :---: | :--- |
| `BOT_TOKEN` | Token Telegram bot cấp bởi @BotFather | Có | `123456789:ABC...` |
| `AUTHORIZED_TELEGRAM_ID` | Telegram User ID duy nhất được điều khiển bot | Có | `123456789` |
| `BASE_DOMAIN` | Tên miền gốc quản lý trên Cloudflare | Có | `thienhn.io.vn` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token (quyền `Zone.DNS:Edit`) | Có | *(API Token Cloudflare)* |
| `CLOUDFLARE_ZONE_ID` | Zone ID của tên miền trên Cloudflare | Có | *(Zone ID 32 ký tự)* |
| `VPS_PUBLIC_IP` | IP Public của máy chủ VPS (để tạo DNS bản ghi A) | Không | Tự động phát hiện qua API |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID cho Web Dashboard | Có (Dashboard) | `*.apps.googleusercontent.com` |
| `AUTHORIZED_GOOGLE_EMAIL` | Email Google duy nhất được phép đăng nhập Dashboard | Có (Dashboard) | `your_email@gmail.com` |
| `SESSION_SECRET` | Khóa bí mật ký token phiên làm việc Dashboard | Có (Dashboard) | *(Chuỗi ngẫu nhiên dài)* |
| `DASHBOARD_PORT` | Cổng HTTP nội bộ của Dashboard API (localhost) | Không | `3001` |
| `VERCEL_TOKEN` | Personal Access Token của Vercel (deploy Vercel) | Không | *(Vercel Token)* |
| `RENDER_API_KEY` | API Key của Render (deploy Render) | Không | `rnd_*` |
| `RENDER_OWNER_ID` | Owner / Team ID của Render | Không | `usr_*` |
| `PM2_PROCESS_NAME` | Tên tiến trình PM2 của bot | Không | `assistant-bot` |
| `WEB_DEPLOY_DIR` | Thư mục lưu mã nguồn web deploy trên VPS | Không | `/var/www` |
| `UPLOAD_DIR` | Thư mục nhận file zip upload | Không | `/home/hnt/uploads` |
| `PAGESPEED_API_KEY` | Google PageSpeed Insights API Key cho lệnh `/perf` | Không | *(Google API Key)* |

---

## 🛠️ Cài đặt & Vận hành

### 1. Yêu cầu hệ thống
- Hệ điều hành: Linux (Ubuntu 20.04/22.04 LTS hoặc Debian)
- Node.js: `>= 18.0.0`
- Nginx, PM2, tar / unzip, curl

### 2. Cài đặt trên máy chủ VPS
```bash
# 1. Clone repository về thư mục ứng dụng
git clone https://github.com/ThienHN0910/assistant-bot.git app
cd app

# 2. Cài đặt các gói phụ thuộc (chế độ production tiết kiệm RAM)
npm install --omit=dev

# 3. Tạo file cấu hình môi trường
cp .env.example .env
nano .env # Điền các biến môi trường cần thiết

# 4. Khởi chạy Bot với trần RAM 200MB qua PM2
pm2 start bot.js --name assistant-bot --max-memory-restart 200M
pm2 save
```

### Oracle Worker: chuẩn bị đường dẫn deploy và cổng web

Trên Oracle Worker, đặt `WEB_DEPLOY_DIR` thành đường dẫn tuyệt đối trong `.env` ở gốc repo, cài `unzip` và bảo đảm tài khoản chạy agent có quyền tạo thư mục tại đó. Nếu dùng thư mục trong home, Nginx còn cần quyền đi qua các thư mục cha; kiểm tra bằng `namei -l "$HOME/web"`. Agent chạy dưới tài khoản thường nhưng dùng `sudo -n` để cài/gỡ cấu hình site trong `/etc/nginx/conf.d`, chạy `nginx -t` và reload Nginx. Tài khoản chạy agent phải có sudo không cần mật khẩu cho `install`, `rm`, `nginx -t` và `systemctl reload nginx`; kiểm tra bằng `sudo -n -l` và `sudo -n nginx -t`. Phiên bản worker này chưa hỗ trợ helper sudo riêng. Không mở quyền ghi cho cả `/etc/nginx/conf.d`. Nếu bước cài đặt hoặc reload thất bại, bot sẽ hiển thị lỗi Oracle trả về.

Trong OCI Console, mở **Networking → Virtual Cloud Networks → VCN → Security Lists** (hoặc Network Security Group gắn với instance), thêm ingress TCP 80 và 443 từ nguồn cần phục vụ. Oracle lưu ý phải kiểm tra cả quy tắc mạng OCI và firewall trong hệ điều hành: [OCI security rules](https://docs.oracle.com/en-us/iaas/Content/Security/Reference/configuration_tasks.htm).

Trên máy Ubuntu dùng UFW, kiểm tra `sudo ufw status` rồi cho phép HTTP/HTTPS nếu UFW đang bật: `sudo ufw allow 80/tcp` và `sudo ufw allow 443/tcp`. Nếu máy dùng iptables, kiểm tra `sudo iptables -L INPUT -n --line-numbers`, rồi thêm quy tắc phù hợp với chính sách hiện có:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save # nếu đã cài netfilter-persistent
```

Cuối cùng chạy `sudo nginx -t`, kiểm tra `systemctl status nginx`, và thử truy cập domain từ bên ngoài. Nếu `.env` của Worker đang chứa `WEB_DEPLOY_DIR` cũ, cập nhật giá trị đó trước khi restart agent.

### 3. Cấu hình Nginx Reverse Proxy cho Dashboard
Tạo file `/etc/nginx/sites-available/web-dashboard.conf`:
```nginx
# 1. Chuyển hướng HTTP sang HTTPS
server {
    listen 80;
    server_name bot.thienhn.io.vn;
    return 301 https://$host$request_uri;
}

# 2. Phục vụ Dashboard và Proxy API
server {
    listen 443 ssl;
    server_name bot.thienhn.io.vn;

    ssl_certificate /etc/ssl/certs/cloudflare_cert.pem;
    ssl_certificate_key /etc/ssl/private/cloudflare_key.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    root /home/hnt/app/dashboard;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
}
```
Kích hoạt cấu hình:
```bash
sudo ln -sf /etc/nginx/sites-available/web-dashboard.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 4. Kiểm thử & Đảm bảo chất lượng (Verification Gate)
```bash
# Kiểm tra cú pháp toàn bộ file mã nguồn
npm run check:syntax

# Chạy toàn bộ 16 test suites tự động
npm test
```

### 5. Cập nhật mã nguồn tự động
Trên Telegram, chỉ cần gõ lệnh:
```
/update
```
Bot sẽ tự động thực hiện: `git pull origin main` ➔ `npm install` ➔ kiểm tra cú pháp ➔ khởi động lại PM2 với giới hạn bộ nhớ 200MB.

---

## 📁 Cấu trúc thư mục

```text
assistant-bot/
├── bot.js                      # Điểm khởi động chính, nạp lệnh, handlers và Dashboard API
├── dashboard/                  # Giao diện Web Dashboard
│   └── index.html              # Ứng dụng Single Page Vue 3 + Tailwind CSS + Google OAuth
├── commands/                   # Các mô-đun lệnh Telegram độc lập
│   ├── cleancache.js           # Xả RAM cache và pm2 flush
│   ├── deploy.js               # Deploy web tương tác (ZIP & GitHub) kèm inline buttons
│   ├── deploy_web.js           # Alias deploy VPS trực tiếp
│   ├── ip.js                   # Lấy IP public của server
│   ├── logs.js                 # Đọc log lỗi PM2 an toàn (OOM-safe tail)
│   ├── notes.js                # Quản lý ghi chú nhanh
│   ├── perf.js                 # Đo độ trễ TTFB và điểm Google PageSpeed
│   ├── ps.js                   # Top 5 tiến trình ngốn RAM & CPU
│   ├── restart.js              # Khởi động lại bot qua PM2 (giới hạn 200MB RAM)
│   ├── sh.js                   # Thực thi shell an toàn theo whitelist
│   ├── start.js                # Menu hướng dẫn sử dụng bot
│   ├── status.js               # Báo cáo phần cứng thời gian thực
│   ├── update.js               # Tự động cập nhật bot từ GitHub và restart PM2
│   ├── uptime.js               # Xem thời gian hoạt động liên tục của VPS
│   ├── web_list.js             # Liệt kê danh sách các web đang hoạt động
│   └── web_remove.js           # Gỡ bỏ web, giải phóng tài nguyên và DNS
├── config/                     # Cấu hình & tiện ích lõi
│   ├── env.js                  # Nạp và kiểm định biến môi trường nghiêm ngặt
│   ├── middleware.js           # Middleware kiểm soát quyền truy cập Telegram ID
│   ├── utils.js                # Tiện ích định dạng, escape HTML và OOM-safe tailing
│   └── whitelist.js            # Danh mục lệnh shell được phép thực thi
├── handlers/                   # Bộ xử lý tương tác người dùng
│   └── textHandler.js          # Nhận diện link GitHub tự động và tiếp nhận ghi chú
├── lib/                        # Thư viện dịch vụ lõi
│   ├── deployer.js             # Điều phối triển khai (Orchestrator: VPS, Vercel, Render)
│   ├── deployStore.js          # Quản lý trạng thái chờ xác nhận deploy tạm thời
│   ├── perf.js                 # Đo đạc HTTP TTFB và tích hợp PageSpeed Insights API
│   ├── repoInspector.js        # Phân tích cấu trúc repository GitHub (Pure Static, SPA, Backend, Monorepo)
│   ├── runner.js               # Thực thi command an toàn
│   ├── sandbox.js              # Quản lý vòng đời web VPS, giải nén ZIP, cấu hình Nginx
│   ├── whitelist.js            # Kiểm tra alias lệnh shell
│   └── providers/              # Adapter tích hợp các nhà cung cấp bên ngoài
│       ├── cloudflare.js       # Tự động hóa bản ghi DNS Cloudflare (Type A & CNAME)
│       ├── render.js           # Adapter triển khai dịch vụ lên Render Cloud
│       └── vercel.js           # Adapter triển khai ứng dụng lên Vercel Cloud
├── services/                   # Các dịch vụ nền
│   ├── dashboardApi.js         # REST API phục vụ Web Dashboard & xác thực Google OAuth
│   └── watchdog.js             # Service giám sát RAM/Disk định kỳ 5 phút
├── test/                       # 16 test suites kiểm thử tự động
├── docs/                       # Tài liệu hướng dẫn & đặc tả kỹ thuật
├── .env.example                # File cấu hình mẫu đã được vệ sinh thông tin nhạy cảm
├── AGENTS.md                   # Hướng dẫn và quy chuẩn vận hành cho AI Agents
├── CONTEXT.md                  # Từ vựng nghiệp vụ chuẩn (Domain Glossary)
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
