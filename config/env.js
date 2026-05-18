const path = require('path');
const dotenv = require('dotenv');

// Nạp biến môi trường từ file .env ở thư mục gốc dự án.
dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  }
  return value.trim();
}

function toAbsolutePath(filePath) {
  if (!filePath) return filePath;
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

function getConfig() {
  const botToken = requireEnv('BOT_TOKEN');
  const authorizedIdRaw = requireEnv('AUTHORIZED_TELEGRAM_ID');
  const authorizedTelegramId = Number(authorizedIdRaw);

  if (!Number.isInteger(authorizedTelegramId) || authorizedTelegramId <= 0) {
    throw new Error('AUTHORIZED_TELEGRAM_ID phải là số nguyên dương hợp lệ');
  }

  const timezone = (process.env.TIMEZONE || 'Asia/Ho_Chi_Minh').trim();
  const notesFilePath = toAbsolutePath(process.env.NOTES_FILE_PATH || './notes.txt');
  const pm2ErrorLogPath = toAbsolutePath(requireEnv('PM2_ERROR_LOG_PATH'));

  return {
    botToken,
    authorizedTelegramId,
    timezone,
    notesFilePath,
    pm2ErrorLogPath,
  };
}

module.exports = { getConfig };
