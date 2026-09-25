const si = require('systeminformation');
const { formatBytes, formatPercent } = require('../config/utils');

let intervalId = null;

// Trạng thái cảnh báo hiện tại (State-based / Edge-triggered)
// Chỉ gửi tin nhắn 1 lần duy nhất khi chuyển trạng thái (Normal -> Critical)
const alertState = {
  cpu: false,
  ram: false,
  disk: false,
};

// Đếm chu kỳ CPU cao liên tục để tránh báo động giả khi CPU spike ngắn hạn (ví dụ lúc build/unzip)
let highCpuCycles = 0;
const REQUIRED_HIGH_CPU_CYCLES = 2; // Cần >= 2 chu kỳ liên tiếp (>= 10 phút)

function resetAlertState() {
  alertState.cpu = false;
  alertState.ram = false;
  alertState.disk = false;
  highCpuCycles = 0;
}

async function checkSystemHealth(bot, config, deps = {}) {
  try {
    const depSi = deps.si || si;
    const [memory, fileSystems, cpuData] = await Promise.all([
      depSi.mem(),
      depSi.fsSize(),
      typeof depSi.currentLoad === 'function' ? depSi.currentLoad() : Promise.resolve({ currentLoad: 0 }),
    ]);

    const totalRam = memory?.total || 1;
    const usedRam = memory?.used || 0;
    const availableRam = memory?.available !== undefined ? memory.available : (totalRam - usedRam);
    const ramPercent = (usedRam / totalRam) * 100;

    const rootDisk = Array.isArray(fileSystems) && fileSystems.length > 0
      ? (fileSystems.find((item) => item.mount === '/') || fileSystems[0])
      : null;

    const diskPercent = rootDisk?.use || 0;
    const cpuLoad = cpuData?.currentLoad || 0;

    // 1. Phân tích CPU: Chỉ báo khi CPU >= 90% liên tục qua >= 2 chu kỳ kiểm tra
    if (cpuLoad >= 90) {
      highCpuCycles += 1;
    } else {
      highCpuCycles = Math.max(0, highCpuCycles - 1);
    }
    const isCpuCritical = highCpuCycles >= REQUIRED_HIGH_CPU_CYCLES;

    // 2. Phân tích RAM: Trên VPS 1GB, Linux duy trì RAM 80-87% là bình thường (PageCache).
    // Chỉ báo động khi RAM khả dụng thực sự cạn kiệt (< 60MB) hoặc % dùng >= 95%.
    const isRamCritical = availableRam < (60 * 1024 * 1024) || ramPercent >= 95;

    // 3. Phân tích Disk: Ổ đĩa gốc (/) đầy >= 90%
    const isDiskCritical = diskPercent >= 90;

    // Danh sách cảnh báo mới kích hoạt (chỉ kích hoạt nếu trước đó chưa báo động)
    const newAlerts = [];
    if (isCpuCritical && !alertState.cpu) {
      alertState.cpu = true;
      newAlerts.push(`⚠️ <b>CẢNH BÁO CPU QUÁ TẢI LIÊN TỤC:</b> Tải CPU đang ở mức <b>${formatPercent(cpuLoad)}</b> kéo dài trên 10 phút.`);
    }
    if (isRamCritical && !alertState.ram) {
      alertState.ram = true;
      newAlerts.push(`⚠️ <b>CẢNH BÁO RAM CẠN KIỆT (NGUY CƠ OOM):</b> RAM khả dụng chỉ còn <b>${formatBytes(availableRam)}</b> / ${formatBytes(totalRam)} (Đã dùng ${formatPercent(ramPercent)}).`);
    }
    if (isDiskCritical && !alertState.disk) {
      alertState.disk = true;
      newAlerts.push(`⚠️ <b>CẢNH BÁO Ổ ĐĨA:</b> Dung lượng đĩa (/) đã dùng <b>${formatPercent(diskPercent)}</b>.`);
    }

    // Danh sách hồi phục (khi các chỉ số đã hạ xuống mức an toàn sau khi từng bị cảnh báo)
    const recoveries = [];
    if (alertState.cpu && cpuLoad < 70) {
      alertState.cpu = false;
      recoveries.push(`✅ Tải CPU đã hạ xuống mức an toàn: <b>${formatPercent(cpuLoad)}</b>.`);
    }
    if (alertState.ram && availableRam >= (120 * 1024 * 1024) && ramPercent < 90) {
      alertState.ram = false;
      recoveries.push(`✅ RAM khả dụng đã tăng lên <b>${formatBytes(availableRam)}</b>. Nguy cơ OOM đã được giải tỏa.`);
    }
    if (alertState.disk && diskPercent < 85) {
      alertState.disk = false;
      recoveries.push(`✅ Dung lượng đĩa (/) đã được giải phóng xuống <b>${formatPercent(diskPercent)}</b>.`);
    }

    // Gửi cảnh báo nếu có sự cố mới chuyển trạng thái
    if (newAlerts.length > 0) {
      const message = [
        '🚨 <b>[WATCHDOG BÁO ĐỘNG TÀI NGUYÊN SERVER]</b>',
        '',
        ...newAlerts,
        '',
        '<i>Gợi ý xử lý:</i>',
        '• Gõ <code>/ps</code> để kiểm tra tiến trình chiếm tài nguyên',
        '• Gõ <code>/cleancache</code> để xả cache RAM và dọn log PM2',
      ].join('\n');

      await sendTelegramMessage(bot, config, message);
    }

    // Gửi thông báo hồi phục nếu có chỉ số trở về bình thường
    if (recoveries.length > 0) {
      const recoveryMessage = [
        '🌱 <b>[WATCHDOG HỆ THỐNG ĐÃ ỔN ĐỊNH TRỞ LẠI]</b>',
        '',
        ...recoveries,
      ].join('\n');

      await sendTelegramMessage(bot, config, recoveryMessage);
    }
  } catch (error) {
    console.error('[WATCHDOG_CHECK_ERROR]', error.message || error);
  }
}

async function sendTelegramMessage(bot, config, message) {
  if (bot && bot.telegram && config.authorizedTelegramId) {
    try {
      await bot.telegram.sendMessage(config.authorizedTelegramId, message, {
        parse_mode: 'HTML',
      });
    } catch (sendErr) {
      console.error('[WATCHDOG_SEND_ALERT_ERROR]', sendErr.message || sendErr);
    }
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
  console.log('🛡️ Watchdog service đã được kích hoạt (Edge-triggered, chu kỳ 5 phút).');
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
  resetAlertState,
  alertState,
};
