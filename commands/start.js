module.exports = {
  name: 'start',
  description: 'Hiển thị menu hướng dẫn',
  execute: async (ctx) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /start</b>\n` +
          `Hiển thị danh sách tất cả các câu lệnh khả dụng của bot và bàn phím tương tác nhanh.\n\n` +
          `<b>Cú pháp:</b> <code>/start</code>\n` +
          `<b>Ví dụ:</b> <code>/start</code>`
        );
        return;
      }

      const lines = [];
      lines.push('<b>👋 Chào mừng đến với Dev Assistant Bot</b>');
      lines.push('🤖 Bot trợ lý cá nhân dành cho lập trình viên!');
      lines.push('');
      lines.push('<b>📋 Danh sách lệnh:</b>');
      lines.push('• /start - Hiển thị menu hướng dẫn');
      lines.push('• /status - Xem tài nguyên server realtime');
      lines.push('• /ps - Xem top 5 tiến trình ngốn RAM & CPU');
      lines.push('• /ip - Lấy IP public hiện tại');
      lines.push('• /logs - Xem 20 dòng log lỗi PM2 gần nhất (OOM-safe)');
      lines.push('• /uptime - Xem thời gian uptime của server');
      lines.push('• /cleancache - Dọn cache an toàn và flush log PM2');
      lines.push('• /notes - Xem 10 ghi chú gần nhất (hoặc /notes clear)');
      lines.push('• /deploy - Triển khai web test từ file ZIP (1 chạm)');
      lines.push('• /web_list - Xem danh sách web test đang host');
      lines.push('• /web_remove - Gỡ bỏ web test khỏi server');
      lines.push('• /restart - Khởi động lại bot từ xa qua PM2 an toàn');
      lines.push('• /update - Tự động cập nhật mã nguồn bot và khởi động lại');
      lines.push('• /sh - Chạy lệnh shell theo whitelist an toàn');
      lines.push('');
      lines.push('<b>📝 Snippet ghi chú:</b>');
      lines.push('Gửi text thường (không bắt đầu bằng /) để lưu vào <code>notes.txt</code>.');

      const options = {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '/status' }, { text: '/ps' }, { text: '/uptime' }],
            [{ text: '/deploy' }, { text: '/web_list' }, { text: '/notes' }],
            [{ text: '/logs' }, { text: '/cleancache' }, { text: '/ip' }],
            [{ text: '/restart' }, { text: '/update' }, { text: '/sh -h' }],
          ],
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      };

      await ctx.reply(lines.join('\n'), options);
    } catch (err) {
      console.error('[START_COMMAND_ERROR]', err);
      try {
        await ctx.reply('⚠️ Không thể hiển thị menu lúc này.');
      } catch (e) {
        console.error('[START_COMMAND_FALLBACK_ERROR]', e);
      }
    }
  },
};