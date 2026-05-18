// Export object form: { name, description, execute }
function escapeMarkdown(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/[_\[\]\(\)~>#+=\-\|{}\.!]/g, '\\$&');
}

module.exports = {
  name: 'start',
  description: 'Hiển thị menu hướng dẫn',
  execute: async (ctx) => {
    try {
      const lines = [];
      lines.push('*' + 'Chào mừng đến với Dev Assistant Bot' + '*');
      lines.push('🤖 ' + escapeMarkdown('Bot trợ lý cá nhân dành cho lập trình viên'));
      lines.push('');
      lines.push('*' + 'Danh sách lệnh:' + '*');
      lines.push(escapeMarkdown('/start') + ' - ' + escapeMarkdown('Hiển thị menu hướng dẫn'));
      lines.push(escapeMarkdown('/status') + ' - ' + escapeMarkdown('Xem tài nguyên server realtime'));
      lines.push(escapeMarkdown('/ip') + ' - ' + escapeMarkdown('Lấy IP public hiện tại'));
      lines.push(escapeMarkdown('/logs') + ' - ' + escapeMarkdown('Xem 20 dòng log lỗi PM2 gần nhất'));
      lines.push(escapeMarkdown('/uptime') + ' - ' + escapeMarkdown('Xem thời gian uptime của server'));
      lines.push('');
      lines.push(escapeMarkdown('Gửi text thường (không bắt đầu bằng /) để lưu vào notes.txt.'));

      const options = {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          keyboard: [['/status', '/ip'], ['/logs', '/uptime']],
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
