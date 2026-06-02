const { Telegraf } = require("telegraf");
const { getConfig } = require("./config/env");
const { createAuthMiddleware } = require("./config/middleware");
const startCommand = require("./commands/start");
const statusCommand = require("./commands/status");
const ipCommand = require("./commands/ip");
const logsCommand = require("./commands/logs");
const uptimeCommand = require("./commands/uptime");
// `ls`, `cd`, `cat` moved into `sh` whitelist aliases; individual command files removed
const cleanCacheCommand = require("./commands/cleancache");
const npmcacheCommand = require("./commands/npmcache");
const shCommand = require("./commands/sh");
const stopCommand = require("./commands/stop");
const { createTextHandler } = require("./handlers/textHandler");

let bot;

async function startBot() {
  try {
    const config = getConfig();
    bot = new Telegraf(config.botToken);

    // Middleware bảo mật: chỉ cho phép 1 Telegram ID đã cấu hình.
    bot.use(createAuthMiddleware(config));

    // Đăng ký command handler theo mô-đun xuất ra object { name, execute }
    const modules = [
      startCommand,
      statusCommand,
      ipCommand,
      logsCommand,
      uptimeCommand,
      cleanCacheCommand,
      npmcacheCommand,
      shCommand,
      stopCommand,
    ];

    for (const mod of modules) {
      if (!mod) continue;

      // ÉP BUỘC CHẠY THEO CHUẨN OBJECT MỚI { name, execute }
      if (mod.name && typeof mod.execute === "function") {
        try {
          // Fix truyền tham số: Truyền config độc lập để các file như logs.js đọc được pm2ErrorLogPath
          bot.command(mod.name, (ctx) => mod.execute(ctx, config));
          console.log(`📡 Đã nạp thành công lệnh: /${mod.name}`);
        } catch (err) {
          console.error(
            `[BOT_MODULE_COMMAND_ERROR] Lỗi tại lệnh /${mod.name}:`,
            err,
          );
        }
        continue;
      }

      // Nếu phát hiện file nào cứng đầu chưa chuyển sang Object
      if (typeof mod === "function") {
        console.error(
          `[BOT_MODULE_ERROR] Phát hiện file lệnh viết dạng function cũ! Hãy chuyển sang Object { name, execute }.`,
        );
        continue;
      }

      console.warn(
        "[BOT_MODULE_WARN] Sai định dạng file lệnh:",
        mod && mod.name,
      );
    }

    // Xử lý text thường (snippet ghi chú).
    bot.on("text", createTextHandler(config));

    bot.catch((error) => {
      console.error("[BOT_RUNTIME_ERROR]", error);
    });

    await bot.launch();
    console.log("✅ Dev Assistant Bot đang chạy mượt mà...");
  } catch (error) {
    console.error("[BOT_STARTUP_ERROR]", error);
    process.exitCode = 1;
  }
}
async function gracefulShutdown(signal) {
  try {
    console.log(`⏳ Nhận tín hiệu ${signal}, đang tắt bot an toàn...`);
    if (bot) {
      await bot.stop(signal);
    }
    console.log("🛑 Bot đã dừng an toàn.");
  } catch (error) {
    console.error("[BOT_SHUTDOWN_ERROR]", error);
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", () => {
  gracefulShutdown("SIGINT").catch((error) => {
    console.error("[SIGINT_SHUTDOWN_ERROR]", error);
    process.exit(1);
  });
});

process.once("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch((error) => {
    console.error("[SIGTERM_SHUTDOWN_ERROR]", error);
    process.exit(1);
  });
});

startBot().catch((error) => {
  console.error("[BOT_FATAL_ERROR]", error);
  process.exit(1);
});
