# assistant-bot

Telegram bot tro ly ca nhan cho lap trinh vien, xay dung bang Node.js + Telegraf.

Bot ho tro:
- Kiem tra tai nguyen server
- Lay IP public
- Doc log loi PM2
- Xem uptime
- Luu ghi chu tu tin nhan text thuong
- Gioi han truy cap theo 1 Telegram ID duoc uy quyen

## Tinh nang

- Bao mat:
  - Middleware chan tat ca Telegram ID khong hop le
- Lenh Telegram:
  - /start: Hien thi huong dan va danh sach lenh
  - /status: CPU, RAM, SWAP, dung luong trong dia
  - /ip: Lay IP public qua ipify
  - /logs: Doc 20 dong cuoi tu file PM2 error log
  - /uptime: Thoi gian uptime cua server
- Text handler:
  - Tin nhan text khong bat dau bang / se duoc append vao file ghi chu
- Van hanh:
  - Graceful shutdown voi SIGINT, SIGTERM
  - Bat loi runtime de tranh vo tien trinh bat ngo

## Yeu cau

- Node.js 18+ (khuyen nghi LTS)
- npm 9+
- Telegram bot token (tao qua BotFather)

## Cai dat va chay local

```bash
npm install
cp .env.example .env
# sua file .env voi gia tri that
npm run dev
```

## Bien moi truong

Tham khao file .env.example.

- BOT_TOKEN:
  - Token cua Telegram bot
- AUTHORIZED_TELEGRAM_ID:
  - Telegram user ID duy nhat duoc phep dung bot
- PM2_ERROR_LOG_PATH:
  - Duong dan toi file error log cua PM2
- TIMEZONE:
  - Mui gio dung khi luu ghi chu, mac dinh Asia/Ho_Chi_Minh
- NOTES_FILE_PATH:
  - Duong dan file ghi chu, mac dinh ./notes.txt

Vi du PM2_ERROR_LOG_PATH:
- Linux: /home/ubuntu/.pm2/logs/dev-assistant-bot-error.log
- Windows: C:/Users/<user>/.pm2/logs/dev-assistant-bot-error.log

## Scripts

```bash
npm run dev
npm start
npm run check:syntax
npm run build
```

Y nghia:
- dev/start: chay bot
- check:syntax: check syntax tat ca file JS chinh bang node --check
- build: alias cua check:syntax

## Cau truc du an

```text
assistant-bot/
├── bot.js
├── commands/
│   ├── ip.js
│   ├── logs.js
│   ├── start.js
│   ├── status.js
│   └── uptime.js
├── config/
│   ├── env.js
│   ├── middleware.js
│   └── utils.js
├── handlers/
│   └── textHandler.js
├── .env.example
├── .gitignore
├── LICENSE
├── package.json
└── README.md
```

## Chay bang PM2 (Ubuntu)

```bash
npm install -g pm2
pm2 start bot.js --name dev-assistant-bot
pm2 status
pm2 logs dev-assistant-bot
pm2 save
```

## Luu y

- Neu /logs bao loi, kiem tra lai PM2_ERROR_LOG_PATH ton tai va co quyen doc.
- Du an hien tai khong co transpile bundling; build la buoc kiem tra syntax.
- De an toan, khong commit file .env va du lieu notes that.
