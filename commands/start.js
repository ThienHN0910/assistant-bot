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
      lines.push('🤖 <i>Trợ lý điều hành lập trình viên & cụm Multi-VPS thông minh!</i>');
      lines.push('');
      lines.push('💡 <i>Mẹo: Thêm <code>-h</code> sau bất kỳ lệnh nào (vd: <code>/perf -h</code>, <code>/update -h</code>) để xem hướng dẫn chi tiết & ví dụ.</i>');
      lines.push('');
      lines.push('<b>🖥️ GIÁM SÁT & CỤM SERVER:</b>');
      lines.push('• /status - Giám sát tài nguyên thời gian thực tất cả VPS');
      lines.push('• /nodes - Quản lý danh sách máy chủ cụm Multi-VPS');
      lines.push('• /ps - Xem top 5 tiến trình ngốn RAM & CPU');
      lines.push('• /uptime - Thời gian hoạt động của máy chủ');
      lines.push('• /logs - Xem 20 dòng log lỗi PM2 gần nhất (OOM-safe)');
      lines.push('• /ip - Lấy địa chỉ IP public của cụm server');
      lines.push('');
      lines.push('<b>🌐 TRIỂN KHAI & QUẢN LÝ WEB:</b>');
      lines.push('• /web_list - Xem danh sách web test đang chạy & máy chủ');
      lines.push('• /deploy - Triển khai web 1 chạm (từ ZIP hoặc link GitHub)');
      lines.push('• /web_remove - Gỡ bỏ web an toàn & thu hồi DNS');
      lines.push('• /perf - Đo độ trễ TTFB & điểm Google PageSpeed');
      lines.push('');
      lines.push('<b>⚙️ HỆ THỐNG & ĐIỀU HÀNH:</b>');
      lines.push('• /restart - Khởi động lại bot/agent qua PM2 an toàn');
      lines.push('• /update - Tự động cập nhật code từ GitHub & khởi động lại');
      lines.push('• /cleancache - Xả RAM buffer/cache & flush log PM2');
      lines.push('• /sh - Chạy lệnh shell an toàn theo whitelist');
      lines.push('• /notes - Xem 10 ghi chú gần nhất (hoặc <code>/notes clear</code>)');
      lines.push('');
      lines.push('<b>📝 Ghi chú nhanh:</b>');
      lines.push('Gửi tin nhắn thường (không bắt đầu bằng <code>/</code>) để lưu vào <code>notes.txt</code>.');

      const options = {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '/status' }, { text: '/nodes' }, { text: '/ps' }, { text: '/uptime' }],
            [{ text: '/web_list' }, { text: '/deploy' }, { text: '/perf -h' }],
            [{ text: '/logs' }, { text: '/cleancache' }, { text: '/notes' }],
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