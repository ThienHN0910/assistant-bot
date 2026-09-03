const si = require('systeminformation');
const { escapeHtml, formatPercent } = require('../config/utils');

module.exports = {
  name: 'ps',
  description: 'Xem top 5 tiến trình ngốn RAM & CPU nhiều nhất',
  execute: async (ctx) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /ps</b>\n` +
          `Kiểm tra top 5 tiến trình đang tiêu thụ nhiều RAM & CPU nhất trên server.\n\n` +
          `<b>Cú pháp:</b> <code>/ps</code>\n` +
          `<b>Ví dụ:</b> <code>/ps</code>`
        );
        return;
      }

      const procData = await si.processes();
      const list = procData?.list || [];

      if (!list.length) {
        await ctx.reply('⚠️ Không lấy được danh sách tiến trình.');
        return;
      }

      // Sắp xếp giảm dần theo % RAM sử dụng
      const topMem = [...list]
        .sort((a, b) => (Number(b.mem) || 0) - (Number(a.mem) || 0))
        .slice(0, 5);

      const lines = [];
      lines.push('📊 <b>TOP 5 TIẾN TRÌNH TIÊU THỤ RAM NHIỀU NHẤT</b>\n');

      topMem.forEach((p, idx) => {
        const memPercent = Number(p.mem) || 0;
        const cpuPercent = Number(p.cpu) || 0;
        const name = p.name || 'unknown';
        const pid = p.pid;
        const user = p.user || 'root';

        lines.push(
          `<b>${idx + 1}. ${escapeHtml(name)}</b> (PID: <code>${pid}</code> | User: <code>${escapeHtml(user)}</code>)\n` +
          `   • RAM: <b>${formatPercent(memPercent)}</b> | CPU: <b>${formatPercent(cpuPercent)}</b>`
        );
      });

      await ctx.replyWithHTML(lines.join('\n\n'));
    } catch (error) {
      console.error('[PS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy danh sách tiến trình lúc này.');
    }
  },
};
