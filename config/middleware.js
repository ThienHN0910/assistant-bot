function createAuthMiddleware(config) {
  return async (ctx, next) => {
    try {
      const senderId = ctx.from?.id;
      if (senderId !== config.authorizedTelegramId) {
        const deniedMessage =
          '🚫 *Cảnh báo bảo mật*\n\n' +
          'Bạn không có quyền sử dụng bot này.';

        // Chỉ trả lời khi có khả năng phản hồi tin nhắn.
        if (typeof ctx.reply === 'function') {
          await ctx.reply(deniedMessage, { parse_mode: 'Markdown' });
        }

        console.warn(
          `[SECURITY] Từ chối truy cập từ Telegram ID: ${senderId ?? 'unknown'}`
        );
        return;
      }

      await next();
    } catch (error) {
      console.error('[AUTH_MIDDLEWARE_ERROR]', error);
      if (typeof ctx.reply === 'function') {
        await ctx
          .reply('⚠️ Có lỗi khi kiểm tra quyền truy cập.', {
            parse_mode: 'Markdown',
          })
          .catch((replyError) => {
            console.error('[AUTH_MIDDLEWARE_REPLY_ERROR]', replyError);
          });
      }
    }
  };
}

module.exports = { createAuthMiddleware };
