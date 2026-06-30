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
    update: {
      description: 'Pull and install updates for the bot',
      steps: [
        { cmd: 'git', args: ['pull', 'origin', 'main'] },
        { cmd: 'npm', args: ['install'] },
      ],
    },
    'deploy-web': {
      description: 'Deploy static web (all-in-one step): deploy-web <project> <zip> <server>',
      steps: [
        {
          cmd: 'bash',
          args: ['./scripts/deploy-web.sh', '<project>', '<zip>', '<server>'],
          requiresArg: true,
          argNames: ['project', 'zip', 'server'],
        },
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
    // Filesystem & deploy helpers
    'mkdir-project': {
      description: 'mkdir -p /home/hnt/web/<project>',
      steps: [ { cmd: 'mkdir', args: ['-p', '/home/hnt/web/<project>'], requiresArg: true, argName: 'project' } ],
    },
    'mv-zip': {
      description: 'mv /home/hnt/<zip> /home/hnt/web/<project>',
      steps: [ { cmd: 'mv', args: ['/home/hnt/<zip>', '/home/hnt/web/<project>'], requiresArg: true, argNames: ['zip', 'project'] } ],
    },
    'extract-deploy': {
      description: 'cd /home/hnt/web/<project> && rm -rf dist && unzip -o <zip> && rm -f <zip>',
      steps: [ { cmd: 'bash', args: ['-lc', 'cd /home/hnt/web/<project> && rm -rf dist && unzip -o <zip> && rm -f <zip>'], requiresArg: true, argNames: ['project','zip'] } ],
    },
    'chmod-nginx': {
      description: 'chmod hygeine for nginx',
      steps: [
        { cmd: 'sudo', args: ['chmod', '+x', '/home/hnt'] },
        { cmd: 'sudo', args: ['chmod', '+x', '/home/hnt/web'] },
        { cmd: 'sudo', args: ['chmod', '-R', '755', '/home/hnt/web/<project>'], requiresArg: true, argName: 'project' },
      ],
    },
    'nginx-link': {
      description: 'ln -s /etc/nginx/sites-available/<site> /etc/nginx/sites-enabled/',
      steps: [ { cmd: 'sudo', args: ['ln', '-s', '/etc/nginx/sites-available/<site>', '/etc/nginx/sites-enabled/'], requiresArg: true, argName: 'site' } ],
    },
    'nginx-create': {
      description: 'Create nginx site file from template',
      steps: [
        {
          cmd: 'sudo',
          args: ['bash', '-c', "cat <<'EOF' > /etc/nginx/sites-available/<site>\nserver {\n    listen 80;\n    server_name <server>;\n\n    root <root>;\n    index index.html;\n\n    location / {\n        try_files $uri $uri/ /index.html;\n    }\n\n    gzip on;\n    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;\n}\nEOF"],
          requiresArg: true,
          argNames: ['site','server','root'],
        },
      ],
    },
    // Basic file operations moved from individual commands into sh whitelist
    'ls': {
      description: 'List directory contents: ls -la <path>',
      steps: [ { cmd: 'bash', args: ['-lc', 'ls -la "<path>"'] , requiresArg: true, argName: 'path' } ],
    },
    'cd': {
      description: 'Change directory (temporary) and show pwd + listing',
      steps: [ { cmd: 'bash', args: ['-lc', 'cd "<path>" && pwd && ls -la'] , requiresArg: true, argName: 'path' } ],
    },
    'cat': {
      description: 'Show file content (truncated): cat <file>',
      steps: [ { cmd: 'bash', args: ['-lc', 'head -c 65536 "<file>"'] , requiresArg: true, argName: 'file' } ],
    },
  },

  // Example whitelist of allowed pm2 apps. Adjust to suit your environment.
  allowedApps: [ 'assistant-bot', 'app', 'server', 'worker' ],
};
