const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const isolatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-bot-env-test-'));
const envModule = path.join(root, 'config/env.js');
const code = `const c = require(${JSON.stringify(envModule)}).getConfig(); process.stdout.write(JSON.stringify({ hasSessionSecret: Boolean(c.sessionSecret), origin: c.dashboardAllowedOrigin, web: c.webDeployDir, uploads: c.uploadDir }));`;

try {
  const child = spawnSync(process.execPath, ['-e', code], {
    cwd: isolatedCwd,
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
  assert.strictEqual(config.hasSessionSecret, false, 'Missing SESSION_SECRET must not use a built-in fallback');
  assert.strictEqual(config.origin, 'https://dashboard.example.invalid');
  assert.strictEqual(config.web, path.resolve(isolatedCwd, 'data/web'));
  assert.strictEqual(config.uploads, path.resolve(isolatedCwd, 'data/uploads'));
  console.log('dashboard environment has no default session secret');
} finally {
  fs.rmdirSync(isolatedCwd);
}
