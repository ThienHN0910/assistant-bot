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
  name: 'deploy',
  description: 'Chạy trực tiếp chuỗi lệnh deploy tự động (git-pull, npm-install, npm-build, pm2-restart)',
  execute: async (ctx) => {
    try {
      let commands;
      try {
        commands = whitelist.getCommands('deploy', []);
      } catch (err) {
        await ctx.replyWithHTML(`🚫 Lỗi cấu hình whitelist: ${escapeHtml(String(err.message || err))}`);
        return;
      }

      await ctx.replyWithHTML('🚀 <b>Bắt đầu quá trình Deploy tự động...</b>\n<i>Vui lòng đợi (quá trình có thể mất từ vài chục giây đến 1 phút)...</i>');

      const results = await runner.runSequence(commands, { timeoutMs: 90000 });

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
          await ctx.replyWithHTML(`✅ <b>Hoàn thành Deploy! Kết quả chi tiết:</b>\n<pre>${escaped}</pre>`);
        } else {
          await ctx.replyWithHTML('✅ <b>Hoàn thành Deploy!</b> Kết quả quá dài, gửi dưới dạng file đính kèm.');
          const buffer = Buffer.from(output, 'utf8');
          await ctx.replyWithDocument({ source: buffer, filename: `deploy-output.txt` });
        }
      } catch (sendErr) {
        console.error('[DEPLOY_REPLY_ERROR]', sendErr);
        const truncated = escaped.slice(0, 3500) + '\n\n... (đã rút gọn)';
        await ctx.replyWithHTML(`<pre>${truncated}</pre>`).catch(() => {});
      }
    } catch (error) {
      console.error('[DEPLOY_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể thực thi lệnh deploy lúc này.');
    }
  },
};
