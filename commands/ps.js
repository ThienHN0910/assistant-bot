const si = require('systeminformation');
const { escapeHtml, formatPercent } = require('../config/utils');
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');

module.exports = {
  name: 'ps',
  description: 'Xem top 5 tiến trình ngốn RAM & CPU nhiều nhất',
  execute: async (ctx, config = {}, deps = {}) => {
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

      let label = 'Master';
      let list;
      if (args[0]) {
        const node = await (deps.nodeManager || nodeManager).getNode(args[0], config);
        if (!node) { await ctx.replyWithHTML('⚠️ Node không tồn tại.'); return; }
        label = node.name || node.id;
        if (!node.isLocal) {
          const result = await (deps.nodeClient || nodeClient).getProcesses(node);
          if (!result.ok) { await ctx.replyWithHTML(`⚠️ ${escapeHtml(result.error || 'Node offline')}`); return; }
          list = result.processes || [];
        }
      }
      if (!list) list = (await (deps.si || si).processes())?.list || [];

      if (!list.length) {
        await ctx.reply('⚠️ Không lấy được danh sách tiến trình.');
        return;
      }

      // Sắp xếp giảm dần theo % RAM sử dụng
      const topMem = [...list]
        .sort((a, b) => (Number(b.mem) || 0) - (Number(a.mem) || 0))
        .slice(0, 5);

      const lines = [];
      lines.push(`📊 <b>TOP 5 TIẾN TRÌNH — ${escapeHtml(label)}</b>\n`);

      topMem.forEach((p, idx) => {
        const memPercent = Number(p.mem) || 0;
        const cpuPercent = Number(p.cpu) || 0;
        const name = p.name || 'unknown';
        const pid = p.pid;
        const user = p.user || 'root';

        lines.push(
          `<b>${idx + 1}. ${escapeHtml(name)}</b> (PID: <code>${Number(pid) || 0}</code> | User: <code>${escapeHtml(user)}</code>)\n` +
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
