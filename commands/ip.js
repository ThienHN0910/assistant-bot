const axios = require('axios');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  name: 'ip',
  description: 'Lấy IP public hiện tại của server',
  execute: async (ctx) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /ip</b>\n` +
          `Lấy địa chỉ IP Public hiện tại của máy chủ (tiện ích khi máy chủ sử dụng IP động hoặc cần kiểm tra kết nối mạng).\n\n` +
          `<b>Cú pháp:</b> <code>/ip</code>\n` +
          `<b>Ví dụ:</b> <code>/ip</code>`
        );
        return;
      }

      const response = await axios.get('https://api.ipify.org?format=json', {
        timeout: 5000,
      });

      const ip = response?.data?.ip;
      if (!ip) {
        throw new Error('Không nhận được địa chỉ IP từ API');
      }

      // Đã bọc HTML chuẩn chỉnh, không sợ conflict ký tự đặc biệt
      await ctx.replyWithHTML(`🌐 <b>IP Public hiện tại:</b> <code>${escapeHtml(ip)}</code>`);
    } catch (error) {
      console.error('[IP_COMMAND_ERROR]', error.message || error);
      await ctx.reply('⚠️ Không thể lấy IP public lúc này.');
    }
  },
};