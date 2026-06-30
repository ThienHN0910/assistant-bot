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
      // Sử dụng thẻ <b> để in đậm trong chế độ HTML
      lines.push('<b>👋 Chào mừng đến với Dev Assistant Bot</b>');
      lines.push('🤖 Bot trợ lý cá nhân dành cho lập trình viên!');
      lines.push('');
      lines.push('<b>📋 Danh sách lệnh:</b>');
      lines.push('• /start - Hiển thị menu hướng dẫn');
      lines.push('• /status - Xem tài nguyên server realtime');
      lines.push('• /ip - Lấy IP public hiện tại');
      lines.push('• /logs - Xem 20 dòng log lỗi PM2 gần nhất');
      lines.push('• /uptime - Xem thời gian uptime của server');
      lines.push('• /cleancache - Dọn cache an toàn và flush log PM2');
      lines.push('• /npmcache - Dọn cache npm');
      lines.push('• /update - Tự động cập nhật mã nguồn bot và khởi động lại');
      lines.push('• /deploy-web - Triển khai website tĩnh/SPA trong 1 bước duy nhất');
      lines.push('• /sh - Chạy lệnh shell theo whitelist an toàn');
      lines.push('• /stop - Stop process PM2 của bot');
      lines.push('');
      // Dùng thẻ <code> để chữ notes.txt nhìn giống code block Monospace đẹp mắt
      lines.push('<b>📝 Snippet ghi chú:</b>');
      lines.push('Gửi text thường (không bắt đầu bằng /) để lưu vào <code>notes.txt</code>.');

      const options = {
        // Đổi tùy chọn gửi tin nhắn sang HTML
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '/status' }, { text: '/ip' }, { text: '/uptime' }],
            [{ text: '/logs' }, { text: '/cleancache' }, { text: '/npmcache' }],
            [{ text: '/update' }, { text: '/stop' }, { text: '/deploy-web -h' }]
          ],
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      };

      // Gửi tin nhắn đồng bộ theo tùy chọn HTML
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