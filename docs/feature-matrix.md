# Feature Matrix

Tài liệu này phân loại tính năng của bot theo trạng thái để làm rõ phần đã triển khai, phần còn thiếu, và phần nên có nếu bot được dùng như một trợ lý cho dev có server.

## Quy ước trạng thái

- `implemented`: Đã có trong code hiện tại
- `missing`: Chưa có trong code hiện tại
- `planned`: Có thể bổ sung ở giai đoạn sau, nhưng chưa có thiết kế triển khai chi tiết

## Tóm tắt hiện trạng

| Nhóm | Tính năng | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| Authentication | Chỉ cho phép 1 Telegram ID được cấu hình | implemented | Middleware chặn user khác trước khi vào command |
| Command | `/start` hiển thị menu | implemented | Liệt kê các lệnh chính |
| Command | `/status` xem CPU, RAM, SWAP, disk | implemented | Dùng `systeminformation` |
| Command | `/ip` lấy IP public | implemented | Gọi dịch vụ ipify |
| Command | `/logs` đọc 20 dòng log PM2 gần nhất | implemented | Cần cấu hình `PM2_ERROR_LOG_PATH` |
| Command | `/uptime` xem uptime server | implemented | Có thêm thời điểm boot nếu lấy được |
| Notes | Lưu text thường vào file notes | implemented | Text không bắt đầu bằng `/` sẽ được append |
| Runtime | Graceful shutdown | implemented | Xử lý `SIGINT` và `SIGTERM` |
| Runtime | Bắt lỗi runtime không làm bot chết ngay | implemented | Có `bot.catch()` và try/catch ở command |
| Build | `npm run build` | missing | Hiện chưa có script build trong `package.json` |

## Mục tiêu nâng cấp an toàn

Nhóm tính năng dưới đây là phần shell và maintenance được thiết kế theo hướng an toàn. Một số command đã có trong code hiện tại, một số command vẫn cố ý để lại ở trạng thái `missing` để tránh mở rộng sang thao tác phá hủy hoặc chỉnh sửa tương tác quá mức cần thiết.

| Nhóm | Tính năng | Trạng thái | Ràng buộc an toàn |
| --- | --- | --- | --- |
| Shell | `/ls` liệt kê file/thư mục trong `process.cwd()` | implemented | Chỉ đọc, không ghi; phân biệt thư mục và file; output HTML an toàn |
| Shell | `/cd` đổi thư mục làm việc | implemented | Chỉ đổi trong phiên bot hiện tại; nên dùng đường dẫn rõ ràng |
| Shell | `/cat` đọc file text | implemented | Giới hạn kích thước file và escape HTML đầu ra |
| Shell | `/sh [lệnh]` chạy lệnh shell theo whitelist | implemented | Chỉ cho phép các lệnh trong whitelist; từ chối tức thì nếu không khớp |
| Maintenance | `/cleancache` dọn cache và flush log PM2 | implemented | Chỉ chạy với các lệnh đã xác định trước; trả kết quả từng bước; không cho user truyền lệnh tuỳ ý |
| Maintenance | `/npmcache` dọn cache npm | implemented | Dùng `npm cache clean --force` |
| Maintenance | `/restart` và `/stop` process PM2 | implemented | Dùng `PM2_PROCESS_NAME` hoặc tên mặc định của bot |
| Shell | `/nano` chỉnh file text tương tác | missing | Không khuyến nghị mặc định cho bot Telegram |
| Shell | `/rm` và `/reboot` qua bot | missing | Không nên mở mặc định vì rủi ro phá hủy cao |

### Đặc tả đầu ra mong muốn cho các lệnh mới

- `/ls`:
	- Trả danh sách bằng HTML
	- Thư mục hiển thị bằng biểu tượng `📁`
	- File hiển thị bằng biểu tượng `📄`
	- Nếu là file, kèm dung lượng
	- Bọc toàn bộ danh sách trong thẻ `<code>` để canh lề dễ đọc

- `/cleancache`:
	- Chạy tuần tự hai tác vụ: xả RAM đệm và `pm2 flush`
	- Báo cáo trạng thái thành công/thất bại của từng tác vụ bằng HTML
	- Nếu xả cache thành công, nên hiển thị lại trạng thái RAM hiện tại hoặc gọi lại logic `/status` để user thấy kết quả

- `/sh [lệnh]`:
	- Chỉ cho phép các lệnh nằm trong whitelist
	- Nếu không thuộc whitelist, trả thông báo từ chối ngay
	- Nếu hợp lệ, trả output dưới thẻ `<pre>` để giữ định dạng terminal
	- Mọi output shell cần được escape HTML trước khi ghép vào message

- `/cd`:
	- Đổi thư mục làm việc hiện tại của bot
	- Nếu không truyền tham số, bot trả về thư mục hiện tại
	- Chỉ chấp nhận thư mục hợp lệ

- `/cat`:
	- Đọc file text và trả về trong `<code>`
	- Giới hạn kích thước file để tránh tràn message Telegram
	- Escape HTML trước khi gửi

- `/npmcache`:
	- Chạy `npm cache clean --force`
	- Báo cáo output và exit code trong `<pre>`

- `/restart` và `/stop`:
	- Điều khiển process PM2 của bot theo tên process
	- Dùng `PM2_PROCESS_NAME` nếu có, nếu không thì mặc định `dev-assistant-bot`
	- Trả output thao tác trong `<pre>`

## Nhu cầu phù hợp cho một dev có server

Các tính năng dưới đây hữu ích nếu bot được dùng như một lớp quản trị server nhẹ. Phần lớn đã được triển khai ở mức an toàn; phần còn lại vẫn được giữ là `missing` để tránh đưa bot thành shell tùy ý hoặc trình soạn thảo tương tác đầy đủ.

| Nhóm | Tính năng | Trạng thái | Gợi ý phạm vi |
| --- | --- | --- | --- |
| Shell | Chạy lệnh shell tùy ý có kiểm soát | implemented | Chỉ dùng whitelist; không cho chạy lệnh tùy ý ngoài danh sách an toàn |
| Shell | Đổi thư mục làm việc | implemented | Phiên bot hiện tại đổi cwd để các lệnh sau dùng chung |
| Shell | Đọc file text | implemented | Giới hạn kích thước file và escape HTML đầu ra |
| Shell | Chỉnh file text tương tác | missing | Không khuyến nghị mặc định cho bot Telegram |
| Maintenance | Clean cache hệ thống | implemented | Chỉ thực thi các tác vụ đã xác định trước, có log/audit rõ ràng |
| Maintenance | Clean cache npm | implemented | Có lệnh riêng `/npmcache` để dọn cache npm |
| Maintenance | Kiểm tra dung lượng đĩa, RAM, tiến trình | implemented | Phần quan sát cơ bản đã có qua `/status` |
| Maintenance | Xem log dịch vụ | implemented | Hiện mới có log PM2 error log qua `/logs` |
| Maintenance | Restart/stop process | implemented | Dùng tên process PM2 mặc định hoặc cấu hình riêng |

## Gợi ý thiết kế cho nhóm lệnh server

Nếu sau này muốn bổ sung khả năng thao tác máy chủ, nên chia thành 3 lớp:

1. Lớp quan sát: `ls`, `cat`, `cd`, kiểm tra dung lượng, xem log, xem trạng thái process.
2. Lớp bảo trì an toàn: dọn cache, xoá file tạm, xoay log, restart service đã whitelist.
3. Lớp thao tác nhạy cảm: chạy shell tùy ý, `nano`, sửa file hệ thống, restart toàn máy.

Khuyến nghị giữ lớp 3 ở trạng thái hạn chế hoặc không triển khai mặc định, vì bot Telegram là bề mặt điều khiển từ xa rất nhạy cảm.

### Quy tắc an toàn bắt buộc nếu triển khai

1. Không cho phép truyền shell command tùy ý nếu chưa đi qua whitelist.
2. Không dùng bot để xử lý thao tác phá hủy như `rm -rf`, `reboot`, hoặc thay đổi hệ thống ngoài danh mục đã duyệt.
3. Luôn escape output trước khi đưa vào `replyWithHTML`.
4. Không để lỗi shell làm bot crash; mọi lệnh phải nằm trong `try/catch`.
5. Với lệnh maintenance, chỉ chạy các bước đã định nghĩa sẵn, không nhận input động từ user.
6. Chỉ dùng restart/stop trên process PM2 đã được định danh rõ ràng.

## Kết luận kỹ thuật

Bot hiện tại phù hợp như một trợ lý cá nhân cho dev: kiểm tra server, lấy IP, đọc log, xem uptime, ghi chú nhanh, liệt kê và đọc file, đổi thư mục làm việc, dọn cache theo bước cố định, dọn cache npm, điều khiển process PM2 cơ bản, và chạy shell whitelist.

Các tính năng shell/maintenance đã được triển khai theo hướng an toàn, nhưng vẫn nên giữ kỷ luật bảo mật: whitelist chặt, output escape, và không mở rộng sang lệnh phá hủy nếu chưa có cơ chế kiểm soát riêng.