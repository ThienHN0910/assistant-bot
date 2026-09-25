const deployer = require('../lib/deployer');
const { escapeHtml } = require('../config/utils');

module.exports = {
  name: 'web_list',
  description: 'Xem danh sách các web đang chạy (VPS, Vercel, Render)',
  execute: async (ctx, config) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /web_list</b>\n` +
          `Liệt kê toàn bộ các dự án đang chạy trên VPS, Vercel và Render kèm link tên miền.\n\n` +
          `<b>Cú pháp:</b> <code>/web_list</code>`
        );
        return;
      }

      const deployments = await deployer.listAllDeployments(config);

      if (!deployments.length) {
        await ctx.replyWithHTML(
          `🌐 <b>CHƯA CÓ WEB NÀO ĐƯỢC TRIỂN KHAI</b>\n\n` +
          `<i>Hãy upload file .zip hoặc dán link GitHub công khai để triển khai web đầu tiên!</i>`
        );
        return;
      }

      const lines = [];
      lines.push('🌐 <b>DANH SÁCH DỰ ÁN ĐANG CHẠY (VPS & CLOUD)</b>\n');

      deployments.forEach((d, idx) => {
        const url = d.url || (d.domain ? `https://${d.domain}` : 'N/A');
        const typeLabel = d.type === 'backend' ? 'Node.js Backend' : 'Web Tĩnh';
        const deployedDate = d.deployedAt ? new Date(d.deployedAt).toLocaleString('vi-VN') : 'N/A';
        const targetLabel = d.target ? ` [${d.target.toUpperCase()}]` : '';

        lines.push(
          `<b>${idx + 1}. ${escapeHtml(d.name)}</b> [<code>${typeLabel}</code>]${targetLabel}\n` +
          `   • URL: ${url === 'N/A' ? 'N/A' : `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`}\n` +
          `   • Trạng thái: <code>${escapeHtml(d.status || 'unknown')}</code>\n` +
          `   • Dung lượng: <b>${d.sizeFormatted}</b>\n` +
          `   • Deploy: <i>${deployedDate}</i>\n` +
          `   • Thao tác nhanh: <code>/perf ${d.name}</code> | <code>/web_remove ${d.name}</code>`
        );
      });

      await ctx.replyWithHTML(lines.join('\n\n'));
    } catch (error) {
      console.error('[WEB_LIST_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy danh sách web lúc này.');
    }
  },
};
