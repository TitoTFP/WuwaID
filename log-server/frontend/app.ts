// Declare global Chart variable since it's loaded via CDN
declare var Chart: any;

// ── STATE VARIABLES ──
let adminToken = localStorage.getItem('wuwaid_admin_token') || '';
let activeTab = 'active'; // 'active', 'logs', 'history'
let currentRange = '24h'; // '1h', '24h', '7d', '30d'
let allPlayers: any[] = [];
let allLogs: any[] = [];
let historyChartInstance: any = null;
let activeFileContent = '';
let currentUploadId = '';
let autoRefreshInterval: any = null;

// ── DOM ELEMENTS ──
const loginView = document.getElementById('login-view') as HTMLDivElement;
const appView = document.getElementById('app-view') as HTMLDivElement;
const tokenInput = document.getElementById('token-input') as HTMLInputElement;
const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
const loginErr = document.getElementById('login-err') as HTMLDivElement;

const navActive = document.getElementById('nav-active') as HTMLButtonElement;
const navHistory = document.getElementById('nav-history') as HTMLButtonElement;
const navLogs = document.getElementById('nav-logs') as HTMLButtonElement;

const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const filterResultCount = document.getElementById('filter-result-count') as HTMLSpanElement;

// Stats cards values
const statActiveCount = document.getElementById('stat-active-count') as HTMLDivElement;
const statTotalUploads = document.getElementById('stat-total-uploads') as HTMLDivElement;
const statTotalSize = document.getElementById('stat-total-size') as HTMLDivElement;
const statWindowText = document.getElementById('stat-window-text') as HTMLDivElement;
const statTotalPlayers30d = document.getElementById('total-players-30d') as HTMLElement;

// Tab content sections
const tabActiveView = document.getElementById('tab-active-view') as HTMLElement;
const tabLogsView = document.getElementById('tab-logs-view') as HTMLElement;
const tabHistoryView = document.getElementById('tab-history-view') as HTMLElement;

// Tables tbody
const playersTbody = document.getElementById('players-tbody') as HTMLTableSectionElement;
const logsTbody = document.getElementById('logs-tbody') as HTMLTableSectionElement;

// Chart items
const chartRangeSelector = document.getElementById('range-selector') as HTMLDivElement;
const chartLegendEl = document.getElementById('chart-legend') as HTMLDivElement;

// Drawer items
const inspectorDrawer = document.getElementById('inspector-drawer') as HTMLDivElement;
const drawerCloseOverlay = document.getElementById('drawer-close-overlay') as HTMLDivElement;
const drawerCloseBtn = document.getElementById('drawer-close-btn') as HTMLButtonElement;
const inspectorUploadId = document.getElementById('inspector-upload-id') as HTMLSpanElement;
const inspectorUploadMeta = document.getElementById('inspector-upload-meta') as HTMLParagraphElement;
const inspectorFileList = document.getElementById('inspector-file-list') as HTMLUListElement;
const btnDownloadZip = document.getElementById('btn-download-zip') as HTMLAnchorElement;
const viewerActiveFilename = document.getElementById('viewer-active-filename') as HTMLSpanElement;
const viewerCodeBlock = document.getElementById('viewer-code-block') as HTMLElement;
const btnCopyLog = document.getElementById('btn-copy-log') as HTMLButtonElement;

// Toast element helper
const toastContainer = document.getElementById('toast-container') as HTMLDivElement;

// ── INIT FUNCTION ──
function init() {
  // Bind Login Event Listeners
  loginBtn.addEventListener('click', doLogin);
  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  // Bind Logout
  logoutBtn.addEventListener('click', doLogout);

  // Bind Navigation Tabs
  navActive.addEventListener('click', () => switchTab('active'));
  navHistory.addEventListener('click', () => switchTab('history'));
  navLogs.addEventListener('click', () => switchTab('logs'));

  // Bind Refresh
  refreshBtn.addEventListener('click', () => {
    showToast('Memuat data terbaru...', 'info');
    refreshAll();
  });

  // Bind Search Input
  searchInput.addEventListener('input', filterData);

  // Bind Range Selector
  if (chartRangeSelector) {
    chartRangeSelector.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      if (target && target.classList.contains('btn-tab-range')) {
        // Remove active class from sibling buttons
        Array.from(chartRangeSelector.children).forEach(btn => btn.classList.remove('active'));
        target.classList.add('active');
        const range = target.getAttribute('data-range');
        if (range) {
          currentRange = range;
          loadHistory();
        }
      }
    });
  }

  // Bind Drawer Close
  drawerCloseBtn.addEventListener('click', closeInspector);
  drawerCloseOverlay.addEventListener('click', closeInspector);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeInspector();
  });

  // Bind Log Copy Button
  btnCopyLog.addEventListener('click', copyLogContent);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && adminToken) {
      refreshAll();
    }
  });

  // Check auth if token is stored
  if (adminToken) {
    validateTokenAndLogin();
  }
}

// ── TOAST NOTIFICATIONS ──
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  toastContainer.appendChild(toast);

  // Remove toast after 3s
  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s ease forwards';
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

// ── AUTHENTICATION ──
function validateTokenAndLogin() {
  fetch('/admin/api/active', {
    headers: { 'X-Admin-Token': adminToken }
  })
  .then(res => {
    if (res.ok) {
      // Valid Token
      loginView.style.display = 'none';
      appView.style.display = 'flex';
      showToast('Berhasil masuk ke panel kontrol', 'success');
      refreshAll();
      startAutoRefresh();
    } else {
      // Invalid token
      localStorage.removeItem('wuwaid_admin_token');
      adminToken = '';
      showToast('Token admin kedaluwarsa atau tidak valid', 'error');
    }
  })
  .catch(() => {
    showToast('Gagal terhubung ke server', 'error');
  });
}

function doLogin() {
  const token = tokenInput.value.trim();
  if (!token) {
    loginErr.textContent = 'Token tidak boleh kosong!';
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = 'Memverifikasi...';
  loginErr.textContent = '';

  fetch('/admin/api/active', {
    headers: { 'X-Admin-Token': token }
  })
  .then(res => {
    if (res.ok) {
      adminToken = token;
      localStorage.setItem('wuwaid_admin_token', token);
      loginView.style.display = 'none';
      appView.style.display = 'flex';
      showToast('Login berhasil!', 'success');
      tokenInput.value = '';
      refreshAll();
      startAutoRefresh();
    } else {
      loginErr.textContent = 'Token admin salah!';
      showToast('Login gagal', 'error');
    }
  })
  .catch(() => {
    loginErr.textContent = 'Gagal terhubung ke server.';
    showToast('Koneksi gagal', 'error');
  })
  .finally(() => {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Masuk Ke Dashboard';
  });
}

function doLogout() {
  localStorage.removeItem('wuwaid_admin_token');
  adminToken = '';
  appView.style.display = 'none';
  loginView.style.display = 'flex';
  stopAutoRefresh();
  showToast('Telah keluar dari dashboard', 'info');
}

// ── SWITCH TAB ──
function switchTab(tab: string) {
  activeTab = tab;
  
  // Update nav buttons active state
  navActive.classList.toggle('active', tab === 'active');
  navHistory.classList.toggle('active', tab === 'history');
  navLogs.classList.toggle('active', tab === 'logs');

  // Toggle tab view sections
  tabActiveView.classList.toggle('active', tab === 'active');
  tabLogsView.classList.toggle('active', tab === 'logs');
  tabHistoryView.classList.toggle('active', tab === 'history');

  // Load appropriate data
  if (tab === 'logs') {
    loadLogs();
  } else if (tab === 'history') {
    loadHistory();
  } else {
    loadPlayers();
  }

  // Refilter
  filterData();
}

// ── DATA FETCHING ──
function refreshAll() {
  loadActive();
  if (activeTab === 'active') {
    loadPlayers();
  } else if (activeTab === 'logs') {
    loadLogs();
  } else if (activeTab === 'history') {
    loadHistory();
  }
}

function loadActive() {
  fetch('/admin/api/active', {
    headers: { 'X-Admin-Token': adminToken }
  })
  .then(res => res.json())
  .then(d => {
    statActiveCount.textContent = d.active.toString();
    statWindowText.textContent = `${d.window_seconds}s / 30 Hari`;
    if (statTotalPlayers30d && d.total_30d !== undefined) {
      statTotalPlayers30d.textContent = d.total_30d.toString();
    }
  })
  .catch(() => {});
}

function loadPlayers() {
  playersTbody.innerHTML = `
    <tr>
      <td colspan="5" class="empty-state">
        <div class="shimmer-row"></div>
        <div class="shimmer-row"></div>
        <div class="shimmer-row"></div>
      </td>
    </tr>
  `;

  fetch('/admin/api/active/players', {
    headers: { 'X-Admin-Token': adminToken }
  })
  .then(res => res.json())
  .then(d => {
    allPlayers = Array.isArray(d) ? d : [];
    renderPlayersTable(allPlayers);
  })
  .catch(() => {
    playersTbody.innerHTML = '<tr><td colspan="5" class="empty-state text-green">Gagal memuat data active players</td></tr>';
  });
}

function loadLogs() {
  logsTbody.innerHTML = `
    <tr>
      <td colspan="7" class="empty-state">
        <div class="shimmer-row"></div>
        <div class="shimmer-row"></div>
        <div class="shimmer-row"></div>
      </td>
    </tr>
  `;

  fetch('/admin/api/logs', {
    headers: { 'X-Admin-Token': adminToken }
  })
  .then(res => res.json())
  .then(d => {
    allLogs = Array.isArray(d) ? d : [];
    
    // Compute total size and uploads count
    const totalCount = allLogs.length;
    const totalBytes = allLogs.reduce((sum, log) => sum + (log.total_bytes || 0), 0);
    
    statTotalUploads.textContent = totalCount.toString();
    statTotalSize.textContent = fmtBytes(totalBytes);
    
    renderLogsTable(allLogs);
  })
  .catch(() => {
    logsTbody.innerHTML = '<tr><td colspan="7" class="empty-state text-purple">Gagal memuat data log uploads</td></tr>';
  });
}

function loadHistory() {
  fetch(`/admin/api/active/history?range=${currentRange}`, {
    headers: { 'X-Admin-Token': adminToken }
  })
  .then(res => res.json())
  .then(d => {
    renderHistoryChart(d);
  })
  .catch(() => {
    showToast('Gagal memuat grafik history', 'error');
  });
}

// ── TABLE RENDERING ──
function renderPlayersTable(players: any[]) {
  if (players.length === 0) {
    playersTbody.innerHTML = '<tr><td colspan="5" class="empty-state">Belum ada active player yang terlihat baru-baru ini.</td></tr>';
    filterResultCount.textContent = 'Menampilkan 0 dari 0 active players';
    return;
  }

  playersTbody.innerHTML = players.map(p => {
    const isLaunch = p.event === 'launch' || p.event === 'open';
    const eventPillClass = isLaunch ? 'pill-success' : 'pill-primary';
    const methodPillClass = p.install_method === 'method1' ? 'pill-cyan' : 'pill-warning';

    return `
      <tr>
        <td data-label="Client ID" class="mono-cell">${esc(p.client_id)}</td>
        <td data-label="Launcher"><span class="pill pill-primary">${esc(p.launcher_version || '—')}</span></td>
        <td data-label="Install"><span class="pill ${methodPillClass}">${esc(p.install_method || '—')}</span></td>
        <td data-label="Last Event"><span class="pill ${eventPillClass}">${esc(p.event || '—')}</span></td>
        <td data-label="Last Seen">${fmtTime(p.last_seen)}</td>
      </tr>
    `;
  }).join('');

  filterResultCount.textContent = `Menampilkan ${players.length} active players`;
}

function renderLogsTable(logs: any[]) {
  if (logs.length === 0) {
    logsTbody.innerHTML = '<tr><td colspan="7" class="empty-state">Belum ada log archive yang di-upload ke server.</td></tr>';
    filterResultCount.textContent = 'Menampilkan 0 dari 0 uploads';
    return;
  }

  logsTbody.innerHTML = logs.map(l => {
    const osClass = l.os?.toLowerCase().includes('windows') ? 'pill-cyan' : 'pill-secondary';
    return `
      <tr>
        <td data-label="Upload ID" class="mono-cell">${esc(l.id)}</td>
        <td data-label="App Version"><span class="pill pill-primary">${esc(l.app_version)}</span></td>
        <td data-label="Operating System"><span class="pill ${osClass}">${esc(l.os)}</span></td>
        <td data-label="File Count">${l.file_count}</td>
        <td data-label="Total Size">${fmtBytes(l.total_bytes)}</td>
        <td data-label="Created At">${fmtTime(l.created_at || l.timestamp)}</td>
        <td data-label="Action">
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary btn-sm" onclick="openInspector('${l.id}')">🔍 Inspect</button>
            <a class="btn btn-primary btn-sm" href="/admin/api/logs/${l.id}/download?token=${adminToken}" target="_blank">📥 Download</a>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  filterResultCount.textContent = `Menampilkan ${logs.length} uploads`;
}

// ── SEARCH FILTERING ──
function filterData() {
  const query = searchInput.value.toLowerCase().trim();
  if (activeTab === 'active') {
    if (!query) {
      renderPlayersTable(allPlayers);
    } else {
      const filtered = allPlayers.filter(p => 
        (p.client_id || '').toLowerCase().includes(query) ||
        (p.launcher_version || '').toLowerCase().includes(query) ||
        (p.install_method || '').toLowerCase().includes(query) ||
        (p.event || '').toLowerCase().includes(query)
      );
      renderPlayersTable(filtered);
    }
  } else if (activeTab === 'logs') {
    if (!query) {
      renderLogsTable(allLogs);
    } else {
      const filtered = allLogs.filter(l => 
        (l.id || '').toLowerCase().includes(query) ||
        (l.app_version || '').toLowerCase().includes(query) ||
        (l.os || '').toLowerCase().includes(query)
      );
      renderLogsTable(filtered);
    }
  } else {
    filterResultCount.textContent = 'Pencarian tidak tersedia untuk tab grafik tren';
  }
}

// Make openInspector available globally since it's injected inside HTML strings
(window as any).openInspector = openInspector;

// ── HISTORY CHART RENDERING ──
function renderHistoryChart(data: any) {
  const ctx = (document.getElementById('historyChart') as HTMLCanvasElement).getContext('2d');
  if (!ctx) return;

  const sourcePoints = data.points || [];
  const maxChartPoints = 1000;
  const sampleStep = Math.max(1, Math.ceil(sourcePoints.length / maxChartPoints));
  const points = sampleStep === 1
    ? sourcePoints
    : sourcePoints.filter((_: any, index: number) => index % sampleStep === 0 || index === sourcePoints.length - 1);
  const eventKeys = data.event_keys || [];

  const labels = points.map((p: any) => fmtTime(p.timestamp));

  const EVENT_COLORS: Record<string, string> = {
    total: '#8a2be2',
    game_start: '#43a047',
    game_exit: '#e53935',
    launcher_open: '#3949ab',
    launcher_close: '#fb8c00',
    unknown: '#757575',
    heartbeat: '#26a69a'
  };

  const FALLBACK_COLORS = ['#8a2be2', '#43a047', '#e53935', '#3949ab', '#fb8c00', '#26a69a', '#00acc1', '#757575'];
  
  const getEventColor = (key: string, idx: number) => {
    return EVENT_COLORS[key] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
  };

  // Build datasets
  const datasets: any[] = [];

  // Total lines (always first, prominent)
  datasets.push({
    label: 'Total Active',
    data: points.map((p: any) => p.total || 0),
    borderColor: '#7c4dff',
    backgroundColor: 'rgba(124, 77, 255, 0.08)',
    borderWidth: 3,
    tension: 0,
    fill: true,
    pointRadius: 0,
    pointHoverRadius: 6,
  });

  // Event specifics lines
  eventKeys.forEach((key: string, idx: number) => {
    datasets.push({
      label: key,
      data: points.map((p: any) => (p.events && p.events[key]) || 0),
      borderColor: getEventColor(key, idx),
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      tension: 0,
      fill: false,
      pointRadius: 0,
      pointHoverRadius: 4,
    });
  });

  // Destroy existing chart if it exists
  if (historyChartInstance) {
    historyChartInstance.destroy();
  }

  historyChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: false // We use our custom legend
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          titleColor: '#f3f4f6',
          titleFont: { family: 'Inter', weight: 'bold' },
          bodyColor: '#f3f4f6',
          bodyFont: { family: 'Inter' },
          borderColor: '#374151',
          borderWidth: 1,
          padding: 12,
          boxPadding: 4,
          cornerRadius: 8
        }
      },
      scales: {
        x: {
          grid: {
            color: '#1f2937',
          },
          ticks: {
            color: '#9ca3af',
            maxTicksLimit: 10,
            font: { size: 10, family: 'Inter' }
          }
        },
        y: {
          grid: {
            color: '#1f2937',
          },
          ticks: {
            color: '#9ca3af',
            stepSize: 1,
            font: { size: 10, family: 'Inter' }
          },
          beginAtZero: true
        }
      }
    }
  });

  // Render Custom Legend
  chartLegendEl.innerHTML = datasets.map(ds => `
    <div class="legend-item">
      <div class="legend-color" style="background: ${ds.borderColor}"></div>
      <span>${esc(ds.label)}</span>
    </div>
  `).join('');
}

// ── INSPECTOR DRAWER ──
function openInspector(uploadId: string) {
  currentUploadId = uploadId;
  inspectorUploadId.textContent = uploadId;
  inspectorUploadMeta.textContent = 'Sedang mengambil berkas...';
  inspectorFileList.innerHTML = '<li class="empty-file">Mengambil daftar berkas log...</li>';
  viewerActiveFilename.textContent = 'Pilih file log di sebelah kiri';
  viewerCodeBlock.textContent = 'Silakan pilih berkas log untuk memeriksa isinya secara langsung.';
  btnCopyLog.style.display = 'none';

  btnDownloadZip.href = `/admin/api/logs/${uploadId}/download?token=${adminToken}`;

  // Open Drawer
  inspectorDrawer.classList.add('active');

  // Fetch file list
  fetch(`/admin/api/logs/${uploadId}/files`, {
    headers: { 'X-Admin-Token': adminToken }
  })
  .then(res => {
    if (!res.ok) throw new Error('Gagal mengambil berkas');
    return res.json();
  })
  .then(d => {
    const files = d.files || [];
    
    // Find upload info
    const meta = allLogs.find(l => l.id === uploadId);
    if (meta) {
      inspectorUploadMeta.textContent = `OS: ${meta.os} • Versi: ${meta.app_version} • Total Berkas: ${meta.file_count}`;
    } else {
      inspectorUploadMeta.textContent = `Total Berkas: ${files.length}`;
    }

    if (files.length === 0) {
      inspectorFileList.innerHTML = '<li class="empty-file">Daftar berkas log kosong.</li>';
      return;
    }

    inspectorFileList.innerHTML = files.map((file: any) => `
      <li onclick="selectFile('${esc(file.name)}')" data-filename="${esc(file.name)}">
        <span class="file-name">📄 ${esc(file.name)}</span>
        <span class="file-size-tag">${fmtBytes(file.size)}</span>
      </li>
    `).join('');
  })
  .catch((err) => {
    inspectorUploadMeta.textContent = 'Gagal memuat log metadata.';
    inspectorFileList.innerHTML = `<li class="empty-file text-red">${esc(err.message)}</li>`;
  });
}

function selectFile(filename: string) {
  // Mark active file in sidebar list
  const listItems = inspectorFileList.querySelectorAll('li');
  listItems.forEach(item => {
    if (item.getAttribute('data-filename') === filename) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  viewerActiveFilename.textContent = filename;
  viewerCodeBlock.textContent = 'Mengambil isi log...';
  btnCopyLog.style.display = 'none';
  activeFileContent = '';

  // Encode filename for URL query path
  const urlFilename = encodeURIComponent(filename);

  fetch(`/admin/api/logs/${currentUploadId}/files/${urlFilename}`, {
    headers: { 'X-Admin-Token': adminToken }
  })
  .then(res => {
    if (!res.ok) throw new Error('Gagal membaca isi berkas log');
    return res.text();
  })
  .then(text => {
    activeFileContent = text;
    viewerCodeBlock.textContent = text || '[Berkas Kosong]';
    btnCopyLog.style.display = 'inline-block';
  })
  .catch(err => {
    viewerCodeBlock.textContent = `Error: ${err.message}`;
  });
}

// Make selectFile available globally
(window as any).selectFile = selectFile;

function closeInspector() {
  inspectorDrawer.classList.remove('active');
}

function copyLogContent() {
  if (!activeFileContent) return;
  navigator.clipboard.writeText(activeFileContent)
    .then(() => {
      showToast('Isi log berhasil disalin ke clipboard', 'success');
    })
    .catch(() => {
      showToast('Gagal menyalin isi log', 'error');
    });
}

// ── UTILITY HELPERS ──
function esc(str: string): string {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function fmtTime(isoStr: string): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  } catch {
    return isoStr;
  }
}

function fmtBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

// ── AUTO REFRESH ──
function startAutoRefresh() {
  stopAutoRefresh();
  // Auto refresh every 15s
  autoRefreshInterval = setInterval(() => {
    if (adminToken && !document.hidden) {
      loadActive();
      if (activeTab === 'active') {
        loadPlayers();
      }
    }
  }, 15000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Start application
window.addEventListener('DOMContentLoaded', init);
