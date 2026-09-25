module.exports = {
  aliases: {
    'git-status': {
      description: 'git status',
      steps: [{ cmd: 'git', args: ['status'] }],
    },
    'git-pull': {
      description: 'git pull origin main',
      steps: [{ cmd: 'git', args: ['pull', 'origin', 'main'] }],
    },
    'npm-install': {
      description: 'npm install',
      steps: [{ cmd: 'npm', args: ['install'] }],
    },
    'npm-build': {
      description: 'npm run build',
      steps: [{ cmd: 'npm', args: ['run', 'build'] }],
    },
    update: {
      description: 'Pull and install bot updates',
      steps: [
        { cmd: 'git', args: ['pull', 'origin', 'main'] },
        { cmd: 'npm', args: ['install'] },
      ],
    },
    'nginx-test': {
      description: 'Check Nginx syntax',
      steps: [{ cmd: 'sudo', args: ['nginx', '-t'] }],
    },
    'nginx-reload': {
      description: 'Reload Nginx',
      steps: [{ cmd: 'sudo', args: ['systemctl', 'reload', 'nginx'] }],
    },
    'nginx-status': {
      description: 'Show Nginx status',
      steps: [{ cmd: 'sudo', args: ['systemctl', 'status', 'nginx'] }],
    },
    'pm2-list': {
      description: 'List PM2 apps',
      steps: [{ cmd: 'pm2', args: ['list'] }],
    },
    'pm2-restart': {
      description: 'Restart an allowed PM2 app',
      steps: [{ cmd: 'pm2', args: ['restart', '<app>'], requiresArg: true, argName: 'app' }],
    },
  },
  allowedApps: ['assistant-bot', 'app', 'server', 'worker'],
};
