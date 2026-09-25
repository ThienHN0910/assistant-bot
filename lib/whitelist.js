const cfg = require('../config/whitelist');

const shellExecutables = new Set(['bash', 'sh', 'cmd', 'powershell', 'pwsh']);

function listAliases() {
  return Object.keys(cfg.aliases);
}

function getCommands(alias, providedArgs = []) {
  if (!alias) throw new Error('Missing alias');
  const key = String(alias).trim();
  const entry = cfg.aliases[key];
  if (!entry) throw new Error(`Unknown alias: ${key}`);

  const expected = entry.argName ? 1 : 0;
  if (providedArgs.length !== expected) throw new Error(`Expected ${expected} argument(s)`);
  if (entry.argName === 'app' && !cfg.allowedApps.includes(providedArgs[0])) {
    throw new Error(`App not allowed: ${providedArgs[0]}`);
  }

  return entry.steps.map((step) => {
    if (shellExecutables.has(step.cmd.toLowerCase())) {
      throw new Error(`Shell interpreter is not allowed: ${step.cmd}`);
    }
    if (step.cmd === 'sudo' && !['nginx', 'systemctl'].includes(step.args[0])) {
      throw new Error(`Unsupported privileged command: ${step.args[0]}`);
    }
    return {
      cmd: step.cmd,
      args: step.args.map((arg) => entry.argName ? arg.replaceAll(`<${entry.argName}>`, providedArgs[0]) : arg),
    };
  });
}

module.exports = { listAliases, getCommands };
