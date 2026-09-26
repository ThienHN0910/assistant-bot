const { createApp, ref, computed, onMounted } = Vue;

    createApp({
      setup() {
        const token = ref(localStorage.getItem('dashboard_session') || '');
        const user = ref(JSON.parse(localStorage.getItem('dashboard_user') || 'null'));
        const isAuthenticated = ref(false);
        const googleClientId = ref('');
        const authError = ref('');
        const loadingAuth = ref(false);
        const showLoginModal = ref(false);

        // Navigation state: 'showcase' (Guest Landing Page) or 'dashboard' (Management Console)
        const currentTab = ref('showcase');
        const dashTab = ref('telemetry'); // 'telemetry' | 'deployments' | 'commands'

        // Dashboard Data
        const system = ref(null);
        const clusterNodes = ref([]);
        const nodes = ref([]);
        const deployments = ref([]);
        const refreshing = ref(false);
        const targetFilter = ref('all');
        const searchQuery = ref('');

        // Toast feedback
        const toast = ref({ show: false, message: '', type: 'success' });
        function showToast(message, type = 'success') {
          toast.value = { show: true, message, type };
          setTimeout(() => { toast.value.show = false; }, 4000);
        }

        // Copy feedback
        const copiedCommand = ref('');
        function copyCommand(text) {
          navigator.clipboard.writeText(text);
          copiedCommand.value = text;
          showToast(`Đã sao chép lệnh: ${text}`);
          setTimeout(() => { copiedCommand.value = ''; }, 2500);
        }

        // =====================================================================
        // TELEGRAM COMMANDS CATALOG (16 Commands)
        // =====================================================================
        const commandCategories = [
          { id: 'all', name: 'Tất cả' },
          { id: 'vps', name: '🖥️ Quản trị VPS' },
          { id: 'deploy', name: '🚀 Triển khai Web' },
          { id: 'perf', name: '⚡ Hiệu năng' },
          { id: 'system', name: '⚙️ Hệ thống' },
        ];

        const selectedCategory = ref('all');
        const commandSearch = ref('');

        const commands = ref([
          {
            name: '/status',
            category: 'vps',
            badge: 'Giám sát VPS',
            badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
            description: 'Báo cáo thời gian thực về tài nguyên máy chủ: CPU (%), RAM (dùng/tổng), SWAP, Load Average và dung lượng đĩa trống.',
            syntax: '/status',
            sampleOutput: `📊 THÔNG TIN HỆ THỐNG
• OS: Linux (Ubuntu 22.04 LTS)
• Uptime: 18 ngày 4 giờ
• CPU Load: 2.8%
• RAM: 245 MB / 980 MB (25%)
• SWAP: 110 MB / 1024 MB
• Disk: 8.4 GB / 30 GB (28%)`,
            highlights: 'Đo lường trực tiếp qua /proc và os-utils, tiêu thụ 0MB RAM phụ trợ.',
            showPreview: false,
          },
          {
            name: '/deploy',
            category: 'deploy',
            badge: 'Triển khai Web',
            badgeColor: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
            description: 'Triển khai web tương tác 1 chạm: tự động quét file .zip trong thư mục upload hoặc tự bắt link GitHub. Hiển thị inline buttons chọn nền tảng.',
            syntax: '/deploy [file.zip] [vps|vercel]',
            sampleOutput: `🚀 DANH SÁCH FILE ZIP SẴN SÀNG DEPLOY
📦 portfolio.zip (1.2 MB)
📦 vue-dashboard.zip (450 KB)

[🖥️ VPS Nginx]  [▲ Vercel Cloud]`,
            highlights: 'Tự động cấu hình Nginx SSL hoặc Vercel Edge, đồng thời tạo bản ghi DNS Cloudflare tự động.',
            showPreview: false,
          },
          {
            name: '/perf',
            category: 'perf',
            badge: 'Hiệu năng',
            badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
            description: 'Đo độ trễ mạng tại chỗ qua curl -w (DNS Lookup, TCP Connect, TTFB, Total Duration) với 0MB RAM, kết hợp chấm điểm Google PageSpeed Insights Mobile từ xa.',
            syntax: '/perf <project | domain | url>',
            sampleOutput: `⚡ KẾT QUẢ ĐO HIỆU NĂNG: portfolio.thienhn.io.vn
• DNS Lookup: 12ms
• TCP Connect: 24ms
• TTFB: 85ms
• Total Time: 135ms
🚀 Google PageSpeed Score: 98/100 (Mobile)`,
            highlights: 'Phân rã chi tiết TTFB và gọi Google API không tốn 1MB RAM nào của VPS.',
            showPreview: false,
          },
          {
            name: '/ps',
            category: 'vps',
            badge: 'Giám sát VPS',
            badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
            description: 'Liệt kê Top 5 tiến trình đang tiêu thụ nhiều RAM và CPU nhất trên máy chủ. Giúp chẩn đoán ngay lập tức tiến trình gây nghẽn hoặc có nguy cơ OOM.',
            syntax: '/ps',
            sampleOutput: `🔥 TOP 5 TIẾN TRÌNH NGỐN TÀI NGUYÊN
1. node (PM2 assistant-bot) - 45.2 MB (4.6%) - CPU 0.8%
2. nginx: worker process - 18.4 MB (1.9%) - CPU 0.1%
3. systemd-resolved - 12.1 MB (1.2%) - CPU 0.0%
4. pm2 God Daemon - 32.0 MB (3.3%) - CPU 0.2%
5. sshd: hnt - 8.5 MB (0.9%) - CPU 0.0%`,
            highlights: 'Đọc bảng tiến trình qua ps aux có sanitize an toàn.',
            showPreview: false,
          },
          {
            name: '/logs',
            category: 'system',
            badge: 'Hệ thống',
            badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
            description: 'Đọc 20 dòng log lỗi PM2 gần nhất bằng cơ chế đọc ngược từ cuối file (OOM-Safe Tail). Miễn nhiễm OOM ngay cả khi file log nặng hàng gigabyte.',
            syntax: '/logs [số dòng]',
            sampleOutput: `📋 20 DÒNG LOG LỖI GẦN NHẤT
[2026-09-25 15:40:12] [PM2] App [assistant-bot:0] online
[2026-09-25 15:40:14] Dashboard API listening on localhost:3001
[2026-09-25 15:40:15] Bot Telegram polling started successfully`,
            highlights: 'Cơ chế readLastLines đọc buffer byte từ cuối file, tiêu thụ chính xác 0 MB RAM.',
            showPreview: false,
          },
          {
            name: '/update',
            category: 'system',
            badge: 'Hệ thống',
            badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
            description: 'Tự động cập nhật mã nguồn bot từ nhánh main của GitHub, tự động chạy npm install nếu dependencies đổi, kiểm tra cú pháp và khởi động lại PM2 với trần 200MB RAM.',
            syntax: '/update',
            sampleOutput: `🔄 ĐANG CẬP NHẬT MÃ NGUỒN BOT...
• Git Pull: Thành công (2 commit mới)
• Kiểm tra cú pháp: Hoàn tất 0 lỗi
• PM2 Restart: Đã kích hoạt với trần 200MB RAM!`,
            highlights: 'Tự động lên lịch hẹn giờ 1.5s gửi phản hồi trước khi reload PM2 an toàn.',
            showPreview: false,
          },
          {
            name: '/restart',
            category: 'system',
            badge: 'Hệ thống',
            badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
            description: 'Khởi động lại bot từ xa an toàn qua PM2 kèm tham số --update-env và trần bộ nhớ --max-memory-restart 200M.',
            syntax: '/restart',
            sampleOutput: `🔄 Đang khởi động lại tiến trình "assistant-bot"...
Vui lòng đợi vài giây để bot kết nối lại Telegram.`,
            highlights: 'Đảm bảo cờ trần RAM 200MB luôn được duy trì sau mỗi lần restart.',
            showPreview: false,
          },
          {
            name: '/web_list',
            category: 'deploy',
            badge: 'Triển khai Web',
            badgeColor: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
            description: 'Liệt kê danh sách tất cả các ứng dụng web và API đang hoạt động (trên VPS Nginx, Vercel Cloud hoặc Render), bao gồm URL HTTPS và dung lượng.',
            syntax: '/web_list',
            sampleOutput: `🌐 DANH SÁCH DỰ ÁN ĐANG CHẠY (VPS & CLOUD)

1. portfolio [Web Tĩnh] [VPS]
   • URL: https://portfolio.thienhn.io.vn
   • Dung lượng: 4.2 MB
   • Deploy: 25/09/2026
   • Thao tác nhanh: /perf portfolio | /web_remove portfolio`,
            highlights: 'Đồng bộ trực tiếp giữa thư mục VPS và Deployment Registry.',
            showPreview: false,
          },
          {
            name: '/web_remove',
            category: 'deploy',
            badge: 'Triển khai Web',
            badgeColor: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
            description: 'Gỡ bỏ hoàn toàn một ứng dụng đã triển khai: xóa thư mục mã nguồn trên VPS, dừng tiến trình PM2 (nếu là backend), xóa Nginx config và tự động thu hồi bản ghi DNS Cloudflare.',
            syntax: '/web_remove <tên_dự_án>',
            sampleOutput: `🗑️ ĐÃ GỠ BỎ THÀNH CÔNG DỰ ÁN: "portfolio"
• Thư mục mã nguồn: Đã dọn dẹp
• Cấu hình Nginx: Đã xóa và reload
• Cloudflare DNS: Đã thu hồi bản ghi A (portfolio.thienhn.io.vn)`,
            highlights: 'Dọn dẹp triệt để không để lại rác tài nguyên hay xung đột DNS.',
            showPreview: false,
          },
          {
            name: '/cleancache',
            category: 'vps',
            badge: 'Giám sát VPS',
            badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
            description: 'Xả sạch bộ nhớ đệm trang (PageCache, Dentries, Inodes) của hệ điều hành Linux và xóa sạch lịch sử log cũ của PM2 (pm2 flush).',
            syntax: '/cleancache',
            sampleOutput: `🧹 DỌN DẸP BỘ NHỚ HOÀN TẤT
• Đã xóa sạch log cũ PM2 (pm2 flush)
• Đã giải phóng 180 MB RAM PageCache
• Bộ nhớ khả dụng hiện tại: 785 MB`,
            highlights: 'Dùng lệnh echo 3 > /proc/sys/vm/drop_caches an toàn.',
            showPreview: false,
          },
          {
            name: '/uptime',
            category: 'vps',
            badge: 'Giám sát VPS',
            badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
            description: 'Hiển thị thời gian hoạt động liên tục của máy chủ VPS và thời điểm boot server gần nhất.',
            syntax: '/uptime',
            sampleOutput: `⏱️ THỜI GIAN HOẠT ĐỘNG
• Thời gian chạy: 18 ngày 4 giờ 22 phút
• Thời điểm boot: 07/09/2026 12:00:00`,
            highlights: 'Truy vấn trực tiếp từ /proc/uptime.',
            showPreview: false,
          },
          {
            name: '/ip',
            category: 'vps',
            badge: 'Giám sát VPS',
            badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
            description: 'Lấy địa chỉ IPv4 Public của máy chủ VPS phục vụ đối chiếu và cấu hình DNS.',
            syntax: '/ip',
            sampleOutput: `🌐 IP PUBLIC CỦA MÁY CHỦ:
34.124.xxx.xxx (Google Cloud Asia-Southeast1)`,
            highlights: 'Tự động kiểm tra qua ipify và ifconfig.me có cơ chế fallback.',
            showPreview: false,
          },
          {
            name: '/deploy_web',
            category: 'deploy',
            badge: 'Triển khai Web',
            badgeColor: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
            description: 'Lệnh alias triển khai nhanh file ZIP trực tiếp lên VPS Nginx.',
            syntax: '/deploy_web <tên_app> <file.zip>',
            sampleOutput: `🚀 Đang triển khai dự án "landing" lên VPS...
• Nền tảng: VPS (Nginx)
• Domain: landing.thienhn.io.vn`,
            highlights: 'Hỗ trợ triển khai nhanh khi đã biết rõ tên file.',
            showPreview: false,
          },
          {
            name: '/notes',
            category: 'system',
            badge: 'Hệ thống',
            badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
            description: 'Xem 10 ghi chú nhanh gần nhất đã lưu (gửi tin nhắn text thường bất kỳ không bắt đầu bằng / để lưu vào notes.txt), hoặc dùng /notes clear để dọn sạch.',
            syntax: '/notes [clear]',
            sampleOutput: `📝 DANH SÁCH GHI CHÚ GẦN NHẤT
1. [25/09 14:10] Nhớ test lại Google OAuth trên Dashboard
2. [25/09 15:20] Cấu hình CNAME Vercel cho subdomain test`,
            highlights: 'Gửi text thường bất kỳ để tự động ghi chú kèm mốc thời gian Asia/Ho_Chi_Minh.',
            showPreview: false,
          },
          {
            name: '/sh',
            category: 'system',
            badge: 'Hệ thống',
            badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
            description: 'Thực thi các lệnh shell hệ thống an toàn theo danh mục whitelist nghiêm ngặt (chặn command injection, giới hạn timeout và buffer).',
            syntax: '/sh <lệnh trong whitelist>',
            sampleOutput: `💻 KẾT QUẢ THỰC THI SHELL: "df -h"
Filesystem      Size  Used Avail Use% Mounted on
/dev/root        30G  8.4G   21G  29% /`,
            highlights: 'Chặn đứng mọi nguy cơ injection và kiểm soát quyền thực thi tuyệt đối.',
            showPreview: false,
          },
          {
            name: '/start',
            category: 'system',
            badge: 'Hệ thống',
            badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
            description: 'Hiển thị menu chào mừng, hướng dẫn chi tiết các nhóm lệnh và kích hoạt reply keyboard tiện ích.',
            syntax: '/start',
            sampleOutput: `👋 Chào mừng đến với Dev Assistant Bot!
🤖 Bot trợ lý cá nhân dành cho lập trình viên!
Sử dụng các nút bấm bên dưới hoặc gõ lệnh để thao tác.`,
            highlights: 'Điểm bắt đầu thân thiện cho người dùng trên Telegram.',
            showPreview: false,
          }
        ]);

        function getCategoryCount(catId) {
          if (catId === 'all') return commands.value.length;
          return commands.value.filter(c => c.category === catId).length;
        }

        const filteredCommands = computed(() => {
          return commands.value.filter(cmd => {
            const matchesCat = selectedCategory.value === 'all' || cmd.category === selectedCategory.value;
            const query = commandSearch.value.toLowerCase().trim();
            const matchesSearch = !query || 
              cmd.name.toLowerCase().includes(query) || 
              cmd.description.toLowerCase().includes(query) || 
              cmd.syntax.toLowerCase().includes(query);
            return matchesCat && matchesSearch;
          });
        });

        // =====================================================================
        // API REQUEST HELPER
        // =====================================================================
        async function apiRequest(path, options = {}) {
          const headers = {
            'Content-Type': 'application/json',
            ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}),
            ...(options.headers || {})
          };

          const res = await fetch(path, { ...options, headers });
          if (res.status === 401) {
            logout();
            throw new Error('Hết phiên làm việc hoặc chưa xác thực');
          }

          const rawText = await res.text();
          let data;
          try {
            data = JSON.parse(rawText);
          } catch (e) {
            if (!res.ok) {
              const cleanMsg = rawText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
              throw new Error(`Lỗi máy chủ (HTTP ${res.status}): ${cleanMsg || res.statusText || 'Phản hồi không hợp lệ'}`);
            }
            throw new Error(`Phản hồi không phải JSON: ${rawText.slice(0, 100)}`);
          }
          return data;
        }

        // =====================================================================
        // AUTHENTICATION (Google OAuth 2.0 GIS)
        // =====================================================================
        function openLoginModal() {
          showLoginModal.value = true;
          authError.value = '';
          initGoogleAuth();
        }

        async function initGoogleAuth() {
          try {
            const res = await fetch('/api/auth/config');
            const data = await res.json();
            if (data.ok && data.googleClientId) {
              googleClientId.value = data.googleClientId;

              const checkGsi = setInterval(() => {
                const btnContainer = document.getElementById('google-btn-container');
                if (window.google?.accounts?.id && btnContainer) {
                  clearInterval(checkGsi);
                  google.accounts.id.initialize({
                    client_id: data.googleClientId,
                    callback: handleGoogleCredentialResponse,
                    auto_select: false,
                  });
                  btnContainer.innerHTML = '';
                  google.accounts.id.renderButton(btnContainer, {
                    theme: 'outline',
                    size: 'large',
                    width: '280',
                    text: 'signin_with',
                    shape: 'pill',
                  });
                }
              }, 100);
            }
          } catch (err) {
            console.error('Lỗi khởi tạo cấu hình Google Auth:', err);
          }
        }

        async function handleGoogleCredentialResponse(response) {
          loadingAuth.value = true;
          authError.value = '';

          try {
            const res = await fetch('/api/auth/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ credential: response.credential }),
            });

            const data = await res.json();
            if (data.ok) {
              token.value = data.token;
              user.value = data.user;
              localStorage.setItem('dashboard_session', data.token);
              localStorage.setItem('dashboard_user', JSON.stringify(data.user));
              isAuthenticated.value = true;
              showLoginModal.value = false;
              currentTab.value = 'dashboard';
              showToast(`Chào mừng trở lại, ${data.user.name}!`);
              fetchData();
            } else {
              authError.value = data.error || 'Đăng nhập Google thất bại';
            }
          } catch (err) {
            authError.value = 'Lỗi kết nối tới máy chủ xác thực';
          } finally {
            loadingAuth.value = false;
          }
        }

        async function verifySession() {
          if (!token.value) {
            initGoogleAuth();
            return;
          }

          try {
            const res = await fetch('/api/auth/verify', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token.value}` },
            });
            const data = await res.json();
            if (data.ok && data.authenticated) {
              isAuthenticated.value = true;
              if (data.user) user.value = data.user;
              fetchData();
            } else {
              logout();
            }
          } catch {
            logout();
          }
        }

        function logout() {
          token.value = '';
          user.value = null;
          localStorage.removeItem('dashboard_session');
          localStorage.removeItem('dashboard_user');
          isAuthenticated.value = false;
          currentTab.value = 'showcase';
          showToast('Đã đăng xuất khỏi Dashboard.');
          initGoogleAuth();
        }

        // =====================================================================
        // DASHBOARD DATA FETCHING
        // =====================================================================
        async function fetchNodes() {
          try {
            const res = await fetch('/api/nodes').then((r) => r.json());
            if (res.ok && Array.isArray(res.nodes)) {
              nodes.value = res.nodes;
            }
          } catch {}
        }

        async function fetchData() {
          if (!isAuthenticated.value) return;
          refreshing.value = true;
          try {
            const [sysRes, depRes, nodesRes] = await Promise.all([
              apiRequest('/api/status').catch(() => null),
              apiRequest('/api/deployments').catch(() => null),
              fetch('/api/nodes').then((r) => r.json()).catch(() => null),
            ]);

            if (sysRes?.ok) {
              system.value = sysRes.system;
              if (Array.isArray(sysRes.nodes)) {
                clusterNodes.value = sysRes.nodes;
                setTimeout(() => updateCharts(sysRes.nodes), 50);
              }
            }
            if (depRes?.ok) deployments.value = depRes.deployments;
            if (nodesRes?.ok && Array.isArray(nodesRes.nodes)) {
              nodes.value = nodesRes.nodes;
            }
          } catch (err) {
            showToast(err.message, 'error');
          } finally {
            refreshing.value = false;
          }
        }

        // =====================================================================
        // REAL-TIME METRICS CHARTS (CHART.JS - NO ANIMATION)
        // =====================================================================
        let cpuChartInstance = null;
        let ramChartInstance = null;
        const chartTimestamps = ref([]);
        const chartHistory = {
          cpu: {},
          ram: {},
        };

        const NODE_COLORS = [
          { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)' },
          { border: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)' },
          { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
          { border: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)' },
        ];

        function updateCharts(nodesList) {
          if (!window.Chart || !nodesList || nodesList.length === 0) return;
          const cpuCanvas = document.getElementById('cpuChart');
          const ramCanvas = document.getElementById('ramChart');
          if (!cpuCanvas || !ramCanvas) return;

          const timeLabel = new Date().toLocaleTimeString('vi-VN', { hour12: false });
          chartTimestamps.value.push(timeLabel);
          if (chartTimestamps.value.length > 12) chartTimestamps.value.shift();

          nodesList.forEach((node) => {
            if (!chartHistory.cpu[node.id]) chartHistory.cpu[node.id] = [];
            if (!chartHistory.ram[node.id]) chartHistory.ram[node.id] = [];

            chartHistory.cpu[node.id].push(Number(node.cpuLoad) || 0);
            const ramPct = Number(node.memory?.usedPercentage) || 0;
            chartHistory.ram[node.id].push(ramPct);

            if (chartHistory.cpu[node.id].length > 12) chartHistory.cpu[node.id].shift();
            if (chartHistory.ram[node.id].length > 12) chartHistory.ram[node.id].shift();
          });

          const cpuDatasets = nodesList.map((node, i) => {
            const color = NODE_COLORS[i % NODE_COLORS.length];
            return {
              label: `${node.name} (%)`,
              data: [...(chartHistory.cpu[node.id] || [])],
              borderColor: color.border,
              backgroundColor: color.bg,
              fill: false,
              tension: 0.1,
              borderWidth: 2,
              pointRadius: 3,
            };
          });

          const ramDatasets = nodesList.map((node, i) => {
            const color = NODE_COLORS[i % NODE_COLORS.length];
            return {
              label: `${node.name} (%)`,
              data: [...(chartHistory.ram[node.id] || [])],
              borderColor: color.border,
              backgroundColor: color.bg,
              fill: false,
              tension: 0.1,
              borderWidth: 2,
              pointRadius: 3,
            };
          });

          const chartOptions = {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                min: 0,
                max: 100,
                ticks: { color: '#94a3b8', font: { family: 'monospace', size: 10 } },
                grid: { color: 'rgba(51, 65, 85, 0.3)' },
              },
              x: {
                ticks: { color: '#94a3b8', font: { family: 'monospace', size: 10 } },
                grid: { color: 'rgba(51, 65, 85, 0.2)' },
              },
            },
            plugins: {
              legend: {
                labels: { color: '#cbd5e1', font: { size: 11 } },
              },
            },
          };

          if (cpuChartInstance) {
            cpuChartInstance.data.labels = [...chartTimestamps.value];
            cpuChartInstance.data.datasets = cpuDatasets;
            cpuChartInstance.update('none');
          } else {
            cpuChartInstance = new window.Chart(cpuCanvas, {
              type: 'line',
              data: { labels: [...chartTimestamps.value], datasets: cpuDatasets },
              options: chartOptions,
            });
          }

          if (ramChartInstance) {
            ramChartInstance.data.labels = [...chartTimestamps.value];
            ramChartInstance.data.datasets = ramDatasets;
            ramChartInstance.update('none');
          } else {
            ramChartInstance = new window.Chart(ramCanvas, {
              type: 'line',
              data: { labels: [...chartTimestamps.value], datasets: ramDatasets },
              options: chartOptions,
            });
          }
        }

        // Processes Modal (/ps)
        const showProcessesModal = ref(false);
        const loadingProcesses = ref(false);
        const processesSelectedNode = ref('gcp-master');
        const processesList = ref([]);

        async function openProcessesModal(nodeId = 'gcp-master') {
          processesSelectedNode.value = nodeId;
          showProcessesModal.value = true;
          await fetchProcesses();
        }

        async function fetchProcesses() {
          loadingProcesses.value = true;
          try {
            const res = await apiRequest(`/api/processes?nodeId=${processesSelectedNode.value}`);
            if (res.ok) {
              processesList.value = res.processes || [];
            } else {
              showToast(res.error || 'Lỗi tải tiến trình', 'error');
            }
          } catch (err) {
            showToast(err.message, 'error');
          } finally {
            loadingProcesses.value = false;
          }
        }

        // PM2 Logs Modal (/logs)
        const showLogsModal = ref(false);
        const loadingLogs = ref(false);
        const logsSelectedNode = ref('gcp-master');
        const logsLines = ref(20);
        const logsContent = ref('');

        async function openLogsModal(nodeId = 'gcp-master') {
          logsSelectedNode.value = nodeId;
          showLogsModal.value = true;
          await fetchLogs();
        }

        async function fetchLogs() {
          loadingLogs.value = true;
          try {
            const res = await apiRequest(`/api/logs?nodeId=${logsSelectedNode.value}&lines=${logsLines.value}`);
            if (res.ok) {
              logsContent.value = res.logs || 'Không có log lỗi.';
            } else {
              showToast(res.error || 'Lỗi tải log', 'error');
            }
          } catch (err) {
            showToast(err.message, 'error');
          } finally {
            loadingLogs.value = false;
          }
        }

        // Perf Modal (/perf)
        const showPerfModal = ref(false);
        const loadingPerf = ref(false);
        const perfTarget = ref('');
        const perfResult = ref(null);

        async function openPerfModal(dep) {
          perfTarget.value = dep.name || dep.url;
          perfResult.value = null;
          showPerfModal.value = true;
          loadingPerf.value = true;
          try {
            const res = await apiRequest('/api/perf', {
              method: 'POST',
              body: JSON.stringify({ target: dep.name || dep.url }),
            });
            if (res.ok) {
              perfResult.value = res.result;
            } else {
              showToast(res.error || 'Lỗi đo hiệu năng', 'error');
            }
          } catch (err) {
            showToast(err.message, 'error');
          } finally {
            loadingPerf.value = false;
          }
        }

        // Undeploy Modal (/web_remove)
        const showUndeployModal = ref(false);
        const executingUndeploy = ref(false);
        const undeployTargetName = ref('');

        function confirmUndeploy(name) {
          undeployTargetName.value = name;
          showUndeployModal.value = true;
        }

        async function executeUndeploy() {
          if (!undeployTargetName.value) return;
          executingUndeploy.value = true;
          try {
            const res = await apiRequest('/api/deployments/undeploy', {
              method: 'POST',
              body: JSON.stringify({ name: undeployTargetName.value })
            });

            if (res.ok) {
              showToast(`Đã gỡ bỏ thành công dự án "${undeployTargetName.value}"`);
              showUndeployModal.value = false;
              fetchData();
            } else {
              showToast(res.error || 'Lỗi khi gỡ bỏ dự án', 'error');
            }
          } catch (err) {
            showToast(err.message, 'error');
          } finally {
            executingUndeploy.value = false;
          }
        }

        // Operations Hub (/restart, /cleancache, /update, /sh)
        const opsTargetNode = ref('all');
        const executingOp = ref(false);
        const currentOpName = ref('');

        async function triggerRestart() {
          if (!confirm(`Bạn có chắc chắn muốn khởi động lại PM2 trên [${opsTargetNode.value}]?`)) return;
          executingOp.value = true;
          currentOpName.value = 'restart';
          try {
            const res = await apiRequest('/api/restart', {
              method: 'POST',
              body: JSON.stringify({ nodeId: opsTargetNode.value }),
            });
            if (res.ok) {
              showToast(res.message || 'Đã kích hoạt khởi động lại PM2');
            } else {
              showToast(res.message || res.error || 'Lỗi khởi động lại', 'error');
            }
          } catch (err) {
            showToast(err.message, 'error');
          } finally {
            executingOp.value = false;
            currentOpName.value = '';
          }
        }

        async function triggerCleanCache() {
          executingOp.value = true;
          currentOpName.value = 'cleancache';
          try {
            const res = await apiRequest('/api/cleancache', {
              method: 'POST',
              body: JSON.stringify({ nodeId: opsTargetNode.value }),
            });
            if (res.ok) {
              showToast('Đã xả cache RAM & flush log PM2 thành công!');
              fetchData();
            } else {
              showToast(res.error || 'Lỗi xả cache', 'error');
            }
          } catch (err) {
            showToast(err.message, 'error');
          } finally {
            executingOp.value = false;
            currentOpName.value = '';
          }
        }

        async function triggerUpdate() {
          if (!confirm(`Bắt đầu chạy /update trên [${opsTargetNode.value}]? (Quá trình có thể mất ~30 giây)`)) return;
          executingOp.value = true;
          currentOpName.value = 'update';
          try {
            const res = await apiRequest('/api/update', {
              method: 'POST',
              body: JSON.stringify({ nodeId: opsTargetNode.value }),
            });
            if (res.ok) {
              showToast('Cập nhật thành công!');
              terminalOutput.value = typeof res.output === 'string' ? res.output : JSON.stringify(res.output, null, 2);
            } else {
              showToast(res.error || 'Lỗi cập nhật', 'error');
              terminalOutput.value = res.output || res.error || 'Thất bại';
            }
          } catch (err) {
            showToast(err.message, 'error');
          } finally {
            executingOp.value = false;
            currentOpName.value = '';
          }
        }

        // Web Whitelisted Terminal (/sh)
        const terminalNode = ref('gcp-master');
        const availableAliases = ref(['pm2-list', 'git-status', 'disk-usage', 'uptime', 'netstat-listen', 'pm2-restart assistant-bot', 'update', 'cleancache']);
        const selectedAlias = ref('');
        const terminalCommand = ref('');
        const terminalOutput = ref('');
        const runningTerminal = ref(false);

        function onAliasSelect() {
          if (selectedAlias.value) {
            terminalCommand.value = selectedAlias.value;
          }
        }

        async function fetchAliases() {
          try {
            const res = await fetch('/api/sh/aliases').then((r) => r.json());
            if (res.ok && Array.isArray(res.aliases)) {
              availableAliases.value = res.aliases;
            }
          } catch {}
        }

        async function runTerminalCommand() {
          if (!terminalCommand.value.trim()) return;
          runningTerminal.value = true;
          try {
            const res = await apiRequest('/api/sh', {
              method: 'POST',
              body: JSON.stringify({
                command: terminalCommand.value.trim(),
                nodeId: terminalNode.value,
              }),
            });
            if (res.ok) {
              terminalOutput.value = res.output || 'Lệnh thực thi thành công (không có đầu ra)';
            } else {
              terminalOutput.value = `❌ Lỗi: ${res.error || res.output || 'Lệnh thất bại'}`;
            }
          } catch (err) {
            terminalOutput.value = `❌ Lỗi kết nối: ${err.message}`;
          } finally {
            runningTerminal.value = false;
          }
        }

        // Notes Manager (/notes)
        const notesList = ref([]);
        const newNoteText = ref('');
        const savingNote = ref(false);

        async function fetchNotes() {
          try {
            const res = await apiRequest('/api/notes');
            if (res.ok && Array.isArray(res.notes)) {
              notesList.value = res.notes;
            }
          } catch {}
        }

        async function saveNote() {
          if (!newNoteText.value.trim()) return;
          savingNote.value = true;
          try {
            const res = await apiRequest('/api/notes', {
              method: 'POST',
              body: JSON.stringify({ text: newNoteText.value.trim() }),
            });
            if (res.ok) {
              showToast('Đã lưu ghi chú thành công!');
              newNoteText.value = '';
              fetchNotes();
            } else {
              showToast(res.error || 'Không thể lưu ghi chú', 'error');
            }
          } catch (err) {
            showToast(err.message, 'error');
          } finally {
            savingNote.value = false;
          }
        }

        async function clearAllNotes() {
          if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ danh sách ghi chú?')) return;
          try {
            const res = await apiRequest('/api/notes', { method: 'DELETE' });
            if (res.ok) {
              showToast('Đã xóa toàn bộ ghi chú');
              fetchNotes();
            } else {
              showToast(res.error || 'Lỗi khi xóa ghi chú', 'error');
            }
          } catch (err) {
            showToast(err.message, 'error');
          }
        }

        // =====================================================================
        // DEPLOY MODAL LOGIC (GitHub Inspector & Deploy)
        // =====================================================================
        const showDeployModal = ref(false);
        const inspectingRepo = ref(false);
        const deploying = ref(false);

        const newDeploy = ref({
          repoUrl: '',
          target: 'vps',
          nodeId: 'gcp-master',
          subdomain: '',
          baseDomain: 'thienhn.io.vn',
          inspection: null,
          inspectError: '',
          deployError: '',
        });

        function openDeployModal() {
          newDeploy.value = {
            repoUrl: '',
            target: 'vps',
            nodeId: nodes.value[0]?.id || 'gcp-master',
            subdomain: '',
            baseDomain: 'thienhn.io.vn',
            inspection: null,
            inspectError: '',
            deployError: '',
          };
          fetchNodes();
          showDeployModal.value = true;
        }

        function closeDeployModal() {
          showDeployModal.value = false;
        }

        async function inspectRepo() {
          if (!newDeploy.value.repoUrl) return;
          inspectingRepo.value = true;
          newDeploy.value.inspectError = '';
          newDeploy.value.inspection = null;

          try {
            const res = await apiRequest('/api/deployments/inspect', {
              method: 'POST',
              body: JSON.stringify({ repoUrl: newDeploy.value.repoUrl }),
            });

            if (res.ok) {
              newDeploy.value.inspection = res.inspection;
              newDeploy.value.target = res.inspection.suggestedTarget || res.inspection.defaultTarget || res.inspection.supportedTargets?.[0] || 'vps';
              newDeploy.value.subdomain = res.suggestedSubdomain || res.inspection.repo;
              newDeploy.value.baseDomain = res.baseDomain || 'thienhn.io.vn';
            } else {
              newDeploy.value.inspectError = res.error || 'Không thể phân tích repository này';
            }
          } catch (err) {
            newDeploy.value.inspectError = err.message || 'Lỗi kết nối khi phân tích repository';
          } finally {
            inspectingRepo.value = false;
          }
        }

        async function executeDeploy() {
          if (!newDeploy.value.inspection || !newDeploy.value.target || !newDeploy.value.subdomain) return;
          deploying.value = true;
          newDeploy.value.deployError = '';

          try {
            if (newDeploy.value.target === 'both') {
              const feRes = await apiRequest('/api/deployments/deploy-git', {
                method: 'POST',
                body: JSON.stringify({
                  repoUrl: newDeploy.value.repoUrl,
                  target: 'vercel',
                  subdomain: newDeploy.value.subdomain,
                }),
              });
              const beRes = await apiRequest('/api/deployments/deploy-git', {
                method: 'POST',
                body: JSON.stringify({
                  repoUrl: newDeploy.value.repoUrl,
                  target: 'render',
                  subdomain: `api-${newDeploy.value.subdomain}`,
                }),
              });

              if (feRes.ok && beRes.ok) {
                showToast(`Triển khai thành công Monorepo (Frontend & Backend)!`);
                closeDeployModal();
                fetchData();
              } else {
                newDeploy.value.deployError = feRes.error || beRes.error || 'Lỗi khi triển khai monorepo';
              }
            } else {
              const deployPayload = {
                repoUrl: newDeploy.value.repoUrl,
                target: newDeploy.value.target,
                subdomain: newDeploy.value.subdomain,
              };
              if (newDeploy.value.target === 'vps' && newDeploy.value.nodeId) {
                deployPayload.nodeId = newDeploy.value.nodeId;
              }
              const res = await apiRequest('/api/deployments/deploy-git', {
                method: 'POST',
                body: JSON.stringify(deployPayload),
              });

              if (res.ok) {
                showToast(`Triển khai thành công: ${res.deployment?.url || newDeploy.value.subdomain}`);
                closeDeployModal();
                fetchData();
              } else {
                newDeploy.value.deployError = res.error || 'Lỗi khi triển khai dự án';
              }
            }
          } catch (err) {
            newDeploy.value.deployError = err.message || 'Lỗi khi gửi yêu cầu triển khai';
          } finally {
            deploying.value = false;
          }
        }

        const filteredDeployments = computed(() => {
          return deployments.value.filter((d) => {
            const matchesTarget = targetFilter.value === 'all' || d.target === targetFilter.value;
            const matchesSearch = !searchQuery.value || 
              (d.name && d.name.toLowerCase().includes(searchQuery.value.toLowerCase())) ||
              (d.domain && d.domain.toLowerCase().includes(searchQuery.value.toLowerCase()));
            return matchesTarget && matchesSearch;
          });
        });

        function getNodeBadgeLabel(dep) {
          if (dep.target === 'vercel') return '▲ Vercel';
          if (dep.target === 'render') return '🔷 Render';
          if (dep.target === 'vps') {
            const foundNode = nodes.value.find((n) => n.id === dep.nodeId);
            if (foundNode) return `💻 ${foundNode.name}`;
            if (dep.nodeId === 'oracle-worker') return '💻 Oracle Cloud';
            return '💻 GCP Master';
          }
          return dep.target || 'N/A';
        }

        function formatDate(isoStr) {
          if (!isoStr) return 'N/A';
          try {
            const d = new Date(isoStr);
            return d.toLocaleString('vi-VN', { 
              hour: '2-digit', 
              minute: '2-digit', 
              day: '2-digit', 
              month: '2-digit', 
              year: 'numeric' 
            });
          } catch {
            return isoStr;
          }
        }

        onMounted(() => {
          verifySession();
          initGoogleAuth();
          fetchNodes();
          fetchAliases();
          fetchNotes();
        });

        return {
          token,
          user,
          isAuthenticated,
          googleClientId,
          authError,
          loadingAuth,
          showLoginModal,
          openLoginModal,
          currentTab,
          dashTab,
          system,
          clusterNodes,
          nodes,
          deployments,
          refreshing,
          targetFilter,
          searchQuery,
          toast,
          showToast,
          copiedCommand,
          copyCommand,
          commandCategories,
          selectedCategory,
          commandSearch,
          commands,
          getCategoryCount,
          filteredCommands,
          fetchData,
          fetchNodes,
          showDeployModal,
          inspectingRepo,
          deploying,
          newDeploy,
          openDeployModal,
          closeDeployModal,
          inspectRepo,
          executeDeploy,
          filteredDeployments,
          getNodeBadgeLabel,
          formatDate,
          logout,

          // Diagnostic Modals (/ps & /logs)
          showProcessesModal,
          loadingProcesses,
          processesSelectedNode,
          processesList,
          openProcessesModal,
          fetchProcesses,
          showLogsModal,
          loadingLogs,
          logsSelectedNode,
          logsLines,
          logsContent,
          openLogsModal,
          fetchLogs,

          // Perf Modal (/perf)
          showPerfModal,
          loadingPerf,
          perfTarget,
          perfResult,
          openPerfModal,

          // Undeploy Modal (/web_remove)
          showUndeployModal,
          executingUndeploy,
          undeployTargetName,
          confirmUndeploy,
          executeUndeploy,

          // Operations Hub (/restart, /cleancache, /update)
          opsTargetNode,
          executingOp,
          currentOpName,
          triggerRestart,
          triggerCleanCache,
          triggerUpdate,

          // Safe Whitelisted Web Terminal (/sh)
          terminalNode,
          availableAliases,
          selectedAlias,
          terminalCommand,
          terminalOutput,
          runningTerminal,
          onAliasSelect,
          fetchAliases,
          runTerminalCommand,

          // Notes Manager (/notes)
          notesList,
          newNoteText,
          savingNote,
          fetchNotes,
          saveNote,
          clearAllNotes,
        };
      }
    }).mount('#app');
