const { Telegraf } = require("telegraf");
const { getConfig } = require("./config/env");
const { createAuthMiddleware } = require("./config/middleware");
const startCommand = require("./commands/start");
const statusCommand = require("./commands/status");
const ipCommand = require("./commands/ip");
const logsCommand = require("./commands/logs");
const uptimeCommand = require("./commands/uptime");
const psCommand = require("./commands/ps");
const notesCommand = require("./commands/notes");
const nodesCommand = require("./commands/nodes");
const cleanCacheCommand = require("./commands/cleancache");
const restartCommand = require("./commands/restart");
const shCommand = require("./commands/sh");
const updateCommand = require("./commands/update");
const deployCommand = require("./commands/deploy");
const webListCommand = require("./commands/web_list");
const webRemoveCommand = require("./commands/web_remove");
const perfCommand = require("./commands/perf");
const deployWebCommand = require("./commands/deploy_web");
const { createTextHandler } = require("./handlers/textHandler");
const { startWatchdog, stopWatchdog } = require("./services/watchdog");
const { startDashboardServer, stopDashboardServer } = require("./services/dashboardApi");

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
      nodesCommand,
      ipCommand,
      logsCommand,
      uptimeCommand,
      psCommand,
      notesCommand,
      cleanCacheCommand,
      restartCommand,
      shCommand,
      updateCommand,
      deployCommand,
      webListCommand,
      webRemoveCommand,
      perfCommand,
      deployWebCommand,
    ];

    for (const mod of modules) {
      if (!mod) continue;

      if (mod.name && typeof mod.execute === "function") {
        try {
          bot.command(mod.name, (ctx) => mod.execute(ctx, config));
          if (typeof mod.register === "function") {
            mod.register(bot, config);
          }
          console.log(`📡 Đã nạp thành công lệnh: /${mod.name}`);
        } catch (err) {
          console.error(
            `[BOT_MODULE_COMMAND_ERROR] Lỗi tại lệnh /${mod.name}:`,
            err,
          );
        }
        continue;
      }

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

    // Kích hoạt Web Dashboard API Server (chạy trước bot.launch để đảm bảo luôn mở cổng 3001)
    startDashboardServer(config);

    // Kích hoạt service giám sát tự động (watchdog) nếu được cấu hình
    if (config.enableWatchdog !== false) {
      startWatchdog(bot, config);
    } else {
      console.log("🛡️ Watchdog service đã tắt theo cấu hình ENABLE_WATCHDOG=false.");
    }

    // Khởi động bot Telegram bất đồng bộ (tránh block event loop vì bot.launch giữ promise)
    bot.launch({ dropPendingUpdates: true })
      .then(() => {
        console.log("🛑 Bot Telegram đã kết thúc nhận cập nhật.");
      })
      .catch((err) => {
        console.error("[BOT_LAUNCH_ERROR]", err);
      });

    console.log("✅ Dev Assistant Bot và Dashboard API đang chạy mượt mà...");
  } catch (error) {
    console.error("[BOT_STARTUP_ERROR]", error);
    process.exitCode = 1;
  }
}

async function gracefulShutdown(signal) {
  try {
    console.log(`⏳ Nhận tín hiệu ${signal}, đang tắt bot an toàn...`);
    stopWatchdog();
    stopDashboardServer();
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
