# Shell and Maintenance Specification

Tài liệu này mô tả các command shell và maintenance an toàn đã được triển khai, cùng phần còn cố ý giữ ở trạng thái hạn chế để tránh biến bot thành shell tùy ý.

## Phạm vi

- Bot vẫn dùng `parse_mode: 'HTML'`
- Bot vẫn giữ cấu trúc command dạng object `{ name, description, execute }`
- Mỗi command mới phải tự xử lý lỗi bằng `try/catch`
- Mọi phản hồi shell phải đi qua escape HTML trước khi gửi

## Command đề xuất

### `/ls`

- Mục đích: liệt kê file và thư mục trong `process.cwd()`
- Nguồn dữ liệu: `fs/promises`
- Output mong muốn:
  - Thư mục: `📁`
  - File: `📄`
  - File phải kèm dung lượng
  - Danh sách được bọc trong `<code>`
- Trạng thái: `implemented`

### `/cd`

- Mục đích: đổi thư mục làm việc hiện tại của bot
- Cách hoạt động:
  - Nếu không truyền tham số, trả về thư mục hiện tại
  - Nếu có tham số, chuyển sang thư mục hợp lệ đó cho các lệnh sau
- Trạng thái: `implemented`

### `/cat`

- Mục đích: đọc file text an toàn
- Cách hoạt động:
  - Dùng đường dẫn tương đối hoặc tuyệt đối
  - Giới hạn kích thước file để không vượt giới hạn Telegram
  - Escape HTML trước khi trả về
- Trạng thái: `implemented`

### `/cleancache`

- Mục đích: thực hiện các bước bảo trì an toàn đã định nghĩa sẵn
- Tác vụ dự kiến:
  - Xả RAM đệm
  - `pm2 flush`
- Yêu cầu an toàn:
  - Không nhận lệnh shell tùy ý từ user
  - Báo cáo riêng từng bước thành công/thất bại
  - Nếu xả cache xong, hiển thị lại trạng thái RAM hiện tại hoặc gọi logic `/status`
- Trạng thái: `implemented`

### `/npmcache`

- Mục đích: dọn cache npm
- Cách hoạt động:
  - Chạy `npm cache clean --force`
  - Trả output và exit code để dễ kiểm tra
- Trạng thái: `implemented`

### `/stop`

- Mục đích: stop process PM2 của bot
- Cách hoạt động:
  - Dùng `PM2_PROCESS_NAME` nếu có
  - Mặc định là `dev-assistant-bot`
- Trạng thái: `implemented`

### `/sh [lệnh]`

- Mục đích: chạy lệnh shell có kiểm soát
- Cơ chế bắt buộc:
  - Chỉ cho phép các lệnh nằm trong whitelist
  - Từ chối ngay nếu lệnh không khớp whitelist
  - Output được trả trong `<pre>` để giữ format terminal
- Whitelist ban đầu nên chỉ gồm các lệnh quan sát, ví dụ:
  - `df -h`
  - `free -m`
  - `git status`
  - `pm2 list`
  - `uname -a`
- Để deploy từ xa qua chat, có thể cho phép thêm các lệnh theo chuỗi đã định nghĩa sẵn, ví dụ:
  - `git pull origin main`
  - `npm ci`
  - `npm run check:syntax`
  - `pm2 reload dev-assistant-bot --update-env`
  - `git pull origin main && npm ci && npm run check:syntax && pm2 reload dev-assistant-bot --update-env`
- Trạng thái: `implemented`

## Ràng buộc bảo mật

1. Không mở shell tùy ý ngoài whitelist.
2. Không cho phép lệnh phá hủy hoặc sửa hệ thống ngoài phạm vi được duyệt.
3. Không để shell output làm vỡ HTML của Telegram.
4. Không để lệnh shell làm crash tiến trình bot.
5. Nếu sau này thêm `cd`, nên coi đó là trạng thái phiên riêng, không đổi thư mục toàn cục của bot.

## Gợi ý triển khai sau này

- `commands/ls.js`: command đọc thư mục và render HTML.
- `commands/cd.js`: command đổi thư mục làm việc trong phiên bot.
- `commands/cat.js`: command đọc file text có kiểm soát.
- `commands/cleancache.js`: command chạy các bước maintenance đã định nghĩa sẵn.
- `commands/npmcache.js`: command dọn cache npm.
- `commands/stop.js`: command điều khiển process PM2.
- `commands/sh.js`: command thực thi whitelist shell.
- `bot.js`: chỉ còn vai trò đăng ký các command hiện có theo mô hình object hiện tại.

## Kết luận

Đây là bộ tính năng phù hợp nếu bot được nâng cấp cho dev có server, nhưng chỉ nên triển khai khi có whitelist, audit log, và output escaping đầy đủ.