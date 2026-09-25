const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const code = "const store = require('./lib/deployStore'); store.setPending('p', {}); store.setAwaitingSubdomain('u', 'p');";
const child = spawnSync(process.execPath, ['-e', code], {
  cwd: root,
  timeout: 1500,
  encoding: 'utf8',
});

assert.strictEqual(child.status, 0, `expiry timers kept Node alive: ${child.error?.code || child.stderr}`);
console.log('deployStore timers allow process exit');
