const { escapeHtml } = require('../config/utils');
const whitelist = require('../lib/whitelist');
const runner = require('../lib/runner');

function extractShellCommand(ctx) {
  const text = ctx.message?.text || '';
  const parts = text.trim().split(/\s+/).slice(1);
  return parts;
}

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
  name: 'sh',
  description: 'Chạy lệnh shell theo whitelist an toàn (sử dụng aliases)',
  execute: async (ctx) => {
    try {
      const parts = extractShellCommand(ctx);

      if (!parts || parts.length === 0) {
        const aliases = whitelist.listAliases().map(a => `/${a}`).join('\n');
        await ctx.replyWithHTML(`⚠️ Cú pháp: <code>/sh /alias [args]</code>\n\nDanh sách alias:\n<pre>${escapeHtml(aliases)}</pre>`);
        return;
      }

      const first = parts[0];
      const alias = first.startsWith('/') ? first.slice(1) : first;
      const args = parts.slice(1);

      let commands;
      try {
        commands = whitelist.getCommands(alias, args);
      } catch (err) {
        await ctx.replyWithHTML(`🚫 Lỗi: ${escapeHtml(String(err.message || err))}`);
        return;
      }

      const results = await runner.runSequence(commands, { timeoutMs: 60000 });

      const blocks = [];
      for (let i = 0; i < commands.length; i++) {
        const step = commands[i];
        const res = results[i] || { ok: false, stdout: '', stderr: 'No result', code: null };
        blocks.push(buildStepOutput(step, res));
      }

      const output = blocks.join('\n\n-----\n\n');
      const escaped = escapeHtml(output);

      // Telegram has message size limits; if too long, send as file instead
      try {
        if (escaped.length <= 3500) {
          await ctx.replyWithHTML(`<pre>${escaped}</pre>`);
        } else {
          // send short summary and attach full output as document
          await ctx.replyWithHTML('Kết quả quá dài, gửi dưới dạng file đính kèm.');
          const buffer = Buffer.from(output, 'utf8');
          await ctx.replyWithDocument({ source: buffer, filename: `${alias}-output.txt` });
        }
      } catch (sendErr) {
        console.error('[SH_REPLY_ERROR]', sendErr);
        // fallback: try to send truncated message
        const truncated = escaped.slice(0, 3500) + '\n\n... (đã rút gọn)';
        await ctx.replyWithHTML(`<pre>${truncated}</pre>`).catch(() => {});
      }
    } catch (error) {
      console.error('[SH_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể thực thi lệnh shell lúc này.');
    }
  },
};