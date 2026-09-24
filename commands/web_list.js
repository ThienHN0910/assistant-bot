const axios = require('axios');
const sandbox = require('../lib/sandbox');
const { escapeHtml } = require('../config/utils');

async function getPublicIp() {
  try {
    const res = await axios.get('https://api.ipify.org?format=json', { timeout: 3000 });
    return res.data?.ip || 'localhost';
  } catch {
    return 'localhost';
  }
}

module.exports = {
  name: 'web_list',
  description: 'Xem danh sách các web đang chạy trong sandbox',
  execute: async (ctx, config) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /web_list</b>\n` +
          `Liệt kê toàn bộ các web test đang chạy, port tương ứng, dung lượng chiếm dụng và link truy cập.\n\n` +
          `<b>Cú pháp:</b> <code>/web_list</code>`
        );
        return;
      }

      const deployments = await sandbox.listDeployments(config.webDeployDir);

      if (!deployments.length) {
        await ctx.replyWithHTML(
          `🌐 <b>CHƯA CÓ WEB NÀO TRONG SANDBOX</b>\n\n` +
          `<i>Hãy upload file .zip và gõ <code>/deploy</code> để triển khai web đầu tiên!</i>`
        );
        return;
      }

      const publicIp = await getPublicIp();
      const lines = [];
      lines.push('🌐 <b>DANH SÁCH CÁC WEB ĐANG CHẠY TRÊN SERVER</b>\n');

      deployments.forEach((d, idx) => {
        const url = d.url || (d.domain ? `https://${d.domain}` : (d.port ? `http://${publicIp}:${d.port}` : 'N/A'));
        const typeLabel = d.type === 'backend' ? 'Node.js Backend' : 'Web Tĩnh';
        const deployedDate = d.deployedAt ? new Date(d.deployedAt).toLocaleString('vi-VN') : 'N/A';
        const targetLabel = d.target ? ` [${d.target.toUpperCase()}]` : '';

        lines.push(
          `<b>${idx + 1}. ${escapeHtml(d.name)}</b> [<code>${typeLabel}</code>]${targetLabel}\n` +
          `   • URL: <a href="${url}">${url}</a>\n` +
          `   • Dung lượng: <b>${d.sizeFormatted}</b>\n` +
          `   • Deploy: <i>${deployedDate}</i>\n` +
          `   • Thao tác nhanh: <code>/perf ${d.port || d.name}</code> | <code>/web_remove ${d.name}</code>`
        );
      });

      await ctx.replyWithHTML(lines.join('\n\n'));
    } catch (error) {
      console.error('[WEB_LIST_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy danh sách web lúc này.');
    }
  },
};
