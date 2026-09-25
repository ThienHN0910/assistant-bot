module.exports = {
  aliases: {
    'git-status': {
      description: 'Show Git status',
      steps: [{ cmd: 'git', args: ['status'] }],
    },
    'nginx-test': {
      description: 'Validate Nginx configuration',
      steps: [{ cmd: 'sudo', args: ['nginx', '-t'] }],
    },
    'nginx-status': {
      description: 'Show Nginx service status',
      steps: [{ cmd: 'sudo', args: ['systemctl', 'status', 'nginx'] }],
    },
    'pm2-list': {
      description: 'List PM2 applications',
      steps: [{ cmd: 'pm2', args: ['list'] }],
    },
    'pm2-restart': {
      description: 'Restart an approved PM2 application',
      argName: 'app',
      steps: [{ cmd: 'pm2', args: ['restart', '<app>'] }],
    },
  },
  allowedApps: ['assistant-bot', 'app', 'server', 'worker'],
};
