const assert = require('assert');
const whitelist = require('../lib/whitelist');

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

function runAll() {
  testListAliases();
  testGetCommands_noArg();
  testGetCommands_withApp();
  console.log('All whitelist tests passed');
}

runAll();
