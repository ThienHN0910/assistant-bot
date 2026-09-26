# Dev Assistant Bot & Multi-VPS Orchestrator

[![Case Study](https://img.shields.io/badge/Case_Study-Portfolio-007ACC?style=flat-square&logo=vercel)](https://thienhn.io.vn/projects/assisstantbot-telegram-overview)
[![Blog](https://img.shields.io/badge/Blog-VPS_Orchestration-orange?style=flat-square)](https://thienhn.io.vn/blog/zero-overhead-vps-orchestration-telegram-bot-pm2-nginx)
[![Author](https://img.shields.io/badge/Author-ThienHN-4FC08D?style=flat-square)](https://thienhn.io.vn/)
[![Tests](https://img.shields.io/badge/Tests-25%20Suites%20Passing-brightgreen?style=flat-square)](test/)
[![Security](https://img.shields.io/badge/Security-Zero--Leakage%20%7C%20HSTS-blue?style=flat-square)](AGENTS.md)

Telegram Dev Assistant & Multi-Target Cloud Orchestrator cho lập trình viên, xây dựng bằng Node.js, Telegraf, Nginx và Vue 3.  
Hệ thống hoạt động theo mô hình **Hub & Spoke Multi-VPS Cluster**: máy chủ trung tâm **GCP e2-micro (Master)** điều phối các **Worker Nodes (Oracle Cloud Ampere)** cùng các nền tảng PaaS (**Vercel**, **Render**) và dịch vụ DNS tự động hóa (**Cloudflare**).

Toàn bộ hệ thống tuân thủ triết lý **Zero-Overhead** (tiêu thụ RAM cực thấp, Worker Agent < 25MB RAM, trần an toàn PM2 100MB/200MB, triệt tiêu nguy cơ OOM) kèm chuẩn bảo mật HTTPS/HSTS và Safe Whitelisted Terminal 15 câu lệnh DevOps toàn diện.

---

## 🌟 Tính năng chính

### 1. 🌐 Điều phối cụm máy chủ Multi-VPS (Hub & Spoke Cluster Orchestration)
- **Kiến trúc Hub & Spoke tập trung**:
  - **Master Node (GCP e2-micro)**: Chạy Telegram Bot chính, Dashboard API trung tâm và Nginx Reverse Proxy.
  - **Worker Nodes (Oracle Cloud VM / VPS phụ trợ)**: Chạy `assistant-node-agent` daemon siêu nhẹ (<25MB RAM, viết bằng HTTP native, bảo vệ bằng `X-Agent-Secret`).
- **Lệnh quản trị cụm (Cluster Commands)**:
  - `/nodes`: Liệt kê tất cả các máy chủ trong cụm, trạng thái kết nối (Online/Offline/Master), IP đã được che chắn an toàn (`168.***.***.235`).
  - `/status [node_id]`: Báo cáo thời gian thực về tài nguyên phần cứng (CPU %, RAM dùng/tổng, SWAP, Load Average, Disk) cho toàn bộ cụm hoặc từng máy chủ cụ thể. Cảnh báo tự động nếu CPU/RAM vượt 80%.
  - `/update [node_id | all]`: Tự động kéo mã nguồn mới nhất (`git pull`), cập nhật thư viện `npm`, kiểm tra cú pháp và khởi động lại PM2 đồng loạt cho mọi máy chủ hoặc máy chủ được chỉ định.
- **Che giấu địa chỉ IP (Zero-Leakage IP Masking)**:
  - Mọi địa chỉ IP public trên giao diện Telegram và Web Dashboard đều được che chắn tự động (chỉ giữ octet đầu và cuối: `34.***.***.133`, `168.***.***.235`).

### 2. 💻 Safe Whitelisted Terminal (/sh) - Full DevOps Suite
Cung cấp môi trường dòng lệnh an toàn, **miễn nhiễm 100% với Command Injection**, hỗ trợ thực thi trên cả Telegram Bot và Web Dashboard:
- **15 Bí danh an toàn (Safe Aliases)**:
  - **Tài nguyên & Phần cứng**: `/uptime`, `/disk-usage` (`df -h`), `/mem-check` (`free -h`), `/cpu-info` (`lscpu`), `/top-procs` (`ps aux --sort=-%mem`), `/os-release` (`cat /etc/os-release`).
  - **Mạng & Reverse Proxy**: `/netstat-listen` (`ss -tuln`), `/nginx-test` (`sudo nginx -t`), `/nginx-status` (`sudo systemctl status nginx`).
  - **Quản trị PM2**: `/pm2-list` (`pm2 list`), `/pm2-status` (`pm2 status`), `/pm2-restart <app>`, `/pm2-logs <app>` (xem 30 dòng log gần nhất).
  - **Mã nguồn Git**: `/git-status` (`git status`), `/git-log` (`git log --oneline -5`).
- **Khử mã màu terminal (ANSI Escape Stripping)**: Tự động lọc bỏ các mã điều khiển ANSI (`[1m [36m`), trả về văn bản sạch sẽ, dễ đọc.
- **Chặn đứng lệnh nguy hiểm**: Bất kỳ câu lệnh không nằm trong whitelist (như `rm`, `eval`, `curl | bash`, `;`, `&&`) đều bị từ chối an toàn kèm mã lỗi rõ ràng.

### 3. 🚀 Triển khai đa nền tảng 1 chạm (Multi-Target Deployment Suite)
- **Nguồn triển khai linh hoạt**:
  - 📦 **File ZIP Upload** (`/deploy`): Tải file `.zip` trực tiếp lên chat Telegram hoặc thư mục uploads. Hỗ trợ chọn triển khai vào cụ thể máy chủ VPS nào trong cụm (`gcp-master` hoặc `oracle-worker`).
  - 🐙 **Public GitHub Repository**: Dán link GitHub trực tiếp vào Telegram hoặc Dashboard.
- **Bộ nhận diện kho lưu trữ thông minh (Smart Repo Inspector)**:
  - **Web tĩnh thuần (`static_pure`)**: Tải trực tiếp GitHub tarball/zipball nhẹ, tự động làm phẳng thư mục và phục vụ qua Nginx VPS.
  - **Frontend SPA (`frontend_spa`)**: React, Vue, Vite, Next.js -> Điều hướng sang Vercel Cloud để giải phóng RAM cho máy chủ.
  - **Backend API (`backend_api`)**: Node.js/Express -> Triển khai lên Render Cloud hoặc VPS Worker (quản lý PM2 nội bộ cổng riêng).
  - **Monorepo (`monorepo`)**: Tự động nhận diện cấu trúc Frontend + Backend -> Triển khai song song Frontend lên Vercel và Backend lên Render.
- **Tự động hóa Cloudflare DNS (Subdomain Routing)**:
  - Tự động tạo subdomain dạng `<project>.thienhn.io.vn`.
  - Tự động tạo **Bản ghi A** trỏ về đúng IP của VPS được chọn (`gcp-master` hoặc `oracle-worker`).
  - Tự động tạo **Bản ghi CNAME** trỏ về Vercel (`cname.vercel-dns.com`) hoặc Render.
  - Tự động thu hồi bản ghi DNS khi gỡ bỏ dự án qua `/web_remove` hoặc Dashboard.
- **Quản lý dịch vụ**:
  - `/web_list`: Xem danh sách toàn bộ web đang chạy kèm thông tin máy chủ lưu trữ (GCP Master, Oracle Worker, Vercel, Render), URL HTTPS và nút bấm thao tác nhanh (`/perf`, `/web_remove`).
  - `/web_remove <name>`: Gỡ bỏ web, giải phóng thư mục/tiến trình PM2 và dọn sạch bản ghi Cloudflare DNS.

### 4. 📊 Web Dashboard điều khiển trung tâm (Vue 3 + Tailwind CSS + Google OAuth)
- Phục vụ tại `https://bot.thienhn.io.vn/` với kiến trúc Single Page Application tách rời mã nguồn ([`dashboard/index.html`](dashboard/index.html) và [`dashboard/app.js`](dashboard/app.js)).
- **Giám sát thời gian thực & Biểu đồ Chart.js**: Hiển thị card trạng thái cho từng node trong cụm (CPU %, RAM, Disk, Uptime) kèm biểu đồ đo tải trực quan.
- **Quản lý danh sách dịch vụ**: Thống kê toàn bộ website đang hoạt động, bộ lọc tìm kiếm, nút kiểm tra hiệu năng và gỡ bỏ 1 chạm.
- **Web Terminal trực quan**: Tích hợp thanh chọn máy chủ, danh sách chọn nhanh alias whitelist, ô nhập lệnh tùy chỉnh và nút `🧹 Xóa` màn hình console.
- **Sổ ghi chú cá nhân (/notes)**: Quản lý ghi chú nhanh đồng bộ giữa Telegram và Dashboard.
- **Bảo mật Google OAuth 2.0 (GIS)**: Chỉ duy nhất tài khoản trong `AUTHORIZED_GOOGLE_EMAIL` mới có quyền truy cập và ký nhận JWT Session token.

### 5. 🔒 Bảo mật HTTPS/HSTS & Tối ưu hóa Nginx
- **Cấu hình HSTS (HTTP Strict Transport Security)**:
  - Kích hoạt `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
  - Bổ sung các header bảo vệ: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Content Security Policy (CSP)**: Chỉ thị `<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">` đảm bảo mọi yêu cầu đều được nâng cấp an toàn lên HTTPS.
- **Cloudflare Origin CA Certificate**: Mã hóa toàn trình giữa Cloudflare Edge và máy chủ gốc theo chuẩn SSL Full / Full (Strict).

### 6. ⚡ Đo đạc hiệu năng (Performance Benchmarking)
- `/perf <name | domain | url>`:
  - **Đo độ trễ tại chỗ qua `curl -w` (0 MB RAM)**: Phân rã chi tiết thời gian phản hồi: DNS Lookup, TCP Connect, **TTFB (Time To First Byte)**, Total Duration, Size.
  - **Tích hợp Google PageSpeed Insights API**: Gọi API Google từ xa để chấm điểm Lighthouse Mobile (Score, FCP, LCP, TBT, CLS) mà không tốn tài nguyên của VPS.

---

## ⚙️ Biến môi trường (.env)

Tham khảo mẫu hoàn chỉnh đã được vệ sinh tại [`.env.example`](.env.example):

| Biến | Mục đích | Bắt buộc | Mặc định / Ví dụ |
| :--- | :--- | :---: | :--- |
| `BOT_TOKEN` | Token Telegram bot cấp bởi @BotFather | Có | `123456789:ABC...` |
| `AUTHORIZED_TELEGRAM_ID` | Telegram User ID duy nhất được điều khiển bot | Có | `123456789` |
| `BASE_DOMAIN` | Tên miền gốc quản lý trên Cloudflare | Có | `thienhn.io.vn` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token (quyền `Zone.DNS:Edit`) | Có | *(API Token Cloudflare)* |
| `CLOUDFLARE_ZONE_ID` | Zone ID của tên miền trên Cloudflare | Có | *(Zone ID 32 ký tự)* |
| `VPS_PUBLIC_IP` | IP Public của Master Node (tạo DNS bản ghi A) | Không | Tự động phát hiện qua API |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID cho Web Dashboard | Có (Dashboard) | `*.apps.googleusercontent.com` |
| `AUTHORIZED_GOOGLE_EMAIL` | Email Google duy nhất được phép đăng nhập Dashboard | Có (Dashboard) | `your_email@gmail.com` |
| `SESSION_SECRET` | Khóa bí mật ký token JWT phiên làm việc Dashboard | Có (Dashboard) | *(Chuỗi ngẫu nhiên dài)* |
| `DASHBOARD_PORT` | Cổng HTTP nội bộ của Dashboard API (localhost) | Không | `3001` |
| `NODE_AGENT_SECRET` | Khóa bí mật giao tiếp giữa Master và Worker Agent | Có (Multi-VPS) | *(Secret token bảo mật)* |
| `VERCEL_TOKEN` | Personal Access Token của Vercel (deploy Vercel) | Không | *(Vercel Token)* |
| `RENDER_API_KEY` | API Key của Render (deploy Render) | Không | `rnd_*` |
| `RENDER_OWNER_ID` | Owner / Team ID của Render | Không | `usr_*` |
| `PM2_PROCESS_NAME` | Tên tiến trình PM2 của bot | Không | `assistant-bot` |
| `WEB_DEPLOY_DIR` | Thư mục lưu mã nguồn web deploy trên VPS | Không | `/home/hnt/web` |
| `UPLOAD_DIR` | Thư mục nhận file zip upload | Không | `/home/hnt/uploads` |
| `PAGESPEED_API_KEY` | Google PageSpeed Insights API Key cho lệnh `/perf` | Không | *(Google API Key)* |

---

## 🛠️ Cài đặt & Vận hành

### 1. Triển khai Master Node (GCP e2-micro)
```bash
# 1. Clone repository về thư mục ứng dụng
git clone https://github.com/ThienHN0910/assistant-bot.git app
cd app

# 2. Cài đặt các gói phụ thuộc (chế độ production tiết kiệm RAM)
npm install --omit=dev

# 3. Tạo file cấu hình môi trường
cp .env.example .env
nano .env # Điền BOT_TOKEN, AUTHORIZED_TELEGRAM_ID, CLOUDFLARE_*, GOOGLE_*, SESSION_SECRET, NODE_AGENT_SECRET

# 4. Đăng ký các node trong cụm tại data/nodes.json
nano data/nodes.json

# 5. Khởi chạy Bot với trần RAM 200MB qua PM2
pm2 start bot.js --name assistant-bot --max-memory-restart 200M
pm2 save
```

### 2. Triển khai Worker Node (Oracle Cloud VM)
Worker Agent là dịch vụ độc lập siêu nhẹ (`agent/server.js`) tiêu thụ < 25MB RAM:
```bash
# 1. Clone repository trên máy chủ Worker
git clone https://github.com/ThienHN0910/assistant-bot.git app
cd app

# 2. Cài đặt các gói phụ thuộc riêng cho Worker Agent
npm ci --prefix agent --omit=dev

# 3. Thiết lập biến môi trường
cp .env.example .env
nano .env # Điền NODE_AGENT_SECRET, AGENT_PORT=3001, WEB_DEPLOY_DIR=/home/ubuntu/web

# 4. Khởi chạy Worker Agent với trần RAM nghiêm ngặt 100MB qua PM2
pm2 start agent/server.js --name assistant-node-agent --max-memory-restart 100M
pm2 save
```

### 3. Cấu hình Nginx Reverse Proxy & Bảo mật SSL (Master Node)
File cấu hình `/etc/nginx/sites-available/web-dashboard.conf`:
```nginx
# 1. Chuyển hướng HTTP sang HTTPS
server {
    listen 80;
    server_name bot.thienhn.io.vn;
    return 301 https://$host$request_uri;
}

# 2. Phục vụ Dashboard và Proxy API với chứng chỉ Cloudflare Origin CA
server {
    listen 443 ssl;
    server_name bot.thienhn.io.vn;

    ssl_certificate /etc/ssl/certs/cloudflare_cert.pem;
    ssl_certificate_key /etc/ssl/private/cloudflare_key.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security & HSTS Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    root /home/hnt/app/telegram-bot/dashboard;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Reverse proxy API về Node.js (cổng 3001)
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

Kích hoạt và nạp lại cấu hình:
```bash
sudo ln -sf /etc/nginx/sites-available/web-dashboard.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 📖 Danh mục lệnh Telegram Bot

| Lệnh | Mô tả | Ví dụ sử dụng & Cờ hỗ trợ |
| :--- | :--- | :--- |
| `/start` | Xem menu hướng dẫn sử dụng chi tiết | `/start` |
| `/status` | Báo cáo tài nguyên CPU, RAM, Disk của toàn bộ cụm | `/status` hoặc `/status oracle-worker` (hỗ trợ `-h`) |
| `/nodes` | Xem danh sách các máy chủ trong cụm Multi-VPS | `/nodes` (hỗ trợ `-h`) |
| `/ps` | Top tiến trình ngốn RAM & CPU nhất máy chủ | `/ps` hoặc `/ps oracle-worker` (hỗ trợ `-h`) |
| `/uptime` | Thời gian máy chủ đã hoạt động liên tục | `/uptime` (hỗ trợ `-h`) |
| `/ip` | Kiểm tra IP Public hiện tại của máy chủ | `/ip` (hỗ trợ `-h`) |
| `/logs` | Đọc 20 dòng log lỗi PM2 gần nhất (OOM-safe) | `/logs` hoặc `/logs 50 oracle-worker` (hỗ trợ `-h`) |
| `/cleancache` | Xả PageCache RAM Linux và `pm2 flush` | `/cleancache` hoặc `/cleancache all` (hỗ trợ `-h`) |
| `/restart` | Khởi động lại bot từ xa qua PM2 an toàn | `/restart` hoặc `/restart oracle-worker` (hỗ trợ `-h`) |
| `/update` | Kéo git mới nhất, cài npm và restart PM2 | `/update` hoặc `/update all` (hỗ trợ `-h`) |
| `/deploy` | Triển khai web tương tác (ZIP / GitHub) | `/deploy` hoặc gửi link GitHub / file `.zip` |
| `/web_list` | Danh sách website đang chạy kèm nút thao tác | `/web_list` (hỗ trợ `-h`) |
| `/web_remove` | Gỡ bỏ website và xóa Cloudflare DNS | `/web_remove <project_name>` (hỗ trợ `-h`) |
| `/perf` | Đo độ trễ TTFB và điểm Google PageSpeed | `/perf <project_name | url>` (hỗ trợ `-h`) |
| `/notes` | Quản lý sổ ghi chú nhanh | `/notes` hoặc `/notes clear` (hỗ trợ `-h`) |
| `/sh` | Chạy lệnh shell an toàn theo Whitelist | `/sh /uptime` hoặc `/sh oracle-worker /pm2-list` |

---

## 📁 Cấu trúc thư mục (Modular Architecture)

```text
assistant-bot/
├── agent/                          # Worker Agent Daemon độc lập (< 25MB RAM)
│   ├── agentSandbox.js             # Quản lý sandbox, giải nén zip, reload Nginx trên Worker
│   ├── package.json                # Bộ phụ thuộc riêng cho Worker
│   └── server.js                   # REST API daemon (cổng 3001) bảo vệ bằng X-Agent-Secret
├── bot.js                          # Điểm khởi động bot Telegram, nạp middleware và dashboard server
├── commands/                       # Các mô-đun lệnh Telegram độc lập
│   ├── cleancache.js               # Xả RAM cache và pm2 flush
│   ├── deploy.js                   # Deploy tương tác kèm chọn node VPS mục tiêu
│   ├── deploy_web.js               # Alias deploy VPS trực tiếp
│   ├── ip.js                       # Lấy IP public của server
│   ├── logs.js                     # Đọc log lỗi PM2 an toàn (OOM-safe tail)
│   ├── nodes.js                    # Quản lý và xem danh sách cụm Multi-VPS
│   ├── notes.js                    # Quản lý ghi chú nhanh
│   ├── perf.js                     # Đo độ trễ TTFB và điểm Google PageSpeed
│   ├── ps.js                       # Top tiến trình ngốn RAM & CPU
│   ├── restart.js                  # Khởi động lại bot qua PM2
│   ├── sh.js                       # Thực thi shell an toàn theo whitelist
│   ├── start.js                    # Menu hướng dẫn sử dụng bot
│   ├── status.js                   # Báo cáo phần cứng toàn cụm thời gian thực
│   ├── update.js                   # Tự động cập nhật bot từ GitHub và restart PM2
│   ├── uptime.js                   # Xem thời gian hoạt động liên tục của VPS
│   ├── web_list.js                 # Liệt kê web đang chạy kèm nút tương tác
│   └── web_remove.js               # Gỡ bỏ web, giải phóng tài nguyên và DNS
├── config/                         # Cấu hình & tiện ích lõi
│   ├── env.js                      # Nạp và kiểm định biến môi trường nghiêm ngặt
│   ├── middleware.js               # Middleware kiểm soát quyền truy cập Telegram ID
│   ├── utils.js                    # Tiện ích định dạng, escape HTML và OOM-safe tailing
│   └── whitelist.js                # Danh mục 15 lệnh shell an toàn
├── dashboard/                      # Giao diện Web Dashboard (Vue 3 Single Page Application)
│   ├── app.js                      # Mã nguồn logic Vue 3 (Decoupled modular script)
│   └── index.html                  # Giao diện HTML5, Tailwind CSS, Chart.js, CSP
├── data/                           # Dữ liệu lưu trữ trạng thái
│   ├── deployments.json            # Sổ đăng ký các dự án web đã deploy
│   └── nodes.json                  # Cấu hình danh mục máy chủ trong cụm Multi-VPS
├── handlers/                       # Bộ xử lý tương tác người dùng
│   └── textHandler.js              # Nhận diện link GitHub tự động và tiếp nhận ghi chú
├── lib/                            # Thư viện dịch vụ lõi
│   ├── deployer.js                 # Điều phối triển khai (Orchestrator: VPS, Vercel, Render)
│   ├── deployStore.js              # Quản lý trạng thái chờ xác nhận deploy tạm thời
│   ├── nodeClient.js               # REST Client kết nối Master -> Worker Agent
│   ├── nodeManager.js              # Quản lý danh bạ node, topology và che giấu IP
│   ├── perf.js                     # Đo đạc HTTP TTFB và tích hợp PageSpeed Insights API
│   ├── repoInspector.js            # Phân tích cấu trúc repository GitHub
│   ├── runner.js                   # Thực thi command an toàn
│   ├── sandbox.js                  # Quản lý vòng đời web VPS, giải nén ZIP, cấu hình Nginx
│   ├── whitelist.js                # Kiểm tra alias lệnh shell
│   └── providers/                  # Adapter tích hợp các nhà cung cấp bên ngoài
│       ├── cloudflare.js           # Tự động hóa bản ghi DNS Cloudflare (Type A & CNAME)
│       ├── render.js               # Adapter triển khai dịch vụ lên Render Cloud
│       └── vercel.js               # Adapter triển khai ứng dụng lên Vercel Cloud
├── services/                       # Các dịch vụ nền & API
│   ├── dashboard/                  # Các Controller chuyên biệt cho Dashboard API
│   │   ├── authController.js       # Xác thực Google GIS, tạo & kiểm tra JWT session token
│   │   ├── deploymentsController.js# Deployments CRUD, Git deploy, undeploy, cleancache
│   │   ├── notesController.js      # Sổ ghi chú cá nhân (/notes)
│   │   ├── perfController.js       # Kiểm thử hiệu năng (/perf)
│   │   ├── telemetryController.js  # Số liệu hệ thống thời gian thực, cluster status, logs, procs
│   │   └── terminalController.js   # Safe Terminal Whitelist (/sh) & Proxy lệnh Worker
│   ├── dashboardApi.js             # HTTP Router tinh gọn, CORS & Server Lifecycle Manager
│   └── watchdog.js                 # Service giám sát RAM/Disk định kỳ 5 phút
├── test/                           # 25 test suites kiểm thử tự động
├── docs/                           # Tài liệu hướng dẫn, ADRs và báo cáo kiểm toán
│   ├── adr/                        # Kiến trúc và quyết định kỹ thuật (ADRs)
│   ├── reports/                    # Báo cáo kiểm thử & kiểm toán thực tế
│   └── superpowers/                # Kế hoạch và thông số kỹ thuật SDD
├── .env.example                    # File cấu hình mẫu đã được vệ sinh thông tin nhạy cảm
├── AGENTS.md                       # Hướng dẫn và quy chuẩn vận hành cho AI Agents
├── CONTEXT.md                      # Từ vựng nghiệp vụ chuẩn (Domain Glossary)
├── HANDOFF.md                      # Tài liệu bàn giao kỹ thuật toàn diện cho lập trình viên & Agents
├── package.json
└── README.md
```

---

## 🧪 Kiểm thử & Đảm bảo chất lượng (Verification Gate)

Mọi thay đổi trong mã nguồn đều phải vượt qua 100% các bước kiểm tra tự động trước khi triển khai:

```bash
# 1. Kiểm tra cú pháp toàn bộ 43 file mã nguồn (Zero-Error)
npm run check:syntax

# 2. Chạy toàn bộ 25 test suites tự động (Unit, Integration, Regression)
npm test
```

---

## 🌐 Case Study & Kỹ thuật chuyên sâu

Dự án này là một phần trong danh mục giải pháp DevOps & Bot Automation của [ThienHN](https://thienhn.io.vn/):
- 📌 **Chi tiết Case Study dự án**: [Assistant Bot Telegram Overview](https://thienhn.io.vn/projects/assisstantbot-telegram-overview)
- 📖 **Bài viết chuyên sâu về kiến trúc**: [Zero-Overhead VPS Orchestration: Telegram Bot + PM2 + Nginx](https://thienhn.io.vn/blog/zero-overhead-vps-orchestration-telegram-bot-pm2-nginx)
- ⚖️ **So sánh kiến trúc Bot**: [Bot Engineering Showdown: Facebook Webhooks vs Telegram API](https://thienhn.io.vn/blog/bot-engineering-showdown-facebook-webhooks-vs-telegram-api)
- 🚀 **Khám phá thêm các dự án khác**: [Portfolio Projects Showcase](https://thienhn.io.vn/projects)
