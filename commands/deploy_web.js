const fs = require('fs/promises');
const path = require('path');
const deployer = require('../lib/deployer');
const { escapeHtml } = require('../config/utils');

async function resolveZipPath(zipName, uploadDir) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.zip$/i.test(zipName) || zipName.includes('..')) {
    throw new Error('Tên file ZIP không hợp lệ');
  }
  for (const dir of [uploadDir, path.dirname(uploadDir)]) {
    const candidate = path.join(dir, zipName);
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Không tìm thấy file ZIP: ${zipName}`);
}

module.exports = {
  name: 'deploy_web',
  description: 'Triển khai ZIP lên VPS tại <project>.thienhn.io.vn',
  execute: async (ctx, config) => {
    const args = (ctx.message?.text || '').trim().split(/\s+/).slice(1);
    if (args.length !== 2 || args.includes('-h') || args.includes('--help')) {
      await ctx.replyWithHTML(
        'Cú pháp: <code>/deploy_web &lt;project&gt; &lt;file.zip&gt;</code>\n' +
        'Ví dụ: <code>/deploy_web test site.zip</code> → <code>https://test.thienhn.io.vn</code>'
      );
      return;
    }

    try {
      const [projectName, zipName] = args;
      if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(projectName)) {
        throw new Error('Tên project chỉ được dùng chữ, số và dấu gạch nối');
      }
      const sourcePath = await resolveZipPath(zipName, config.uploadDir);
      await ctx.replyWithHTML(`⏳ Đang triển khai <b>${escapeHtml(projectName)}</b>...`);
      const result = await deployer.deploy({
        source: 'zip_upload',
        sourcePath,
        projectName,
        target: 'vps',
      }, config);
      if (!result.ok || result.deployment.status !== 'online') throw new Error('Triển khai chưa hoàn tất');
      const url = escapeHtml(result.deployment.url);
      await ctx.replyWithHTML(`✅ <b>Triển khai thành công:</b> <a href="${url}">${url}</a>`);
    } catch (error) {
      await ctx.replyWithHTML(`❌ <b>Triển khai thất bại:</b> ${escapeHtml(error.message || String(error))}`);
    }
  },
};
