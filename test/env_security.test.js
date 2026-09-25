const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const child = spawnSync(process.execPath, ['-e', "const c = require('./config/env').getConfig(); process.stdout.write(JSON.stringify({ secret: c.sessionSecret, origin: c.dashboardAllowedOrigin, web: c.webDeployDir, uploads: c.uploadDir }));"], {
  cwd: root,
  env: {
    BOT_TOKEN: 'dummy-bot-token',
    AUTHORIZED_TELEGRAM_ID: '12345',
    PM2_ERROR_LOG_PATH: './dummy.log',
    DASHBOARD_ALLOWED_ORIGIN: 'https://dashboard.example.invalid',
    DOTENV_CONFIG_QUIET: 'true',
  },
  encoding: 'utf8',
});

assert.strictEqual(child.status, 0, child.stderr);
const config = JSON.parse(child.stdout);
assert.strictEqual(config.secret, '', 'Missing SESSION_SECRET must not use a built-in fallback');
assert.strictEqual(config.origin, 'https://dashboard.example.invalid');
assert.strictEqual(config.web, path.resolve(root, 'data/web'));
assert.strictEqual(config.uploads, path.resolve(root, 'data/uploads'));
console.log('dashboard environment has no default session secret');
