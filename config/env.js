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
  const webDeployDir = toAbsolutePath(process.env.WEB_DEPLOY_DIR || './data/web');
  const uploadDir = toAbsolutePath(process.env.UPLOAD_DIR || './data/uploads');
  const webPortStart = Number(process.env.WEB_PORT_START) || 8081;

  // Cấu hình Cloudflare DNS API (Tùy chọn)
  const cloudflareApiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const cloudflareZoneId = (process.env.CLOUDFLARE_ZONE_ID || '').trim();

  // Cấu hình Vercel & Render (Tùy chọn)
  const vercelToken = (process.env.VERCEL_TOKEN || '').trim();
  const renderApiKey = (process.env.RENDER_API_KEY || '').trim();
  const renderOwnerId = (process.env.RENDER_OWNER_ID || '').trim();
  const deployRegistryPath = toAbsolutePath(process.env.DEPLOY_REGISTRY_PATH || './data/deployments.json');
  // Cấu hình Web Dashboard (Đăng nhập Google OAuth 2.0 độc quyền)
  const googleClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const authorizedGoogleEmail = (process.env.AUTHORIZED_GOOGLE_EMAIL || '').trim().toLowerCase();
  const sessionSecret = (process.env.SESSION_SECRET || '').trim();
  const dashboardAllowedOrigin = (process.env.DASHBOARD_ALLOWED_ORIGIN || '').trim();
  const dashboardPort = Number(process.env.DASHBOARD_PORT) || 3001;

  // IP Public của VPS (Tùy chọn, nếu không điền bot sẽ tự động nhận diện)
  const vpsPublicIp = (process.env.VPS_PUBLIC_IP || '').trim();

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
    vpsPublicIp,
    cloudflareApiToken,
    cloudflareZoneId,
    vercelToken,
    renderApiKey,
    renderOwnerId,
    deployRegistryPath,
    googleClientId,
    authorizedGoogleEmail,
    sessionSecret,
    dashboardAllowedOrigin,
    dashboardPort,
  };
}

module.exports = { getConfig };
