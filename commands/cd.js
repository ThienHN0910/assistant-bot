const fs = require('fs/promises');
const path = require('path');
const { escapeHtml } = require('../config/utils');

function extractTargetDirectory(ctx) {
  const text = ctx.message?.text || '';
  const firstSpaceIndex = text.indexOf(' ');

  if (firstSpaceIndex === -1) {
    return '';
  }

  return text.slice(firstSpaceIndex + 1).trim();
}

async function resolveDirectory(target) {
  const resolvedPath = path.isAbsolute(target)
    ? path.normalize(target)
    : path.resolve(process.cwd(), target);

  const stats = await fs.stat(resolvedPath);
  if (!stats.isDirectory()) {
    throw new Error('Đường dẫn không phải là thư mục hợp lệ');
  }

  return resolvedPath;
}

module.exports = {
  name: 'cd',
  description: 'Đổi thư mục làm việc hiện tại',
  execute: async (ctx) => {
    try {
      const target = extractTargetDirectory(ctx);

      if (!target) {
        await ctx.replyWithHTML(`<b>Thư mục hiện tại:</b> <code>${escapeHtml(process.cwd())}</code>`);
        return;
      }

      const nextDirectory = await resolveDirectory(target);
      process.chdir(nextDirectory);

      await ctx.replyWithHTML(
        `<b>Đã chuyển thư mục làm việc</b>\n<code>${escapeHtml(process.cwd())}</code>`,
      );
    } catch (error) {
      console.error('[CD_COMMAND_ERROR]', error);
      await ctx.replyWithHTML(
        `<b>Không thể đổi thư mục</b>\n<code>${escapeHtml(error.message || 'Lỗi không xác định')}</code>`,
      );
    }
  },
};