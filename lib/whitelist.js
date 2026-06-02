const cfg = require('../config/whitelist');

function listAliases() {
  return Object.keys(cfg.aliases);
}

function replacePlaceholders(argsArr, replacements) {
  return (argsArr || []).map((a) => {
    let out = a;
    for (const [k, v] of Object.entries(replacements)) {
      out = out.split(`<${k}>`).join(v);
    }
    return out;
  });
}

function getCommands(alias, providedArgs = []) {
  if (!alias) throw new Error('Missing alias');
  const key = String(alias).trim();
  const entry = cfg.aliases[key];
  if (!entry) throw new Error(`Unknown alias: ${key}`);

  const steps = entry.steps.map((step) => {
    const s = Object.assign({}, step);

    if (s.requiresArg) {
      // support single argName or multiple argNames
      if (Array.isArray(s.argNames) && s.argNames.length) {
        if (providedArgs.length < s.argNames.length) {
          throw new Error(`Missing arguments for ${key}: expected ${s.argNames.join(', ')}`);
        }

        const replacements = {};
        s.argNames.forEach((name, idx) => {
          const val = providedArgs[idx];
          if (!val) throw new Error(`Missing value for ${name}`);
          if (name === 'app' && !cfg.allowedApps.includes(val)) {
            throw new Error(`App not allowed: ${val}`);
          }
          replacements[name] = val;
        });

        s.args = replacePlaceholders(s.args, replacements);
      } else {
        const argName = s.argName || 'arg';
        const val = providedArgs[0];
        if (!val) throw new Error(`Missing argument for ${key}: ${argName}`);
        if (argName === 'app' && !cfg.allowedApps.includes(val)) {
          throw new Error(`App not allowed: ${val}`);
        }
        const replacements = {};
        replacements[argName] = val;
        s.args = replacePlaceholders(s.args, replacements);
      }
    } else {
      // also support steps containing placeholders with no requiresArg flag
      // replace any <name> occurrences with providedArgs in order if argNames present
      if (Array.isArray(s.argNames) && s.argNames.length) {
        if (providedArgs.length < s.argNames.length) {
          throw new Error(`Missing arguments for ${key}: expected ${s.argNames.join(', ')}`);
        }
        const replacements = {};
        s.argNames.forEach((name, idx) => { replacements[name] = providedArgs[idx]; });
        s.args = replacePlaceholders(s.args, replacements);
      }
    }

    return s;
  });

  return steps;
}

module.exports = {
  listAliases,
  getCommands,
};
