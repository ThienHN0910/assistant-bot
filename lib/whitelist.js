const cfg = require('../config/whitelist');

function listAliases() {
  return Object.keys(cfg.aliases);
}

function getCommands(alias, providedArgs = []) {
  if (!alias) throw new Error('Missing alias');
  const key = String(alias).trim();
  const entry = cfg.aliases[key];
  if (!entry) throw new Error(`Unknown alias: ${key}`);

  const steps = entry.steps.map((step) => {
    const s = Object.assign({}, step);

    if (s.requiresArg) {
      const val = providedArgs[0];
      if (!val) throw new Error(`Missing argument for ${key}: ${s.argName || 'arg'}`);
      if (s.argName === 'app') {
        if (!cfg.allowedApps.includes(val)) {
          throw new Error(`App not allowed: ${val}`);
        }
      }
      s.args = (s.args || []).map((a) => (a === `<${s.argName}>` ? val : a));
    }

    return s;
  });

  return steps;
}

module.exports = {
  listAliases,
  getCommands,
};
