const assert = require('assert');
const whitelist = require('../lib/whitelist');
const config = require('../config/whitelist');

function testListAliases() {
  const aliases = whitelist.listAliases();
  assert(Array.isArray(aliases), 'listAliases should return an array');
  assert(aliases.length > 0, 'there should be at least one alias');
}

function testGetCommands_noArg() {
  const cmds = whitelist.getCommands('git-status');
  assert(Array.isArray(cmds));
  assert(cmds.length === 1);
  assert(cmds[0].cmd === 'git');
}

function testGetCommands_withApp() {
  const entry = whitelist.getCommands('pm2-restart', ['assistant-bot']);
  assert(Array.isArray(entry));
  const step = entry[0];
  assert(step.cmd === 'pm2');
  assert(step.args.includes('assistant-bot'));
}

function testNoShellInterpolatedAliases() {
  for (const alias of ['ls', 'cd', 'cat', 'extract-deploy', 'nginx-create', 'deploy-web', 'mkdir-project', 'mv-zip', 'chmod-nginx', 'nginx-link', 'git-pull', 'npm-install', 'npm-build', 'update', 'nginx-reload']) {
    assert.throws(() => whitelist.getCommands(alias, ['x']), /Unknown alias/);
  }
  assert.throws(() => whitelist.getCommands('pm2-restart', ['assistant-bot', 'extra']), /argument/i);
  assert.throws(() => whitelist.getCommands('pm2-restart', ['app;id']), /App not allowed/);
  assert.throws(() => whitelist.getCommands('git-status', ['extra']), /argument/i);
  for (const alias of whitelist.listAliases()) {
    const args = config.aliases[alias]?.argName ? ['assistant-bot'] : [];
    for (const step of whitelist.getCommands(alias, args)) {
      assert(!['bash', 'sh', 'cmd', 'powershell'].includes(step.cmd.toLowerCase()));
    }
  }
  config.aliases.unsafeNestedShell = { steps: [{ cmd: 'sudo', args: ['bash', '-c', 'id'] }] };
  try {
    assert.throws(() => whitelist.getCommands('unsafeNestedShell'), /shell|command/i);
  } finally {
    delete config.aliases.unsafeNestedShell;
  }
}

function runAll() {
  testListAliases();
  testGetCommands_noArg();
  testGetCommands_withApp();
  testNoShellInterpolatedAliases();
  console.log('All whitelist tests passed');
}

runAll();
