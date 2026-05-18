const fs = require('fs/promises');
const { readLastLines } = require('../config/utils'); // Bạn nhớ check lại đúng đường dẫn file utils nhé

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  name: 'logs',
  description: 'Xem 20 dòng log lỗi PM2 gần nhất',
  execute: async (ctx, config) => { // Truyền thêm config vào đây để lấy đường dẫn log
    try {
      // Đảm bảo config tồn tại, nếu không lấy tạm từ process.env
      const logPath = config?.pm2ErrorLogPath || process.env.PM2_ERROR_LOG_PATH;
      
      await fs.access(logPath);
      const logTail = await readLastLines(logPath, 20);
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