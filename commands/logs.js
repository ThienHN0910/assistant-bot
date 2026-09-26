const fs = require('fs/promises');
const { readLastLines } = require('../config/utils'); // Bạn nhớ check lại đúng đường dẫn file utils nhé
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  name: 'logs',
  description: 'Xem 20 dòng log lỗi PM2 gần nhất',
  execute: async (ctx, config = {}, deps = {}) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /logs</b>\n` +
          `Xem nhanh 20 dòng log lỗi cuối cùng của tiến trình PM2 quản lý bot.\n\n` +
          `<b>Cú pháp:</b> <code>/logs</code>\n` +
          `<b>Ví dụ:</b> <code>/logs</code>`
        );
        return;
      }

      const count = Math.max(1, Math.min(Number(args.find((arg) => /^\d+$/.test(arg))) || 20, 100));
      const nodeId = args.find((arg) => !/^\d+$/.test(arg));
      if (nodeId) {
        const node = await (deps.nodeManager || nodeManager).getNode(nodeId, config);
        if (!node) { await ctx.replyWithHTML('⚠️ Node không tồn tại.'); return; }
        if (!node.isLocal) {
          const result = await (deps.nodeClient || nodeClient).getLogs(node, count);
          if (!result.ok) { await ctx.replyWithHTML(`⚠️ ${escapeHtml(result.error || 'Node offline')}`); return; }
          await ctx.replyWithHTML(`🧾 <b>${escapeHtml(node.name || node.id)}</b>\n<pre>${escapeHtml((result.log || '').slice(-3000))}</pre>`);
          return;
        }
      }

      // Đảm bảo config tồn tại, nếu không lấy tạm từ process.env
      const logPath = config?.pm2ErrorLogPath || process.env.PM2_ERROR_LOG_PATH;
      
      await fs.access(logPath);
      const logTail = await readLastLines(logPath, count);
      const output = logTail.trim() || 'Không có log lỗi.';

      await ctx.reply(`🧾 <b>20 dòng log lỗi PM2 gần nhất:</b>\n<pre>${escapeHtml(output)}</pre>`, {
        parse_mode: 'HTML',
      });
    } catch (error) {
      console.error('[LOGS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể đọc file log PM2. Kiểm tra lại PM2_ERROR_LOG_PATH trong file .env.');
    }
  }
};
