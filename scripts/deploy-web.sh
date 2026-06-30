#!/bin/bash
# Tắt script ngay lập tức nếu bất kỳ lệnh nào thất bại
set -e

PROJECT_NAME=$1
ZIP_FILE=$2
SERVER_NAME=$3

if [ -z "$PROJECT_NAME" ] || [ -z "$ZIP_FILE" ] || [ -z "$SERVER_NAME" ]; then
  echo "Lỗi: Thiếu tham số bắt buộc."
  echo "Cú pháp: deploy-web.sh <project_name> <zip_file> <server_name>"
  exit 1
fi

WEB_DIR="/home/hnt/web"
PROJECT_DIR="$WEB_DIR/$PROJECT_NAME"

echo "=== [1/7] Khởi tạo thư mục dự án ==="
mkdir -p "$PROJECT_DIR"

echo "=== [2/7] Di chuyển file nén ZIP ==="
# Kiểm tra file ZIP ở các vị trí có thể có
if [ -f "/home/hnt/$ZIP_FILE" ]; then
  mv "/home/hnt/$ZIP_FILE" "$PROJECT_DIR/"
elif [ -f "/home/hnt/web/$ZIP_FILE" ]; then
  mv "/home/hnt/web/$ZIP_FILE" "$PROJECT_DIR/"
elif [ -f "$ZIP_FILE" ]; then
  mv "$ZIP_FILE" "$PROJECT_DIR/"
else
  echo "Lỗi: Không tìm thấy file ZIP: $ZIP_FILE"
  exit 1
fi

echo "=== [3/7] Giải nén và dọn dẹp file cũ ==="
cd "$PROJECT_DIR"
if [ -d "dist" ]; then
  rm -rf dist
fi
unzip -o "$ZIP_FILE"
rm -f "$ZIP_FILE"

echo "=== [4/7] Cấu hình phân quyền Nginx ==="
sudo chmod +x /home/hnt
sudo chmod +x /home/hnt/web
sudo chmod -R 755 "$PROJECT_DIR"

echo "=== [5/7] Tạo Virtual Host Nginx ==="
TEMP_CONFIG=$(mktemp)
cat <<EOF > "$TEMP_CONFIG"
server {
    listen 80;
    server_name $SERVER_NAME;

    root $PROJECT_DIR/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
}
EOF

sudo mv "$TEMP_CONFIG" "/etc/nginx/sites-available/$PROJECT_NAME"
sudo chmod 644 "/etc/nginx/sites-available/$PROJECT_NAME"

echo "=== [6/7] Kích hoạt cấu hình (Symlink) ==="
sudo ln -sf "/etc/nginx/sites-available/$PROJECT_NAME" "/etc/nginx/sites-enabled/"

echo "=== [7/7] Kiểm tra cú pháp và tải lại Nginx ==="
sudo nginx -t
sudo systemctl reload nginx

echo "=== Deploy thành công dự án $PROJECT_NAME! ==="
