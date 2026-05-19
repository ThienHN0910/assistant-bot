const fs = require('fs/promises');
const path = require('path');
const { escapeHtml, formatFileSize } = require('../config/utils');

async function getEntryDetails(basePath, entry) {
  const entryPath = path.join(basePath, entry.name);

  if (entry.isDirectory()) {
    return {
      name: entry.name,
      isDirectory: true,
      display: `📁 ${entry.name}/`,
    };
  }

  const stats = await fs.stat(entryPath);
  return {
    name: entry.name,
    isDirectory: false,
    display: `📄 ${entry.name} (${formatFileSize(stats.size)})`,
  };
}

module.exports = {
  name: 'ls',
  description: 'Liệt kê file và thư mục trong thư mục hiện tại',
  execute: async (ctx) => {
    try {
      const cwd = process.cwd();
      const entries = await fs.readdir(cwd, { withFileTypes: true });

      const details = await Promise.all(entries.map((entry) => getEntryDetails(cwd, entry)));
      details.sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1;
        }

        return left.name.localeCompare(right.name, 'vi');
      });

      const lines = details.map((item) => item.display);
      const output = lines.length > 0 ? lines.join('\n') : '(thư mục hiện tại trống)';

      await ctx.replyWithHTML(
        `<b>📂 Danh sách trong thư mục hiện tại</b>\n<code>${escapeHtml(output)}</code>`,
      );
    } catch (error) {
      console.error('[LS_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể liệt kê thư mục hiện tại lúc này.');
    }
  },
};