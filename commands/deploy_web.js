const { escapeHtml } = require('../config/utils');
const whitelist = require('../lib/whitelist');
const runner = require('../lib/runner');

function buildStepOutput(step, res) {
  const parts = [];
  parts.push(`Lệnh: ${step.cmd} ${ (step.args || []).join(' ') }`.trim());
  parts.push(`Trạng thái: ${res.ok ? 'Thành công' : 'Thất bại'}`);
  if (res.stdout) {
    parts.push('');
    parts.push('stdout:');
    parts.push(res.stdout.trimEnd());
  }
  if (res.stderr) {
    parts.push('');
    parts.push('stderr:');
    parts.push(res.stderr.trimEnd());
  }
  if (typeof res.code !== 'undefined') {
    parts.push('');
    parts.push(`exit code: ${res.code}`);
  }
  return parts.join('\n');
}

module.exports = {
  name: 'deploy_web',
  description: 'Triển khai website tĩnh/SPA trong một lệnh duy nhất: /deploy_web <project> <zip> <server>',
  execute: async (ctx) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);

      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /deploy_web</b>\n` +
          `Triển khai website tĩnh/SPA lên máy chủ Nginx chỉ trong một bước duy nhất bằng script Bash tự động.\n\n` +
          `<b>Cú pháp:</b> <code>/deploy_web &lt;tên_project&gt; &lt;tên_file_zip&gt; &lt;tên_domain_hoặc_IP&gt;</code>\n` +
          `<b>Tham số:</b>\n` +
          `- <code>&lt;tên_project&gt;</code>: Tên thư mục dự án tạo trong /home/hnt/web/.\n` +
          `- <code>&lt;tên_file_zip&gt;</code>: Tên file ZIP chứa bản build (ví dụ: dist.zip).\n` +
          `- <code>&lt;tên_domain_hoặc_IP&gt;</code>: Tên miền hoặc địa chỉ IP để cấu hình virtual host Nginx.\n\n` +
          `<b>Ví dụ mẫu:</b> <code>/deploy_web portfolio-vue dist.zip mydomain.com</code>`
        );
        return;
      }

      if (args.length < 3) {
        await ctx.replyWithHTML(
          `⚠️ <b>Thiếu tham số!</b>\n` +
          `Cú pháp: <code>/deploy_web &lt;tên_project&gt; &lt;tên_file_zip&gt; &lt;tên_domain_hoặc_IP&gt;</code>\n\n` +
          `Ví dụ: <code>/deploy_web portfolio-vue dist.zip mydomain.com</code>`
        );
        return;
      }

      let commands;
      try {
        commands = whitelist.getCommands('deploy-web', args);
      } catch (err) {
        await ctx.replyWithHTML(`🚫 Lỗi cấu hình whitelist: ${escapeHtml(String(err.message || err))}`);
        return;
      }

      await ctx.replyWithHTML(`🚀 <b>Bắt đầu triển khai dự án "${escapeHtml(args[0])}"...</b>\n<i>Vui lòng đợi thiết lập...</i>`);

      const results = await runner.runSequence(commands, { timeoutMs: 120000 });

      const blocks = [];
      for (let i = 0; i < commands.length; i++) {
        const step = commands[i];
        const res = results[i] || { ok: false, stdout: '', stderr: 'Không có kết quả', code: null };
        blocks.push(buildStepOutput(step, res));
      }

      const output = blocks.join('\n\n-----\n\n');
      const escaped = escapeHtml(output);

      // Gửi kết quả
      try {
        if (escaped.length <= 3500) {
          await ctx.replyWithHTML(`✅ <b>Hoàn thành Triển khai! Kết quả chi tiết:</b>\n<pre>${escaped}</pre>`);
        } else {
          await ctx.replyWithHTML('✅ <b>Hoàn thành Triển khai!</b> Kết quả quá dài, gửi dưới dạng file đính kèm.');
          const buffer = Buffer.from(output, 'utf8');
          await ctx.replyWithDocument({ source: buffer, filename: `deploy-${args[0]}-output.txt` });
        }
      } catch (sendErr) {
        console.error('[DEPLOY_WEB_REPLY_ERROR]', sendErr);
        const truncated = escaped.slice(0, 3500) + '\n\n... (đã rút gọn)';
        await ctx.replyWithHTML(`<pre>${truncated}</pre>`).catch(() => {});
      }
    } catch (error) {
      console.error('[DEPLOY_WEB_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể triển khai dự án lúc này.');
    }
  },
};
