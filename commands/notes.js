const fs = require('fs/promises');
const { escapeHtml, readLastLines } = require('../config/utils');

module.exports = {
  name: 'notes',
  description: 'Xem các dòng ghi chú gần nhất đã lưu',
  execute: async (ctx, config) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /notes</b>\n` +
          `Xem lại 10 dòng ghi chú gần nhất đã được lưu trong file notes.txt.\n\n` +
          `<b>Cú pháp:</b> <code>/notes</code>\n` +
          `<b>Xóa ghi chú:</b> <code>/notes clear</code>\n` +
          `<b>Thêm ghi chú:</b> Gửi tin nhắn text thường (không bắt đầu bằng dấu /).\n` +
          `<b>Ví dụ:</b> <code>/notes</code>`
        );
        return;
      }

      const notesPath = config?.notesFilePath || './notes.txt';

      if (args.includes('clear')) {
        await fs.writeFile(notesPath, '', 'utf8');
        await ctx.replyWithHTML('🗑️ <b>Đã xóa toàn bộ nội dung ghi chú thành công!</b>');
        return;
      }

      try {
        await fs.access(notesPath);
      } catch {
        await ctx.replyWithHTML('📝 <b>Chưa có ghi chú nào được lưu.</b>\n<i>Hãy gửi tin nhắn text thường bất kỳ để lưu ghi chú!</i>');
        return;
      }

      const content = await readLastLines(notesPath, 10);
      if (!content || !content.trim()) {
        await ctx.replyWithHTML('📝 <b>File ghi chú đang trống.</b>\n<i>Hãy gửi tin nhắn text thường bất kỳ để lưu ghi chú!</i>');
        return;
      }

      await ctx.replyWithHTML(
        `📝 <b>10 dòng ghi chú gần nhất:</b>\n\n<pre>${escapeHtml(content.trim())}</pre>`
      );
    } catch (error) {
      console.error('[NOTES_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể đọc ghi chú lúc này.');
    }
  },
};
