const deployer = require('../lib/deployer');
const perf = require('../lib/perf');
const { escapeHtml } = require('../config/utils');

async function resolveTargetUrl(input, config) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return null;

  // 1. Nếu là URL đầy đủ (http:// hoặc https://)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // 2. Tra cứu trong danh mục dự án đã triển khai (VPS, Vercel, Render)
  try {
    const deployments = await deployer.listAllDeployments(config);
    const found = deployments.find((d) =>
      d.name?.toLowerCase() === trimmed.toLowerCase() ||
      d.id?.toLowerCase() === trimmed.toLowerCase() ||
      d.domain?.toLowerCase() === trimmed.toLowerCase()
    );
    if (found) {
      if (found.url) return found.url;
      if (found.domain) return `https://${found.domain}`;
    }
  } catch {}

  const baseDomain = config?.baseDomain || 'thienhn.io.vn';

  // 3. Nếu là domain hoặc subdomain có chứa dấu chấm (vd: bot.thienhn.io.vn)
  if (trimmed.includes('.')) {
    return `https://${trimmed}`;
  }

  // 4. Nếu là tên subdomain ngắn (vd: portfolio -> https://portfolio.thienhn.io.vn)
  return `https://${trimmed}.${baseDomain}`;
}

module.exports = {
  name: 'perf',
  description: 'Đo lường hiệu năng trang web (TTFB, độ trễ HTTP và Google PageSpeed)',
  resolveTargetUrl,
  execute: async (ctx, config) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);

      if (!args.length || args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /perf</b>\n` +
          `Đo độ trễ phản hồi tại chỗ (TTFB, DNS, Connect) và lấy điểm Google PageSpeed Insights cho website.\n\n` +
          `<b>Cú pháp:</b> <code>/perf &lt;tên_project | domain | url&gt;</code>\n\n` +
          `<b>Ví dụ:</b>\n` +
          `• <code>/perf portfolio</code> (Đo theo tên dự án đã deploy)\n` +
          `• <code>/perf bot.thienhn.io.vn</code> (Đo theo tên miền / subdomain)\n` +
          `• <code>/perf https://example.com</code> (Đo theo URL bất kỳ)`
        );
        return;
      }

      const rawTarget = args[0];
      const targetUrl = await resolveTargetUrl(rawTarget, config);

      if (!targetUrl) {
        await ctx.replyWithHTML('⚠️ Không tìm thấy URL hợp lệ để đo hiệu năng.');
        return;
      }

      await ctx.replyWithHTML(
        `⏱️ <b>Đang đo lường hiệu năng cho:</b>\n<code>${escapeHtml(targetUrl)}</code>\n` +
        `<i>Vui lòng đợi vài giây để hoàn tất kiểm tra...</i>`
      );

      // 1. Đo độ trễ HTTP tại chỗ
      let latencyResult;
      try {
        latencyResult = await perf.measureHttpLatency(targetUrl);
      } catch (latErr) {
        await ctx.replyWithHTML(`❌ <b>Không thể kết nối đến URL:</b> ${escapeHtml(latErr.message || String(latErr))}`);
        return;
      }

      // 2. Đo Google PageSpeed (nếu khả dụng)
      const apiKey = process.env.PAGESPEED_API_KEY || null;
      const pageSpeedResult = await perf.fetchPageSpeedScore(targetUrl, apiKey);

      // 3. Format báo cáo kết quả
      const lines = [];
      lines.push('⚡ <b>KẾT QUẢ ĐO HIỆU NĂNG WEBSITE</b>\n');
      lines.push(`🌐 <b>Mục tiêu:</b> <code>${escapeHtml(targetUrl)}</code>`);
      lines.push(`• Trạng thái HTTP: <b>${latencyResult.statusCode}</b>`);
      lines.push(`• Kích thước phản hồi: <b>${latencyResult.sizeFormatted}</b>\n`);

      lines.push('⏱️ <b>Độ trễ phản hồi máy chủ (Server Latency):</b>');
      lines.push(`• <b>TTFB (Time To First Byte):</b> <code>${latencyResult.ttfbMs} ms</code>`);
      lines.push(`• DNS Lookup: <code>${latencyResult.dnsMs} ms</code>`);
      lines.push(`• TCP Connect: <code>${latencyResult.connectMs} ms</code>`);
      lines.push(`• Tổng thời gian: <b>${latencyResult.totalMs} ms</b>\n`);

      lines.push('🎯 <b>Google PageSpeed / Lighthouse (Mobile):</b>');
      if (pageSpeedResult.ok) {
        const score = pageSpeedResult.score ?? 'N/A';
        const scoreIcon = score >= 90 ? '🟢' : score >= 50 ? '🟡' : '🔴';
        lines.push(`• Điểm Performance: ${scoreIcon} <b>${score} / 100</b>`);
        lines.push(`• FCP (First Contentful Paint): <code>${pageSpeedResult.fcp}</code>`);
        lines.push(`• LCP (Largest Contentful Paint): <code>${pageSpeedResult.lcp}</code>`);
        lines.push(`• TBT (Total Blocking Time): <code>${pageSpeedResult.tbt}</code>`);
        lines.push(`• CLS (Cumulative Layout Shift): <code>${pageSpeedResult.cls}</code>`);
      } else if (pageSpeedResult.skipped) {
        lines.push(`<i>(${escapeHtml(pageSpeedResult.reason)})</i>`);
      } else {
        lines.push(`<i>⚠️ Không lấy được điểm PageSpeed: ${escapeHtml(pageSpeedResult.reason || 'Lỗi kết nối')}</i>`);
      }

      await ctx.replyWithHTML(lines.join('\n'));
    } catch (error) {
      console.error('[PERF_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể hoàn thành đo đạc hiệu năng lúc này.');
    }
  },
};
