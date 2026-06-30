# Hướng Dẫn Sử Dụng Chi Tiết Dev Assistant Bot

Tài liệu này cung cấp hướng dẫn chi tiết về các câu lệnh và chức năng của **Dev Assistant Bot**, một trợ lý Telegram cá nhân hỗ trợ nhà phát triển quản lý, giám sát máy chủ và triển khai (deploy) ứng dụng một cách an toàn.

---

## Mục Lục
1. [Cơ Chế Bảo Mật & Phân Quyền](#1-cơ-chế-bảo-mật--phân-quyền)
2. [Các Câu Lệnh Trực Tiếp (Direct Commands)](#2-các-câu-lệnh-trực-tiếp-direct-commands)
3. [Lệnh `/sh` và Danh Sách Whitelist Aliases](#3-lệnh-sh-và-danh-sách-whitelist-aliases)
   - [Cách Sử Dụng Lệnh `/sh`](#cách-sử-dụng-lệnh-sh)
   - [Danh Sách Các Bí Danh (Aliases) Được Hỗ Trợ](#danh-sách-các-bí-danh-aliases-được-hỗ-trợ)
4. [Tính Năng Ghi Chú Nhanh (Note-taking)](#4-tính-năng-ghi-chú-nhanh-note-taking)
5. [Cấu Hình Môi Trường Liên Quan (`.env`)](#5-cấu-hình-môi-trường-liên-quan-env)

---

## 1. Cơ Chế Bảo Mật & Phân Quyền

Do bot có khả năng thực thi các câu lệnh hệ thống và truy cập dữ liệu máy chủ nhạy cảm, các lớp bảo mật sau được thiết lập nghiêm ngặt:
*   **Xác thực qua Telegram ID (Middleware)**: Chỉ có duy nhất tài khoản Telegram sở hữu ID trùng khớp với biến môi trường `AUTHORIZED_TELEGRAM_ID` mới có thể tương tác với bot. Mọi tin nhắn từ tài khoản lạ sẽ bị từ chối ngay lập tức kèm cảnh báo bảo mật.
*   **Whitelist Lệnh Shell**: Bot **không** cho phép người dùng nhập các lệnh shell tự do (ví dụ: `rm -rf /` hay `reboot`). Thay vào đó, nó sử dụng cơ chế whitelist aliases. Bạn chỉ có thể gọi các bí danh đã được định nghĩa sẵn trong `config/whitelist.js`.
*   **Cơ chế chống Shell Injection**: Lệnh được thực thi bằng phương thức `spawn` từ thư viện `child_process` của Node.js với tùy chọn `shell: false`. Điều này ngăn chặn việc chèn các ký tự độc hại hoặc thay đổi luồng câu lệnh hệ thống.

---

## 2. Các Câu Lệnh Trực Tiếp (Direct Commands)

Đây là các câu lệnh chính của bot được đăng ký trực tiếp và có thể gọi nhanh thông qua Menu hoặc gõ `/`.

### `/start`
*   **Chức năng**: Khởi động bot, hiển thị menu chào mừng và danh sách tất cả các lệnh khả dụng.
*   **Cách dùng**: `/start`
*   **Phản hồi**: Bot sẽ gửi một tin nhắn hướng dẫn kèm theo bàn phím nút bấm nhanh (Keyboard) dưới khung chat để bạn thao tác nhanh mà không cần gõ lệnh.

### `/status`
*   **Chức năng**: Báo cáo nhanh trạng thái tài nguyên phần cứng hiện tại của máy chủ.
*   **Cách dùng**: `/status`
*   **Phản hồi**: Trả về thông tin chi tiết:
    *   **CPU**: Phần trăm tải hiện tại của CPU (kèm cảnh báo ⚠️ nếu $\ge 80\%$).
    *   **RAM**: Dung lượng RAM đã sử dụng / Tổng dung lượng RAM và tỷ lệ phần trăm (kèm cảnh báo ⚠️ nếu $\ge 80\%$).
    *   **SWAP**: Dung lượng Swap đã sử dụng / Tổng dung lượng Swap.
    *   **Disk (/)**: Dung lượng lưu trữ còn trống trên phân vùng gốc `/`.

### `/ip`
*   **Chức năng**: Lấy địa chỉ IP Public hiện tại của máy chủ (tiện ích khi máy chủ sử dụng IP động hoặc cần kiểm tra kết nối mạng).
*   **Cách dùng**: `/ip`
*   **Phản hồi**: Địa chỉ IP Public IPv4 dạng text Monospace.

### `/uptime`
*   **Chức năng**: Xem thời gian máy chủ đã hoạt động liên tục (uptime) kể từ lần khởi động cuối cùng.
*   **Cách dùng**: `/uptime`
*   **Phản hồi**:
    *   Thời gian máy chủ hoạt động (số ngày, giờ, phút, giây).
    *   Thời điểm khởi động máy chủ (boot time) định dạng `vi-VN`.

### `/logs`
*   **Chức năng**: Xem nhanh 20 dòng log lỗi cuối cùng của PM2.
*   **Cách dùng**: `/logs`
*   **Phản hồi**: Hiển thị nội dung cuối cùng của file log lỗi chỉ định tại biến `PM2_ERROR_LOG_PATH`. Nếu không có lỗi, bot báo "Không có log lỗi.".

### `/cleancache`
*   **Chức năng**: Thực hiện dọn dẹp bộ nhớ đệm (RAM cache) và xóa log PM2 để giải phóng dung lượng đĩa.
*   **Cách dùng**: `/cleancache`
*   **Chi tiết hoạt động**:
    1.  **Xả RAM đệm**: Chạy lệnh `sudo sync && echo 3 | sudo tee /proc/sys/vm/drop_caches` (chỉ hỗ trợ trên môi trường Linux; trên Windows bước này sẽ được tự động bỏ qua).
    2.  **Xóa log PM2**: Chạy lệnh `pm2 flush` để dọn dẹp các file log hiện tại của PM2.
    3.  **Báo cáo**: Hiển thị trạng thái thành công/thất bại của từng bước và in dung lượng RAM hiện tại của hệ thống sau khi dọn dẹp.

### `/npmcache`
*   **Chức năng**: Dọn dẹp cache của trình quản lý gói `npm`.
*   **Cách dùng**: `/npmcache`
*   **Chi tiết hoạt động**: Thực thi lệnh `npm cache clean --force` để giải phóng không gian ổ đĩa bị chiếm dụng bởi cache npm cũ.

### `/deploy`
*   **Chức năng**: Kích hoạt quy trình deploy (triển khai) tự động và nhanh chóng bằng một chạm cho bot hoặc dự án hiện tại.
*   **Cách dùng**: `/deploy`
*   **Chi tiết hoạt động**: Thực thi chuỗi lệnh sau theo trình tự:
    1.  `git pull origin main` (cập nhật mã nguồn mới nhất).
    2.  `npm install` (cài đặt các thư viện mới nếu có).
    3.  `npm run build` (biên dịch dự án).
    4.  `pm2 restart all` (khởi động lại toàn bộ các ứng dụng trong PM2 để áp dụng thay đổi).
*   **Lưu ý**: Kết quả chi tiết của từng bước sẽ được trả về dưới dạng HTML. Nếu kết quả quá dài (vượt quá 3500 ký tự - giới hạn của Telegram), bot sẽ tự động tạo file đính kèm `deploy-output.txt` gửi cho bạn.

### `/stop`
*   **Chức năng**: Dừng tiến trình PM2 của bot từ xa.
*   **Cách dùng**: `/stop`
*   **Chi tiết hoạt động**: Thực thi lệnh `pm2 stop <tên_tiến_trình>`. Tên tiến trình mặc định là `dev-assistant-bot` hoặc được cấu hình thông qua biến môi trường `PM2_PROCESS_NAME`.

---

## 3. Lệnh `/sh` và Danh Sách Whitelist Aliases

### Cách Sử Dụng Lệnh `/sh`

Lệnh `/sh` cho phép chạy các câu lệnh hoặc chuỗi câu lệnh hệ thống an toàn thông qua các **bí danh (aliases)** đã được cấu hình trước trong `config/whitelist.js`.

*   **Cú pháp tổng quát**:
    `/sh /<alias> [tham_số_1] [tham_số_2] ...`
*   **Xem danh sách aliases khả dụng**:
    Chỉ cần gõ `/sh` (không truyền tham số). Bot sẽ gửi lại danh sách toàn bộ các alias hợp lệ mà bạn có thể dùng.
*   **Xử lý kết quả dài**: Tương tự như `/deploy`, nếu output của lệnh shell vượt quá 3500 ký tự, bot sẽ trả về file đính kèm dưới dạng `<alias>-output.txt` thay vì hiển thị trực tiếp trên khung chat.

---

### Danh Sách Các Bí Danh (Aliases) Được Hỗ Trợ

Dưới đây là mô tả chi tiết của từng alias trong whitelist:

| Tên Alias | Mô tả chức năng | Lệnh thực tế thực thi | Tham số / Ví dụ |
| :--- | :--- | :--- | :--- |
| **`git-status`** | Kiểm tra trạng thái Git hiện tại. | `git status` | `/sh /git-status` |
| **`git-pull`** | Kéo code mới nhất từ nhánh chính. | `git pull origin main` | `/sh /git-pull` |
| **`npm-install`**| Cài đặt các thư viện phụ thuộc. | `npm install` | `/sh /npm-install` |
| **`npm-build`**  | Build dự án sang chế độ sản xuất. | `npm run build` | `/sh /npm-build` |
| **`deploy`**     | Triển khai tự động chuỗi lệnh deploy. | Chạy tuần tự: `git pull origin main` $\to$ `npm install` $\to$ `npm run build` $\to$ `pm2 restart all`. | `/sh /deploy` *(Tương đương với lệnh direct `/deploy`)* |
| **`nginx-test`** | Kiểm tra cú pháp file cấu hình Nginx. | `sudo nginx -t` (yêu cầu quyền sudo) | `/sh /nginx-test` |
| **`nginx-reload`**| Tải lại cấu hình Nginx không downtime. | `sudo systemctl reload nginx` (yêu cầu quyền sudo) | `/sh /nginx-reload` |
| **`nginx-status`**| Xem trạng thái hoạt động của Nginx. | `sudo systemctl status nginx` (yêu cầu quyền sudo) | `/sh /nginx-status` |
| **`pm2-list`**   | Liệt kê các ứng dụng PM2 đang chạy. | `pm2 list` | `/sh /pm2-list` |
| **`pm2-restart`**| Khởi động lại một ứng dụng PM2 cụ thể.| `pm2 restart <app>` | `/sh /pm2-restart assistant-bot`<br>*Lưu ý: `<app>` phải nằm trong danh sách được phép: `assistant-bot`, `app`, `server`, `worker`* |
| **`mkdir-project`**| Tạo thư mục cho dự án mới trên server. | `mkdir -p /home/hnt/web/<project>` | `/sh /mkdir-project my-new-website`<br>*Tạo thư mục `/home/hnt/web/my-new-website`* |
| **`mv-zip`**     | Di chuyển file nén ZIP dự án. | `mv /home/hnt/<zip> /home/hnt/web/<project>` | `/sh /mv-zip dist.zip my-new-website`<br>*Di chuyển file `dist.zip` từ `/home/hnt` vào `/home/hnt/web/my-new-website`* |
| **`extract-deploy`**| Giải nén và dọn dẹp deploy thủ công. | `cd /home/hnt/web/<project> && rm -rf dist && unzip -o <zip> && rm -f <zip>` (Chạy qua bash shell) | `/sh /extract-deploy my-new-website dist.zip` |
| **`chmod-nginx`**| Phân quyền thư mục web cho Nginx. | 1. `sudo chmod +x /home/hnt`<br>2. `sudo chmod +x /home/hnt/web`<br>3. `sudo chmod -R 755 /home/hnt/web/<project>` | `/sh /chmod-nginx my-new-website` |
| **`nginx-link`** | Tạo liên kết cấu hình Nginx ảo. | `sudo ln -s /etc/nginx/sites-available/<site> /etc/nginx/sites-enabled/` | `/sh /nginx-link my-new-website.conf` |
| **`nginx-create`**| Tạo file cấu hình Virtual Host Nginx cho SPA (React, Vue, v.v.). | Tạo file cấu hình Nginx mẫu tại `/etc/nginx/sites-available/<site>` với cấu hình lắng nghe cổng 80, trỏ tên miền tới `<server>` và thư mục tĩnh là `<root>`. | `/sh /nginx-create my-site.conf mydomain.com /home/hnt/web/my-project/dist`<br>*Tham số thứ tự: `[tên_file_cấu_hình] [tên_miền] [đường_dẫn_root]`* |
| **`ls`**         | Liệt kê nội dung trong thư mục chỉ định. | `bash -lc 'ls -la "<path>"'` | `/sh /ls /home/hnt/web` |
| **`cd`**         | Chuyển thư mục hiện tại của phiên con. | `bash -lc 'cd "<path>" && pwd && ls -la'` | `/sh /cd /home/hnt/web/assistant-bot` |
| **`cat`**        | Đọc nội dung của một file văn bản. | `bash -lc 'head -c 65536 "<file>"'` (Chỉ lấy tối đa 64KB đầu tiên để tránh tràn tin nhắn) | `/sh /cat /home/hnt/web/assistant-bot/.env` |

---

## 4. Tính Năng Ghi Chú Nhanh (Note-taking)

Bên cạnh việc thực thi các câu lệnh hệ thống, bot còn hỗ trợ lưu trữ ghi chú cá nhân một cách nhanh chóng.

*   **Cách sử dụng**: Gửi bất kỳ đoạn tin nhắn văn bản thông thường nào **không bắt đầu bằng dấu gạch chéo `/`**.
*   **Chi tiết hoạt động**:
    1.  Bot nhận diện tin nhắn là văn bản thông thường.
    2.  Tự động lấy thời gian hiện tại dựa trên múi giờ cấu hình (ví dụ: `Asia/Ho_Chi_Minh`) ở định dạng `vi-VN` (24 giờ, không dùng AM/PM).
    3.  Ghi đè hoặc nối thêm dòng vào file ghi chú chỉ định bởi biến `NOTES_FILE_PATH` dưới dạng:
        `[DD/MM/YYYY, HH:MM:SS] <Nội dung ghi chú của bạn>`
    4.  Phản hồi lại tin nhắn: "✅ Đã lưu ghi chú thành công!".

---

## 5. Cấu Hình Môi Trường Liên Quan (`.env`)

Để các lệnh hoạt động chính xác, bạn cần cấu hình đầy đủ các biến môi trường trong file `.env` tại thư mục gốc:

```env
# Token của Bot Telegram được cấp bởi @BotFather
BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ

# ID Telegram duy nhất của bạn để xác thực quyền truy cập
AUTHORIZED_TELEGRAM_ID=987654321

# Múi giờ sử dụng cho việc định dạng log và ghi chú
TIMEZONE=Asia/Ho_Chi_Minh

# Đường dẫn đến file lưu ghi chú nhanh
NOTES_FILE_PATH=./notes.txt

# Đường dẫn tuyệt đối hoặc tương đối tới file log lỗi của PM2 (dùng cho lệnh /logs)
PM2_ERROR_LOG_PATH=C:\Users\Username\.pm2\logs\dev-assistant-bot-error.log

# Tên của tiến trình PM2 quản lý bot (dùng cho lệnh /stop)
PM2_PROCESS_NAME=dev-assistant-bot
```
