function createAuthMiddleware(config) {
  return async (ctx, next) => {
    try {
      const senderId = ctx.from?.id;
      
      // FIX lỗi ép kiểu: Chuyển senderId thành String để so sánh chuẩn xác với .env
      if (String(senderId) !== String(config.authorizedTelegramId)) {
        const deniedMessage =
          '🚫 <b>Cảnh báo bảo mật</b>\n\n' +
          'Bạn không có quyền sử dụng bot này.';

        if (typeof ctx.reply === 'function') {
          await ctx.reply(deniedMessage, { parse_mode: 'HTML' });
        }

        console.warn(`[SECURITY] Từ chối truy cập từ Telegram ID: ${senderId ?? 'unknown'}`);
        return;
      }

      await next();
    } catch (error) {
      console.error('[AUTH_MIDDLEWARE_ERROR]', error);
      if (typeof ctx.reply === 'function') {
        await ctx.reply('⚠️ Có lỗi khi kiểm tra quyền truy cập.', { parse_mode: 'HTML' })
          .catch((replyError) => console.error('[AUTH_MIDDLEWARE_REPLY_ERROR]', replyError));
      }
    }
  };
}

module.exports = { createAuthMiddleware };