const fs = require('fs/promises');
const path = require('path');
const { escapeHtml, formatFileSize } = require('../config/utils');

const MAX_FILE_SIZE_BYTES = 64 * 1024;
const MAX_OUTPUT_CHARS = 3000;

function extractTargetFile(ctx) {
  const text = ctx.message?.text || '';
  const firstSpaceIndex = text.indexOf(' ');

  if (firstSpaceIndex === -1) {
    return '';
  }

  return text.slice(firstSpaceIndex + 1).trim();
}

function resolveFilePath(target) {
  return path.isAbsolute(target)
    ? path.normalize(target)
    : path.resolve(process.cwd(), target);
}

module.exports = {
  name: 'cat',
  description: 'Đọc nội dung file text',
  execute: async (ctx) => {
    try {
      const target = extractTargetFile(ctx);

      if (!target) {
        await ctx.replyWithHTML('⚠️ Cú pháp: <code>/cat &lt;đường_dẫn_file&gt;</code>');
        return;
      }

      const filePath = resolveFilePath(target);
      const stats = await fs.stat(filePath);

      if (!stats.isFile()) {
        throw new Error('Đường dẫn không phải là file hợp lệ');
      }

      if (stats.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(`File quá lớn để hiển thị an toàn (${formatFileSize(stats.size)})`);
      }

      const content = await fs.readFile(filePath, 'utf8');
      const output = content.length > MAX_OUTPUT_CHARS
        ? `${content.slice(0, MAX_OUTPUT_CHARS)}\n... (đã rút gọn)`
        : content;

      await ctx.replyWithHTML(
        `<b>📄 ${escapeHtml(path.basename(filePath))}</b>\n<code>${escapeHtml(output)}</code>`,
      );
    } catch (error) {
      console.error('[CAT_COMMAND_ERROR]', error);
      await ctx.replyWithHTML(
        `<b>Không thể đọc file</b>\n<code>${escapeHtml(error.message || 'Lỗi không xác định')}</code>`,
      );
    }
  },
};