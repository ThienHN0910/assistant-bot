module.exports = {
  aliases: {
    'uptime': {
      description: 'Xem thời gian hoạt động và tải của máy chủ',
      steps: [{ cmd: 'uptime', args: [] }],
    },
    'disk-usage': {
      description: 'Kiểm tra dung lượng và phân vùng ổ đĩa',
      steps: [{ cmd: 'df', args: ['-h'] }],
    },
    'mem-check': {
      description: 'Kiểm tra dung lượng bộ nhớ RAM & Swap',
      steps: [{ cmd: 'free', args: ['-h'] }],
    },
    'cpu-info': {
      description: 'Xem thông số vi xử lý CPU và kiến trúc',
      steps: [{ cmd: 'lscpu', args: [] }],
    },
    'top-procs': {
      description: 'Xem danh sách tiến trình tiêu thụ RAM hàng đầu',
      steps: [{ cmd: 'ps', args: ['aux', '--sort=-%mem'] }],
    },
    'os-release': {
      description: 'Xem thông tin hệ điều hành Linux',
      steps: [{ cmd: 'cat', args: ['/etc/os-release'] }],
    },
    'netstat-listen': {
      description: 'Xem các cổng mạng TCP/UDP đang lắng nghe',
      steps: [{ cmd: 'ss', args: ['-tuln'] }],
    },
    'git-status': {
      description: 'Kiểm tra trạng thái Git repository',
      steps: [{ cmd: 'git', args: ['status'] }],
    },
    'git-log': {
      description: 'Xem 5 commit gần nhất của mã nguồn',
      steps: [{ cmd: 'git', args: ['log', '--oneline', '-5'] }],
    },
    'nginx-test': {
      description: 'Kiểm tra cú pháp cấu hình Nginx',
      steps: [{ cmd: 'sudo', args: ['nginx', '-t'] }],
    },
    'nginx-status': {
      description: 'Xem trạng thái hoạt động của Nginx',
      steps: [{ cmd: 'sudo', args: ['systemctl', 'status', 'nginx'] }],
    },
    'pm2-list': {
      description: 'Danh sách các tiến trình ứng dụng PM2',
      steps: [{ cmd: 'pm2', args: ['list'] }],
    },
    'pm2-status': {
      description: 'Trạng thái chi tiết của tiến trình PM2',
      steps: [{ cmd: 'pm2', args: ['status'] }],
    },
    'pm2-restart': {
      description: 'Khởi động lại một tiến trình PM2 được chỉ định',
      argName: 'app',
      steps: [{ cmd: 'pm2', args: ['restart', '<app>'] }],
    },
    'pm2-logs': {
      description: 'Xem 30 dòng nhật ký gần nhất của ứng dụng PM2',
      argName: 'app',
      steps: [{ cmd: 'pm2', args: ['logs', '<app>', '--lines', '30', '--nostream'] }],
    },
  },
  allowedApps: ['assistant-bot', 'app', 'server', 'worker', 'all'],
};
