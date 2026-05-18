const axios = require('axios');
const { escapeMarkdown } = require('../config/utils');

function registerIpCommand(bot) {
  bot.command('ip', async (ctx) => {
    try {
      const response = await axios.get('https://api.ipify.org?format=json', {
        timeout: 5000,
      });

      const ip = response?.data?.ip;
      if (!ip) {
        throw new Error('Không nhận được địa chỉ IP từ API');
      }

      await ctx.reply(`🌐 *IP Public hiện tại:* \`${escapeMarkdown(ip)}\``, {
        parse_mode: 'MarkdownV2',
      });
    } catch (error) {
      console.error('[IP_COMMAND_ERROR]', error.message || error);
      await ctx.reply('⚠️ Không thể lấy IP public lúc này.');
    }
  });
}

module.exports = { registerIpCommand };
