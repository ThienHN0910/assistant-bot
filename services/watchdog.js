const si = require('systeminformation');
const { formatBytes, formatPercent } = require('../config/utils');

let intervalId = null;
let lastAlertTime = 0;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 phút cooldown giữa các lần cảnh báo liên tục

async function checkSystemHealth(bot, config) {
  try {
    const [memory, fileSystems] = await Promise.all([
      si.mem(),
      si.fsSize(),
    ]);

    const totalRam = memory.total || 1;
    const usedRam = memory.used || 0;
    const ramPercent = (usedRam / totalRam) * 100;

    const rootDisk = Array.isArray(fileSystems) && fileSystems.length > 0
      ? (fileSystems.find((item) => item.mount === '/') || fileSystems[0])
      : null;

    const diskPercent = rootDisk?.use || 0;

    const isRamCritical = ramPercent >= 85;
    const isDiskCritical = diskPercent >= 90;

    if (isRamCritical || isDiskCritical) {
      const now = Date.now();
      if (now - lastAlertTime < ALERT_COOLDOWN_MS) {
        return; // Đang trong thời gian cooldown, không spam tin nhắn
      }

      lastAlertTime = now;

      const alerts = [];
      if (isRamCritical) {
        alerts.push(`⚠️ <b>CẢNH BÁO RAM:</b> Đang dùng <b>${formatBytes(usedRam)} / ${formatBytes(totalRam)}</b> (${formatPercent(ramPercent)})`);
      }
      if (isDiskCritical) {
        alerts.push(`⚠️ <b>CẢNH BÁO Ổ ĐĨA:</b> Dung lượng đĩa (/) đã dùng <b>${formatPercent(diskPercent)}</b>`);
      }

      const message = [
        '🚨 <b>[WATCHDOG BÁO ĐỘNG TÀI NGUYÊN SERVER]</b>',
        '',
        ...alerts,
        '',
        '<i>Gợi ý xử lý:</i>',
        '• Gõ <code>/ps</code> để kiểm tra tiến trình chiếm RAM',
        '• Gõ <code>/cleancache</code> để xả cache RAM và dọn log PM2',
      ].join('\n');

      if (bot && bot.telegram && config.authorizedTelegramId) {
        await bot.telegram.sendMessage(config.authorizedTelegramId, message, {
          parse_mode: 'HTML',
        }).catch((sendErr) => {
          console.error('[WATCHDOG_SEND_ALERT_ERROR]', sendErr.message || sendErr);
        });
      }
    }
  } catch (error) {
    console.error('[WATCHDOG_CHECK_ERROR]', error.message || error);
  }
}

function startWatchdog(bot, config, intervalMs = 5 * 60 * 1000) {
  if (intervalId) return;

  // Chạy kiểm tra lần đầu sau 10 giây khi bot khởi động
  setTimeout(() => {
    checkSystemHealth(bot, config);
  }, 10000);

  intervalId = setInterval(() => {
    checkSystemHealth(bot, config);
  }, intervalMs);

  if (intervalId.unref) {
    intervalId.unref();
  }
  console.log('🛡️ Watchdog service đã được kích hoạt (chu kỳ 5 phút).');
}

function stopWatchdog() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('🛑 Watchdog service đã dừng.');
  }
}

module.exports = {
  checkSystemHealth,
  startWatchdog,
  stopWatchdog,
};
