# assistant-bot

Bot Telegram trợ lý cá nhân cho lập trình viên, viết bằng Node.js + Telegraf.

## 1) Cấu trúc thư mục

```text
assistant-bot/
├── config/
│   ├── env.js
│   ├── middleware.js
│   └── utils.js
├── commands/
│   ├── ip.js
│   ├── logs.js
│   ├── start.js
│   ├── status.js
│   └── uptime.js
├── handlers/
│   └── textHandler.js
├── .env.example
├── .gitignore
├── bot.js
├── package.json
├── LICENSE
└── README.md
```

## 2) Code chi tiết từng file

### `package.json`

```json
{
  "name": "assistant-bot",
  "version": "1.0.0",
  "description": "Telegram Dev Assistant Bot",
  "main": "bot.js",
  "scripts": {
    "start": "node bot.js",
    "dev": "node bot.js"
  },
  "keywords": [
    "telegram",
    "telegraf",
    "bot",
    "dev-assistant"
  ],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "axios": "^1.16.1",
    "dotenv": "^17.4.2",
    "systeminformation": "^5.31.6",
    "telegraf": "^4.16.3"
  }
}
```

### `.env.example`

```env
# Token Telegram Bot (lấy từ BotFather)
BOT_TOKEN=your_telegram_bot_token

# Chỉ ID Telegram này được phép sử dụng bot
AUTHORIZED_TELEGRAM_ID=123456789

# Đường dẫn file log lỗi của PM2 để dùng cho lệnh /logs
PM2_ERROR_LOG_PATH=/home/ubuntu/.pm2/logs/dev-assistant-bot-error.log

# Múi giờ dùng khi lưu ghi chú
TIMEZONE=Asia/Ho_Chi_Minh

# Đường dẫn file notes cục bộ
NOTES_FILE_PATH=./notes.txt
```

### `.gitignore`

```gitignore
node_modules/
.env
notes.txt
logs/
*.log
```

### `config/env.js`

```js
const path = require('path');
const dotenv = require('dotenv');

// Nạp biến môi trường từ file .env ở thư mục gốc dự án.
dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  }
  return value.trim();
}

function toAbsolutePath(filePath) {
  if (!filePath) return filePath;
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

function getConfig() {
  const botToken = requireEnv('BOT_TOKEN');
  const authorizedIdRaw = requireEnv('AUTHORIZED_TELEGRAM_ID');
  const authorizedTelegramId = Number(authorizedIdRaw);

  if (!Number.isInteger(authorizedTelegramId) || authorizedTelegramId <= 0) {
    throw new Error('AUTHORIZED_TELEGRAM_ID phải là số nguyên dương hợp lệ');
  }

  const timezone = (process.env.TIMEZONE || 'Asia/Ho_Chi_Minh').trim();
  const notesFilePath = toAbsolutePath(process.env.NOTES_FILE_PATH || './notes.txt');
  const pm2ErrorLogPath = toAbsolutePath(requireEnv('PM2_ERROR_LOG_PATH'));

  return {
    botToken,
    authorizedTelegramId,
    timezone,
    notesFilePath,
    pm2ErrorLogPath,
  };
}

module.exports = { getConfig };
```

### `config/middleware.js`

```js
function createAuthMiddleware(config) {
  return async (ctx, next) => {
    try {
      const senderId = ctx.from?.id;
      if (senderId !== config.authorizedTelegramId) {
        const deniedMessage =
          '🚫 *Cảnh báo bảo mật*\n\n' +
          'Bạn không có quyền sử dụng bot này.';

        // Chỉ trả lời khi có khả năng phản hồi tin nhắn.
        if (typeof ctx.reply === 'function') {
          await ctx.reply(deniedMessage, { parse_mode: 'Markdown' });
        }

        console.warn(
          `[SECURITY] Từ chối truy cập từ Telegram ID: ${senderId ?? 'unknown'}`
        );
        return;
      }

      await next();
    } catch (error) {
      console.error('[AUTH_MIDDLEWARE_ERROR]', error);
      if (typeof ctx.reply === 'function') {
        await ctx
          .reply('⚠️ Có lỗi khi kiểm tra quyền truy cập.', {
            parse_mode: 'Markdown',
          })
          .catch((replyError) => {
            console.error('[AUTH_MIDDLEWARE_REPLY_ERROR]', replyError);
          });
      }
    }
  };
}

module.exports = { createAuthMiddleware };
```

### `config/utils.js`

```js
const fs = require('fs/promises');

function escapeMarkdown(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/([_\-*\[\]()~`>#+=|{}.!])/g, '\\$1');
}

async function readLastLines(filePath, lineCount = 20) {
  const content = await fs.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  // Loại bỏ dòng rỗng ở cuối file để đảm bảo trả về đúng số dòng log thực tế.
  while (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.slice(-lineCount).join('\n');
}

function formatBytes(bytes) {
  const gb = bytes / (1024 ** 3);
  return `${gb.toFixed(2)} GB`;
}

function formatPercent(value) {
  return `${Number(value).toFixed(2)}%`;
}

module.exports = {
  escapeMarkdown,
  readLastLines,
  formatBytes,
  formatPercent,
};
```

### `commands/start.js`

```js
function registerStartCommand(bot) {
  bot.command('start', async (ctx) => {
    try {
      const message = [
        '👋 *Chào mừng đến với Dev Assistant Bot*',
        '',
        '🤖 Bot trợ lý cá nhân dành cho lập trình viên\!',
        '',
        '📋 *Danh sách lệnh:*',
        '- /start \- Hiển thị menu hướng dẫn',
        '- /status \- Xem tài nguyên server realtime',
        '- /ip \- Lấy IP public hiện tại',
        '- /logs \- Xem 20 dòng log lỗi PM2 gần nhất',
        '- /uptime \- Xem thời gian uptime của server',
        '',
        '📝 *Snippet ghi chú:*',
        'Gửi text thường \(không bắt đầu bằng `/`\) để lưu vào `notes\.txt`\.',
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'MarkdownV2' });
    } catch (error) {
      console.error('[START_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể hiển thị menu lúc này.');
    }
  });
}

module.exports = { registerStartCommand };
```

### `commands/status.js`

```js
const si = require('systeminformation');
const { formatBytes, formatPercent } = require('../config/utils');

function registerStatusCommand(bot) {
  bot.command('status', async (ctx) => {
    try {
      const [cpuLoad, memory, fileSystems] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
      ]);

      const rootDisk = fileSystems.find((item) => item.mount === '/') || fileSystems[0] || { available: 0 };

      const cpuUsage = cpuLoad.currentLoad;
      const ramUsagePercent = (memory.used / memory.total) * 100;
      const cpuWarn = cpuUsage >= 80 ? ' ⚠️' : '';
      const ramWarn = ramUsagePercent >= 80 ? ' ⚠️' : '';

      const report = [
        '🖥️ *Báo cáo trạng thái server*',
        '',
        `• CPU: *${formatPercent(cpuUsage)}*${cpuWarn}`,
        `• RAM: *${formatBytes(memory.used)} / ${formatBytes(memory.total)}* \(${formatPercent(ramUsagePercent)}\)${ramWarn}`,
        `• SWAP: *${formatBytes(memory.swapused)} / ${formatBytes(memory.swaptotal)}*`,
        `• Disk / còn trống: *${formatBytes(rootDisk.available)}*`,
      ].join('\n');

      await ctx.reply(report, { parse_mode: 'MarkdownV2' });
    } catch (error) {
      console.error('[STATUS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy trạng thái server lúc này.');
    }
  });
}

module.exports = { registerStatusCommand };
```

### `commands/ip.js`

```js
const axios = require('axios');
const { escapeMarkdown } = require('../config/utils');

function registerIpCommand(bot) {
  bot.command('ip', async (ctx) => {
    try {
      const response = await axios.get('https://api.ipify.org?format=json', {
        timeout: 5000,
      });

      const ip = response?.data?.ip;
      if (!ip) {
        throw new Error('Không nhận được địa chỉ IP từ API');
      }

      await ctx.reply(`🌐 *IP Public hiện tại:* \`${escapeMarkdown(ip)}\``, {
        parse_mode: 'MarkdownV2',
      });
    } catch (error) {
      console.error('[IP_COMMAND_ERROR]', error.message || error);
      await ctx.reply('⚠️ Không thể lấy IP public lúc này.');
    }
  });
}

module.exports = { registerIpCommand };
```

### `commands/logs.js`

```js
const fs = require('fs/promises');
const { readLastLines } = require('../config/utils');

function registerLogsCommand(bot, config) {
  bot.command('logs', async (ctx) => {
    try {
      await fs.access(config.pm2ErrorLogPath);
      const logTail = await readLastLines(config.pm2ErrorLogPath, 20);
      const output = logTail.trim() || 'Không có log lỗi.';

      await ctx.reply(`🧾 *20 dòng log lỗi PM2 gần nhất:*\n\n\`\`\`text\n${output}\n\`\`\``, {
        parse_mode: 'MarkdownV2',
      });
    } catch (error) {
      console.error('[LOGS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể đọc file log PM2. Kiểm tra lại PM2_ERROR_LOG_PATH.');
    }
  });
}

module.exports = { registerLogsCommand };
```

### `commands/uptime.js`

```js
const si = require('systeminformation');

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${days} ngày ${hours} giờ ${minutes} phút`;
}

function registerUptimeCommand(bot) {
  bot.command('uptime', async (ctx) => {
    try {
      const uptimeSeconds = await si.time().then((t) => t.uptime);
      await ctx.reply(`⏱️ Uptime server: *${formatDuration(uptimeSeconds)}*`, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      console.error('[UPTIME_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy uptime server lúc này.');
    }
  });
}

module.exports = { registerUptimeCommand };
```

### `handlers/textHandler.js`

```js
const fs = require('fs/promises');

function createTextHandler(config) {
  return async (ctx) => {
    try {
      const text = ctx.message?.text;

      // Chỉ xử lý text thường, bỏ qua lệnh bắt đầu bằng '/'.
      if (!text || text.startsWith('/')) {
        return;
      }

      const timestamp = new Date().toLocaleString('vi-VN', {
        timeZone: config.timezone,
        hour12: false,
      });

      const line = `[${timestamp}] ${text}\n`;
      await fs.appendFile(config.notesFilePath, line, 'utf8');

      await ctx.reply('✅ Đã lưu ghi chú thành công!');
    } catch (error) {
      console.error('[TEXT_HANDLER_ERROR]', error);
      await ctx.reply('⚠️ Không thể lưu ghi chú vào lúc này.');
    }
  };
}

module.exports = { createTextHandler };
```

### `bot.js`

```js
const { Telegraf } = require('telegraf');
const { getConfig } = require('./config/env');
const { createAuthMiddleware } = require('./config/middleware');
const { registerStartCommand } = require('./commands/start');
const { registerStatusCommand } = require('./commands/status');
const { registerIpCommand } = require('./commands/ip');
const { registerLogsCommand } = require('./commands/logs');
const { registerUptimeCommand } = require('./commands/uptime');
const { createTextHandler } = require('./handlers/textHandler');

let bot;

async function startBot() {
  try {
    const config = getConfig();
    bot = new Telegraf(config.botToken);

    // Middleware bảo mật: chỉ cho phép 1 Telegram ID đã cấu hình.
    bot.use(createAuthMiddleware(config));

    // Đăng ký command handler theo từng module riêng.
    registerStartCommand(bot);
    registerStatusCommand(bot);
    registerIpCommand(bot);
    registerLogsCommand(bot, config);
    registerUptimeCommand(bot);

    // Xử lý text thường (snippet ghi chú).
    bot.on('text', createTextHandler(config));

    bot.catch((error) => {
      console.error('[BOT_RUNTIME_ERROR]', error);
    });

    await bot.launch();
    console.log('✅ Dev Assistant Bot đang chạy...');
  } catch (error) {
    console.error('[BOT_STARTUP_ERROR]', error);
    process.exitCode = 1;
  }
}

async function gracefulShutdown(signal) {
  try {
    console.log(`⏳ Nhận tín hiệu ${signal}, đang tắt bot an toàn...`);
    if (bot) {
      await bot.stop(signal);
    }
    console.log('🛑 Bot đã dừng an toàn.');
  } catch (error) {
    console.error('[BOT_SHUTDOWN_ERROR]', error);
  } finally {
    process.exit(0);
  }
}

process.once('SIGINT', () => {
  gracefulShutdown('SIGINT').catch((error) => {
    console.error('[SIGINT_SHUTDOWN_ERROR]', error);
    process.exit(1);
  });
});

process.once('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch((error) => {
    console.error('[SIGTERM_SHUTDOWN_ERROR]', error);
    process.exit(1);
  });
});

startBot().catch((error) => {
  console.error('[BOT_FATAL_ERROR]', error);
  process.exit(1);
});
```

## 3) Hướng dẫn chạy trên Ubuntu + PM2

```bash
# 1. Vào thư mục dự án
cd /home/ubuntu/assistant-bot

# 2. Cài Node.js LTS (nếu chưa có)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Cài dependency
npm install

# 4. Tạo file .env thật từ mẫu
cp .env.example .env

# 5. Sửa thông tin thật trong .env
nano .env

# 6. Chạy thử local
npm start

# 7. Cài PM2 toàn cục
sudo npm install -g pm2

# 8. Chạy bot bằng PM2
pm2 start bot.js --name dev-assistant-bot

# 9. Kiểm tra trạng thái
pm2 status
pm2 logs dev-assistant-bot

# 10. Bật tự khởi động cùng hệ thống
pm2 startup
pm2 save
```

## Tính năng chính đã có

- Middleware bảo mật: chỉ đúng 1 Telegram ID mới dùng được bot.
- `/start`: menu Markdown trực quan.
- `/status`: CPU/RAM/SWAP/Disk realtime + cảnh báo ⚠️ khi CPU hoặc RAM >= 80%.
- `/ip`: lấy IP public bằng API ipify qua axios.
- `/logs`: đọc đúng 20 dòng log cuối từ file PM2 error log.
- Text handler: append ghi chú vào `notes.txt` theo múi giờ `Asia/Ho_Chi_Minh`.
- Graceful shutdown cho PM2 (`SIGINT`, `SIGTERM`) và bắt lỗi runtime để tránh crash.
