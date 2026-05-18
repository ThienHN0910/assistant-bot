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
