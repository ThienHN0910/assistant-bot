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

  // Cấu hình Web Sandbox & Deploy
  const baseDomain = (process.env.BASE_DOMAIN || 'thienhn.io.vn').trim().toLowerCase();
  const webDeployDir = toAbsolutePath(process.env.WEB_DEPLOY_DIR || '/home/hnt/web');
  const uploadDir = toAbsolutePath(process.env.UPLOAD_DIR || '/home/hnt/uploads');
  const webPortStart = Number(process.env.WEB_PORT_START) || 8081;

  return {
    botToken,
    authorizedTelegramId,
    timezone,
    notesFilePath,
    pm2ErrorLogPath,
    baseDomain,
    webDeployDir,
    uploadDir,
    webPortStart,
  };
}

module.exports = { getConfig };
