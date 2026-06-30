const si = require('systeminformation');
const { formatBytes, formatPercent } = require('../config/utils');

module.exports = {
  name: 'status',
  description: 'Báo cáo trạng thái server',
  execute: async (ctx) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /status</b>\n` +
          `Xem trạng thái tài nguyên phần cứng thời gian thực của máy chủ.\n\n` +
          `<b>Cú pháp:</b> <code>/status</code>\n` +
          `<b>Thông số trả về:</b> CPU (%), RAM (đã dùng/tổng), SWAP (đã dùng/tổng), dung lượng đĩa còn trống (/).\n` +
          `<b>Ví dụ:</b> <code>/status</code>`
        );
        return;
      }

      const [cpuLoad, memory, fileSystems] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
      ]);

      const rootDisk = (Array.isArray(fileSystems) && fileSystems.length > 0)
        ? (fileSystems.find((item) => item.mount === '/') || fileSystems[0])
        : { available: 0 };

      const cpuUsage = Number(cpuLoad?.currentLoad) || 0;
      const ramUsagePercent = memory && memory.total ? (memory.used / memory.total) * 100 : 0;
      const cpuWarn = cpuUsage >= 80 ? ' ⚠️' : '';
      const ramWarn = ramUsagePercent >= 80 ? ' ⚠️' : '';

      const lines = [];
      lines.push('🖥️ <b>Báo cáo trạng thái server</b>\n');
      lines.push(`• CPU: <b>${formatPercent(cpuUsage)}</b>${cpuWarn}`);
      lines.push(`• RAM: <b>${formatBytes(memory?.used || 0)} / ${formatBytes(memory?.total || 0)}</b> (${formatPercent(ramUsagePercent)})${ramWarn}`);
      lines.push(`• SWAP: <b>${formatBytes(memory?.swapused || 0)} / ${formatBytes(memory?.swaptotal || 0)}</b>`);
      lines.push(`• Disk (/): <b>${formatBytes(rootDisk?.available || 0)}</b> còn trống`);

      await ctx.replyWithHTML(lines.join('\n'));
    } catch (error) {
      console.error('[STATUS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy trạng thái server lúc này.');
    }
  },
};