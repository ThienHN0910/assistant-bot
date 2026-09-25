const assert = require('assert');
const updateCommand = require('../commands/update');

async function testUpdateCommand() {
  // 1. Test help argument
  let helpMsg = '';
  const mockHelpCtx = {
    message: { text: '/update -h' },
    replyWithHTML: async (html) => {
      helpMsg = html;
    },
  };
  await updateCommand.execute(mockHelpCtx);
  assert(helpMsg.includes('Hướng dẫn lệnh /update'), 'Should reply with help message');
  console.log('✅ update command help test passed');

  // 2. Test successful update execution with fallback steps
  const replies = [];
  let pm2Restarted = false;
  const mockCtx = {
    message: { text: '/update' },
    replyWithHTML: async (html) => {
      replies.push(html);
    },
  };

  const executedCommands = [];
  const mockRunner = {
    runSequence: async (commands) => {
      executedCommands.push(...commands);
      return commands.map((c) => ({
        cmd: c.cmd,
        args: c.args,
        ok: true,
        stdout: 'Already up to date.',
        stderr: '',
        code: 0,
      }));
    },
  };

  const mockExec = (cmd, cb) => {
    if (cmd.includes('pm2 restart')) {
      pm2Restarted = true;
    }
    if (typeof cb === 'function') cb(null);
  };

  await updateCommand.execute(mockCtx, {}, {
    runner: mockRunner,
    exec: mockExec,
    restartDelay: 10,
  });

  assert(replies.some((r) => r.includes('Bắt đầu quá trình Cập nhật')), 'Should notify start of update');
  assert(replies.some((r) => r.includes('Hoàn thành Cập nhật')), 'Should notify completion');
  assert.strictEqual(executedCommands.length, 2, 'Should execute 2 default update commands');
  assert.strictEqual(executedCommands[0].cmd, 'git');
  assert.strictEqual(executedCommands[1].cmd, 'npm');

  // Wait for restart timer
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(pm2Restarted, true, 'PM2 restart must be triggered after successful update');
  console.log('✅ update command execution and pm2 restart test passed');
}

testUpdateCommand().catch((err) => {
  console.error('Update command test failed:', err);
  process.exit(1);
});
