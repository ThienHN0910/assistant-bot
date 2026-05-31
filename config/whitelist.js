module.exports = {
  aliases: {
    'git-status': {
      description: 'git status',
      steps: [ { cmd: 'git', args: ['status'] } ],
    },
    'git-pull': {
      description: 'git pull origin main',
      steps: [ { cmd: 'git', args: ['pull', 'origin', 'main'] } ],
    },
    'npm-install': {
      description: 'npm install',
      steps: [ { cmd: 'npm', args: ['install'] } ],
    },
    'npm-build': {
      description: 'npm run build',
      steps: [ { cmd: 'npm', args: ['run', 'build'] } ],
    },
    deploy: {
      description: 'Pull, install, build and restart processes',
      steps: [
        { cmd: 'git', args: ['pull', 'origin', 'main'] },
        { cmd: 'npm', args: ['install'] },
        { cmd: 'npm', args: ['run', 'build'] },
        { cmd: 'pm2', args: ['restart', 'all'] },
      ],
    },
    'nginx-test': {
      description: 'sudo nginx -t',
      steps: [ { cmd: 'sudo', args: ['nginx', '-t'], requiresSudo: true } ],
    },
    'nginx-reload': {
      description: 'sudo systemctl reload nginx',
      steps: [ { cmd: 'sudo', args: ['systemctl', 'reload', 'nginx'], requiresSudo: true } ],
    },
    'nginx-status': {
      description: 'sudo systemctl status nginx',
      steps: [ { cmd: 'sudo', args: ['systemctl', 'status', 'nginx'], requiresSudo: true } ],
    },
    'pm2-list': {
      description: 'pm2 list',
      steps: [ { cmd: 'pm2', args: ['list'] } ],
    },
    'pm2-restart': {
      description: 'pm2 restart <app>',
      steps: [ { cmd: 'pm2', args: ['restart', '<app>'], requiresArg: true, argName: 'app' } ],
    },
  },

  // Example whitelist of allowed pm2 apps. Adjust to suit your environment.
  allowedApps: [ 'assistant-bot', 'app', 'server', 'worker' ],
};
