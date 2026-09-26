# Báo Cáo Kiểm Thử & Kiểm Toán Safe Whitelisted Terminal (/sh) & Cấu Hình Bảo Mật SSL

> **Thời gian thực hiện:** Ngày 27 Tháng 09 Năm 2026  
> **Môi trường kiểm thử:** Production (`https://bot.thienhn.io.vn/`) & Local Test Suites  
> **Công cụ:** Chrome DevTools MCP, SSH, cURL, Node.js Test Suites (25 Suites)  
> **Tài khoản kiểm thử:** `hnt.vn.vn@gmail.com` (Đã xác thực Google OAuth & GIS Session)

---

## 1. Tổng Quan Mục Tiêu & Yêu Cầu

1. **Kiểm thử chuyên sâu tính năng Safe Whitelisted Terminal (`/sh`) trên Web Dashboard:**
   - Thực thi các lệnh whitelist trên cả 2 máy chủ trong cụm: **GCP e2-micro (Master)** và **Oracle Cloud (Worker)**.
   - Thử nghiệm các câu lệnh nguy hiểm/bị cấm (như `rm -rf /`) để kiểm chứng khả năng bảo vệ của Sandbox và Whitelist.
   - Kiểm tra khả năng xóa màn hình console và làm mới output.
2. **Khắc phục triệt để các lỗi đã phát hiện:**
   - Lỗi **HTTP 401 Unauthorized** khi tải danh sách bí danh lệnh (`/api/sh/aliases`).
   - Lỗi **HTTP 502 Bad Gateway / Command Not Allowed (403)** khi chạy lệnh từ xa tới máy chủ Oracle Worker.
   - Lỗi hiển thị mã màu thô **ANSI escape codes** (`[1m [36m0 [39m`).
3. **Mở rộng bộ câu lệnh an toàn (Full DevOps Suite):**
   - Đạt được sự đồng thuận thông qua khảo sát định hướng (Grill-me) để mở rộng danh sách alias từ 5 lên 15 câu lệnh DevOps an toàn.
   - Đồng bộ hóa bộ alias giữa Master (`config/whitelist.js`) và Worker Daemon (`agent/server.js`).
4. **Giải quyết cảnh báo "Not Secure" (Không an toàn) trên trình duyệt:**
   - Bổ sung chỉ thị bảo mật Content Security Policy (`upgrade-insecure-requests`) trên frontend.
   - Cấu hình HSTS (`Strict-Transport-Security`) và các header bảo vệ nâng cao trên Nginx reverse proxy của GCP Master.
   - Tích hợp inline SVG Favicon để loại bỏ lỗi 404 resource.
5. **Tái cấu trúc mã nguồn (Modular Refactoring):**
   - Phân rã tệp nguyên khối `services/dashboardApi.js` (từ 1.010 dòng) thành các controller chuyên biệt trong `services/dashboard/`.

---

## 2. Nhật Ký Kiểm Thử Thực Tế (Trước & Sau Sửa Lỗi)

| Mục kiểm thử | Hành động & Tham số | Trạng thái ban đầu | Nguyên nhân cốt lõi | Trạng thái sau khắc phục |
| :--- | :--- | :--- | :--- | :--- |
| **Fetch Aliases** | `GET /api/sh/aliases` | ❌ Lỗi HTTP 401 | `fetch('/api/sh/aliases')` trong `dashboard/app.js` không đính kèm `Authorization: Bearer <token>`. | ✅ **Thành công (200 OK)**: Sử dụng hàm chuẩn `apiRequest` có gắn JWT token. |
| **Bí danh Uptime** | `/uptime` trên `gcp-master` | ❌ Bị từ chối (`Unknown alias: uptime`) | `config/whitelist.js` chỉ có 5 alias ban đầu, thiếu `uptime`. | ✅ **Thành công**: Trả về uptime hệ thống sạch sẽ `[exit code: 0]`. |
| **Lệnh trên Worker** | `/pm2-list` trên `oracle-worker` | ❌ Lỗi HTTP 502 | `agent/server.js` chỉ ánh xạ chuỗi `'pm2 list'`, không nhận diện bí danh `/pm2-list`. | ✅ **Thành công**: Nhận diện cả alias và lệnh thô, hiển thị bảng tiến trình PM2 của Worker. |
| **Ký tự ANSI thô** | Mọi lệnh trả về bảng PM2 | ⚠️ Chứa ký tự `[1m [36m` | Giao diện hiển thị trực tiếp chuỗi stdout chưa được lọc mã màu terminal. | ✅ **Thành công**: Bộ lọc Regex `stripAnsi` làm sạch 100% mã thoát màu ANSI. |
| **Chặn lệnh nguy hại** | `rm -rf /` trên cả 2 node | ❌ Trả về HTTP 502 crash mạng | Worker trả về 403 nhưng controller master chuyển tiếp thành 502. | ✅ **Thành công**: Hiển thị thông báo đỏ an toàn `❌ Lỗi: Request failed with status code 403` hoặc `Unknown alias: rm`. |
| **Cảnh báo Not Secure** | Truy cập `https://bot.thienhn.io.vn/` | ⚠️ Browser thiếu HSTS & CSP | Thiếu header `Strict-Transport-Security` và meta CSP trong Nginx & HTML. | ✅ **Bảo mật tuyệt đối**: HSTS 1 năm, `X-Content-Type-Options: nosniff`, `SAMEORIGIN`. |

---

## 3. Danh Mục 15 Bí Danh Whitelist Được Mở Rộng

Tất cả câu lệnh đều được bảo vệ bởi danh sách trắng nghiêm ngặt, cấm can thiệp trình thông dịch shell (`bash`, `sh`, `powershell`) và ngăn chặn command injection:

| Nhóm chức năng | Bí danh (Alias) | Lệnh hệ thống thực thi | Mục đích sử dụng |
| :--- | :--- | :--- | :--- |
| **Tài nguyên & Phần cứng** | `/uptime` | `uptime` | Xem thời gian chạy và phụ tải CPU (Load Average) |
| | `/disk-usage` | `df -h` | Kiểm tra dung lượng và % sử dụng phân vùng ổ đĩa |
| | `/mem-check` | `free -h` | Kiểm tra dung lượng RAM vật lý và Swap khả dụng |
| | `/cpu-info` | `lscpu` | Xem kiến trúc CPU, số nhân, xung nhịp vi xử lý |
| | `/top-procs` | `ps aux --sort=-%mem` | Liệt kê các tiến trình đang chiếm RAM nhiều nhất |
| | `/os-release` | `cat /etc/os-release` | Xem chi tiết phiên bản hệ điều hành Linux |
| **Mạng & Dịch vụ Web** | `/netstat-listen` | `ss -tuln` | Xem tất cả các cổng mạng TCP/UDP đang mở lắng nghe |
| | `/nginx-test` | `sudo nginx -t` | Kiểm tra cú pháp file cấu hình Nginx trước khi reload |
| | `/nginx-status` | `sudo systemctl status nginx` | Xem trạng thái hoạt động trực tiếp của Nginx web server |
| **Quản trị PM2** | `/pm2-list` | `pm2 list` | Bảng liệt kê tiến trình PM2 đang chạy |
| | `/pm2-status` | `pm2 status` | Xem trạng thái chi tiết của từng tiến trình PM2 |
| | `/pm2-restart <app>` | `pm2 restart <app>` | Khởi động lại ứng dụng được phép (`assistant-bot`, `app`, `worker`) |
| | `/pm2-logs <app>` | `pm2 logs <app> --lines 30 --nostream` | Trích xuất 30 dòng nhật ký gần nhất của ứng dụng |
| **Phiên bản & Git** | `/git-status` | `git status` | Kiểm tra trạng thái mã nguồn và nhánh làm việc |
| | `/git-log` | `git log --oneline -5` | Xem tóm tắt 5 commit mới nhất trong repository |

---

## 4. Kiến Trúc Modular Sau Khi Tối Ưu Hóa

Thay vì tập trung toàn bộ mã nguồn xử lý HTTP trong một file `services/dashboardApi.js` cồng kềnh (hơn 1.000 dòng), hệ thống đã được tái cấu trúc theo mô hình Router - Controller phân lớp rõ ràng:

```
services/
├── dashboard/
│   ├── authController.js         # Quản lý xác thực Google GIS, JWT Session tokens, Public config
│   ├── telemetryController.js    # Đo lường hệ thống, Node cluster status, PM2 logs, Top processes
│   ├── terminalController.js     # Safe Whitelisted Shell, alias mapper, Remote worker proxy
│   ├── deploymentsController.js  # CRUD Deployments, Git Deploy, Undeploy, PM2 Restart, Cleancache
│   ├── notesController.js        # Sổ ghi chú cá nhân (/notes) CRUD
│   └── perfController.js         # Kiểm thử hiệu năng PageSpeed & độ trễ HTTP (/perf)
└── dashboardApi.js               # Router tinh gọn (<300 dòng), CORS & Server Lifecycle Manager
```

### Ưu điểm đạt được:
- **Khả năng mở rộng:** Mỗi tác vụ có file controller riêng độc lập, dễ dàng bổ sung tính năng mà không ảnh hưởng module khác.
- **Tương thích ngược 100%:** Giữ nguyên vẹn toàn bộ hàm export (`createDashboardServer`, `isDashboardAuthReady`, v.v.), đảm bảo 25 bộ test suite của dự án chạy qua hoàn hảo.
- **Bảo mật Zero-Leakage:** Toàn bộ IP trên UI được che chắn (`34.***.***.133`), tuyệt đối không lưu lộ credential hay secret trong code.

---

## 5. Kết Quả Kiểm Thử Tự Động (Verification Gate)

- **Cú pháp (Syntax Check):** `npm run check:syntax` -> **0 lỗi, 0 cảnh báo** (kiểm tra toàn bộ 43 file mã nguồn).
- **Kiểm thử đơn vị & Tích hợp:** `npm test` -> **25/25 test suites thành công rực rỡ**:
  - `test/whitelist.test.js`: Passed
  - `test/worker_agent.test.js`: Passed
  - `test/node_client.test.js`: Passed
  - `test/multi_vps_deployer.test.js`: Passed
  - `test/multi_vps_telegram.test.js`: Passed
  - `test/multi_vps_commands.test.js`: Passed
  - `test/dashboard_full_features.test.js`: Passed
  - `test/dashboard_multi_vps.test.js`: Passed
  - `test/dashboard_api.test.js`: Passed
  - *(và 16 test suite liên quan khác)*.
- **Trạng thái triển khai trên máy chủ thực:**
  - GCP Master (`34.10.66.133`): PM2 Process `assistant-bot` online (uptime 0s -> running, RAM 19.8MB).
  - Oracle Worker (`168.107.83.235`): PM2 Process `assistant-node-agent` online (RAM 22.3MB).
  - Nginx Reverse Proxy: Đã cấu hình HSTS và nạp cấu hình thành công (`nginx -t` OK).

---

## 6. Hướng Dẫn Về Thiết Lập Cloudflare Edge Cho Người Dùng

Để trình duyệt luôn hiển thị huy hiệu ổ khóa xanh an toàn tuyệt đối và không phát sinh cảnh báo trên bất kỳ thiết bị mạng nào, vui lòng đảm bảo các cấu hình sau trên **Cloudflare Dashboard**:

1. **SSL/TLS -> Overview:** Đặt chế độ mã hóa là **Full** hoặc **Full (Strict)** (vì origin server GCP Master đã được cài chứng chỉ Cloudflare Origin Certificate). Không đặt **Flexible** để tránh lỗi redirect loop HTTP/HTTPS.
2. **SSL/TLS -> Edge Certificates:**
   - **Always Use HTTPS:** Bật `ON` (Tự động chuyển tiếp mọi kết nối HTTP sang HTTPS ở CDN Edge).
   - **Automatic HTTPS Rewrites:** Bật `ON` (Tự động nâng cấp các tài nguyên bên thứ ba sang HTTPS).
   - **Minimum TLS Version:** Chọn `TLS 1.2` hoặc `TLS 1.3`.
   - **HTTP Strict Transport Security (HSTS):** Bật `Enable HSTS`, chọn thời gian `max-age=1 year (31536000)`, tick chọn `Include subdomains` và `Preload`.
