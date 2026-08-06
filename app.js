/**
 * AWS Real-Time Cost Explorer & AI Optimizer Logic
 * Features dual data sources: Direct AWS API connections (using server.js Express proxy)
 * and interactive high-fidelity AWS Simulator Stream with live scrolling charts.
 */

// Global State
let currentDimension = 'service'; // 'service', 'region', 'tags'
let dataSourceMode = 'simulator'; // 'api' (Real AWS) or 'simulator' (Mock)
let cloudData = [];
let realAWSPieData = null;
let realAWSPieDataCurrentMonth = null;
let chartCostTrend = null;
let chartCostDistribution = null;
let chartUtilization = null;
let liveSecondTimer = null;

// Financial State (Live Accumulators) - Normalized to match user's real 2026 spend of $93,548.62
let todayCost = 445.47;
let apiTodayCost = 445.47;
let monthToDateCost = 93548.62;
let simulatedSpeedMs = 2000; // 'normal' speed default is 2s
let simTimer = null;
let totalAnomalies = 0;
let isSpikeActive = false;

// Scrolling Trend Data Array (Stores recent live cost entries for the real-time line chart)
let liveTrendLabels = [];
let liveTrendData = [];
const MAX_TREND_POINTS = 15;
let displayedEventIds = new Set();
let cloudTrailInterval = null;

// Standard AWS Mock Resources for initial simulator state
const INITIAL_AWS_RESOURCES = [
  { id: 'res-aws-1', name: 'prod-web-ecs-service', service: 'Compute (ECS)', provider: 'aws', cost: 45.20, metricCpu: 72, metricRam: 64, status: 'active', region: 'ap-southeast-1', health: 'healthy', warning: '', tags: 'Env:Prod,Team:Web' },
  { id: 'res-aws-2', name: 'prod-aurora-db-cluster', service: 'Database (RDS)', provider: 'aws', cost: 112.50, metricCpu: 48, metricRam: 80, status: 'active', region: 'ap-southeast-1', health: 'healthy', warning: '', tags: 'Env:Prod,Team:Data' },
  { id: 'res-aws-3', name: 'dev-sandbox-bastion', service: 'Compute (EC2)', provider: 'aws', cost: 12.80, metricCpu: 2, metricRam: 12, status: 'idle', region: 'us-east-1', health: 'warning', warning: 'CPU cực thấp (< 5%) trong 7 ngày qua. Đề xuất hạ cấp hoặc lên lịch tắt tự động.', tags: 'Env:Dev,Team:Web' },
  { id: 'res-aws-4', name: 'prod-static-assets-s3', service: 'Storage (S3)', provider: 'aws', cost: 35.40, metricCpu: 0, metricRam: 0, status: 'active', region: 'ap-southeast-1', health: 'healthy', warning: '', tags: 'Env:Prod,Team:Web' },
  { id: 'res-aws-5', name: 'temp-testing-migration-vm', service: 'Compute (EC2)', provider: 'aws', cost: 8.50, metricCpu: 0, metricRam: 0, status: 'stopped', region: 'us-west-2', health: 'healthy', warning: '', tags: 'Env:Test,Team:Data' },
  { id: 'res-aws-6', name: 'unattached-ebs-production-vol', service: 'Storage (EBS)', provider: 'aws', cost: 18.00, metricCpu: 0, metricRam: 0, status: 'unused', region: 'ap-southeast-1', health: 'danger', warning: 'EBS Volume không gắn với EC2 instance nào. Đề xuất xóa lập tức để tránh lãng phí $18.00/ngày.', tags: 'Env:Prod,Team:Data' },
  { id: 'res-aws-7', name: 'idle-development-nat-gateway', service: 'Network (NAT Gateway)', provider: 'aws', cost: 26.40, metricCpu: 0, metricRam: 0, status: 'idle', region: 'us-east-1', health: 'warning', warning: 'NAT Gateway không ghi nhận traffic đi qua trong 5 ngày. Đề xuất cấu hình VPC Endpoint.', tags: 'Env:Dev,Team:Web' },
  { id: 'res-aws-8', name: 'unassociated-elastic-ip-addr', service: 'Network (Elastic IP)', provider: 'aws', cost: 3.60, metricCpu: 0, metricRam: 0, status: 'unused', region: 'us-east-1', health: 'danger', warning: 'Elastic IP nhàn rỗi không gắn với tài nguyên nào. AWS tính phí $0.005/giờ.', tags: 'Env:Dev,Team:Web' }
];

// Initial AI Optimization Recommendations
const INITIAL_RECOMMENDATIONS = [
  {
    id: 'rec-1',
    title: 'Hạ cấp EC2 rảnh rỗi (Right-sizing)',
    description: 'Instance \'dev-sandbox-bastion\' sử dụng CPU trung bình < 3%. Chuyển đổi từ t3.medium sang t3.nano.',
    impact: 'Tiết kiệm $9.60/ngày',
    savingVal: 9.60,
    service: 'Compute (EC2)',
    resourceId: 'res-aws-3',
    severity: 'low'
  },
  {
    id: 'rec-2',
    title: 'Xóa EBS Volume không gắn kết',
    description: 'Volume \'unattached-ebs-production-vol\' không được gắn với bất kỳ máy chủ nào từ tháng trước.',
    impact: 'Tiết kiệm $18.00/ngày',
    savingVal: 18.00,
    service: 'Storage (EBS)',
    resourceId: 'res-aws-6',
    severity: 'high'
  },
  {
    id: 'rec-3',
    title: 'Giải phóng Elastic IP nhàn rỗi',
    description: 'Thu hồi IP tĩnh \'unassociated-elastic-ip-addr\' đang rảnh rỗi tránh chịu phí phạt nhàn rỗi.',
    impact: 'Tiết kiệm $3.60/ngày',
    savingVal: 3.60,
    service: 'Network (Elastic IP)',
    resourceId: 'res-aws-8',
    severity: 'medium'
  }
];

// Transaction live activity templates (used to simulate cloud activity)
const LIVE_ACTIVITY_TEMPLATES = [
  { template: '[ap-southeast-1] Lambda Invocation prod-payment-processor: +${cost}', minCost: 0.0001, maxCost: 0.0008, service: 'Compute (ECS)', region: 'ap-southeast-1', tags: 'Env:Prod,Team:Web' },
  { template: '[us-east-1] DynamoDB Read Capacity Units prod-orders: +${cost}', minCost: 0.001, maxCost: 0.005, service: 'Database (RDS)', region: 'us-east-1', tags: 'Env:Prod,Team:Data' },
  { template: '[ap-southeast-1] S3 Standard Data Transfer Out: +${cost}', minCost: 0.005, maxCost: 0.025, service: 'Storage (S3)', region: 'ap-southeast-1', tags: 'Env:Prod,Team:Web' },
  { template: '[us-west-2] CloudFront CDN Edge Delivery Cache-Hit: +${cost}', minCost: 0.0002, maxCost: 0.0015, service: 'Network (NAT Gateway)', region: 'us-west-2', tags: 'Env:Prod,Team:Web' },
  { template: '[ap-southeast-1] ElastiCache Redis Query Execution: +${cost}', minCost: 0.0005, maxCost: 0.002, service: 'Database (RDS)', region: 'ap-southeast-1', tags: 'Env:Prod,Team:Data' },
  { template: '[us-east-1] S3 API PutObject Request payload-ingest: +${cost}', minCost: 0.0012, maxCost: 0.006, service: 'Storage (S3)', region: 'us-east-1', tags: 'Env:Prod,Team:Data' }
];

const ANOMALY_ACTIVITY_TEMPLATES = [
  { template: '[CRITICAL WARNING] [us-east-1] Recursive Lambda Invocation Loop detected: +${cost}', minCost: 0.95, maxCost: 2.45, service: 'Compute (ECS)', region: 'us-east-1', tags: 'Env:Prod,Team:Web' },
  { template: '[CRITICAL WARNING] [ap-southeast-1] AWS S3 GET Spike - HTTP flood request: +${cost}', minCost: 0.72, maxCost: 1.85, service: 'Storage (S3)', region: 'ap-southeast-1', tags: 'Env:Prod,Team:Web' },
  { template: '[CRITICAL WARNING] [us-west-2] NAT Gateway egress traffic data transfer leak: +${cost}', minCost: 1.10, maxCost: 3.15, service: 'Network (NAT Gateway)', region: 'us-west-2', tags: 'Env:Prod,Team:Web' }
];

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupEventListeners();
  initCharts();
  
  // Try to connect to real AWS backend first
  fetchRealAWSCostData();
});

// Load resources and recommendations from storage or default
function loadData() {
  const savedData = localStorage.getItem('aws_cost_data');
  if (savedData) {
    try {
      cloudData = JSON.parse(savedData);
    } catch (e) {
      cloudData = [...INITIAL_AWS_RESOURCES];
    }
  } else {
    cloudData = [...INITIAL_AWS_RESOURCES];
  }

  // Load recommendations
  const savedRecs = localStorage.getItem('aws_recommendations');
  if (!savedRecs) {
    localStorage.setItem('aws_recommendations', JSON.stringify(INITIAL_RECOMMENDATIONS));
  }
}

function getRecommendations() {
  const saved = localStorage.getItem('aws_recommendations');
  return saved ? JSON.parse(saved) : [...INITIAL_RECOMMENDATIONS];
}

function saveRecommendations(recs) {
  localStorage.setItem('aws_recommendations', JSON.stringify(recs));
}

// Fetch direct AWS data from proxy backend API
async function fetchRealAWSCostData() {
  showToast('Đang kết nối API AWS Cost Explorer...', 'info');
  
  const statusBadge = document.getElementById('data-source-badge');
  if (statusBadge) {
    statusBadge.textContent = 'CONNECTING...';
    statusBadge.className = 'px-2 py-0.5 text-[9px] font-extrabold uppercase bg-slate-800 text-slate-400 border border-slate-700 rounded-md';
  }

  try {
    const response = await fetch(`http://localhost:3003/api/costs?groupBy=${currentDimension}`);
    
    if (!response.ok) {
      const errPayload = await response.json();
      throw new Error(errPayload.message || 'Lỗi phản hồi API');
    }

    const payload = await response.json();

    // Success! Update data source mode
    dataSourceMode = 'api';
    
    if (statusBadge) {
      statusBadge.textContent = 'AWS API (REAL)';
      statusBadge.className = 'px-2 py-0.5 text-[9px] font-extrabold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md';
    }

    // Load financials directly from API
    monthToDateCost = payload.totalCost;
    apiTodayCost = payload.todayCost;
    todayCost = payload.todayCost;
    cloudData = payload.resources;
    realAWSPieData = payload.byGroup;
    realAWSPieDataCurrentMonth = payload.byGroupCurrentMonth;

    // Handle Mathematically Detected Real AWS Cost Anomalies
    if (payload.anomaly && payload.anomaly.detected) {
      showToast(payload.anomaly.message, 'danger');
      
      // Inject critical real anomaly warning to Recommendations list
      let recs = getRecommendations();
      recs = recs.filter(r => r.id !== 'rec-real-anomaly');
      recs.unshift({
        id: 'rec-real-anomaly',
        title: '⚠️ CẢNH BÁO CHI PHÍ BẤT THƯỜNG THỰC TẾ!',
        description: payload.anomaly.message,
        impact: 'Chi phí đột biến tăng nguy kịch',
        savingVal: 0,
        badge: 'critical',
        actionText: 'Kiểm tra IAM & Billing Console ngay'
      });
      saveRecommendations(recs);
    } else {
      // Clear any historic real anomalies if status returns to healthy
      let recs = getRecommendations();
      const lenBefore = recs.length;
      recs = recs.filter(r => r.id !== 'rec-real-anomaly');
      if (recs.length !== lenBefore) {
        saveRecommendations(recs);
      }
    }

    // Sync financial tickers immediately
    const todayValEl = document.getElementById('kpi-today-cost');
    if (todayValEl) todayValEl.textContent = `$${todayCost.toFixed(3)}`;
    const totalValEl = document.getElementById('kpi-total-cost');
    if (totalValEl) totalValEl.textContent = `$${monthToDateCost.toFixed(2)}`;

    // Sync percentage comparisons to match real bills
    const compareEl = document.getElementById('kpi-cost-compare');
    if (compareEl) {
      compareEl.textContent = 'Dữ liệu trực tiếp từ tài khoản AWS';
    }

    renderDashboard();
    initCharts();
    startLiveSecondTicker(); // Start high-fidelity real-time currency ticker based on AWS burn rate

    showToast('Kết nối AWS Cost Explorer thành công! Biểu đồ đã hiển thị dữ liệu hóa đơn thật.', 'success');

  } catch (error) {
    console.warn("API Connection failed, falling back to simulator.", error);
    fallbackToSimulator(error.message);
  }
}

// Fallback elegantly to local simulation engine when API fails
function fallbackToSimulator(errorMessage) {
  dataSourceMode = 'simulator';
  realAWSPieData = null;
  realAWSPieDataCurrentMonth = null;
  apiTodayCost = 445.47;
  
  const statusBadge = document.getElementById('data-source-badge');
  if (statusBadge) {
    statusBadge.textContent = 'SIMULATOR (MOCK)';
    statusBadge.className = 'px-2 py-0.5 text-[9px] font-extrabold uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-md';
  }

  // Reload local datasets
  loadData();
  renderDashboard();

  // Stop polling CloudTrail when falling back to simulator
  stopCloudTrailPolling();

  startLiveSecondTicker(); // Fallback ticker

  // Show detailed error toast
  const detail = errorMessage ? `: ${errorMessage}` : " (Local proxy server.js chưa khởi động)";
  showToast(`Sử dụng Simulator. Kết nối API lỗi${detail}`, 'warning');
}

// Start CloudTrail events polling every 12 seconds
function startCloudTrailPolling() {
  if (cloudTrailInterval) clearInterval(cloudTrailInterval);
  
  // Call once immediately
  fetchRealAWSCloudTrailEvents();
  
  // Poll periodically
  cloudTrailInterval = setInterval(() => {
    fetchRealAWSCloudTrailEvents();
  }, 12000);
}

// Stop CloudTrail events polling
function stopCloudTrailPolling() {
  if (cloudTrailInterval) {
    clearInterval(cloudTrailInterval);
    cloudTrailInterval = null;
  }
}

// Fetch real CloudTrail Events from Express backend proxy
async function fetchRealAWSCloudTrailEvents() {
  if (dataSourceMode !== 'api') return;

  try {
    const response = await fetch('http://localhost:3003/api/events');
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'Lỗi fetch CloudTrail');
    }

    const payload = await response.json();
    const events = payload.events || [];

    // Chronological sort: oldest to newest to scroll correctly into console terminal
    const sortedEvents = [...events].reverse();
    let hasNewEvents = false;

    sortedEvents.forEach(evt => {
      if (!displayedEventIds.has(evt.eventId)) {
        displayedEventIds.add(evt.eventId);
        hasNewEvents = true;

        const timeStr = new Date(evt.eventTime).toLocaleTimeString('vi-VN', { hour12: false });
        
        // Style depending on read vs write activities
        const isWriteAction = !evt.readOnly;
        const actionColorClass = isWriteAction ? 'text-amber-400 font-bold' : 'text-slate-200';
        const badgeClass = isWriteAction ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
        
        const logMsg = `<span class="px-1.5 py-0.5 text-[9px] uppercase font-extrabold rounded border ${badgeClass} mr-1.5 shadow-sm"><i data-lucide="cloud" class="w-2.5 h-2.5 inline shrink-0 mr-0.5 -mt-0.5"></i>REAL EVENT</span> User: <span class="text-indigo-400 font-semibold">${evt.username}</span> | Action: <span class="${actionColorClass}">${evt.eventName}</span> <span class="text-slate-500">(${evt.eventSource})</span>`;
        
        appendLogConsole(timeStr, logMsg, isWriteAction && evt.eventName.toLowerCase().includes('delete'));
      }
    });

  } catch (error) {
    console.warn("Lỗi đồng bộ CloudTrail:", error);
    showToast(`Đồng bộ CloudTrail lỗi: ${error.message || 'Thiếu quyền cloudtrail:LookupEvents'}`, 'warning');
  }
}

// Set up event listeners
function setupEventListeners() {
  // Toggle Source Button click
  const btnToggleSource = document.getElementById('btn-toggle-source');
  if (btnToggleSource) {
    btnToggleSource.addEventListener('click', () => {
      if (dataSourceMode === 'simulator') {
        fetchRealAWSCostData();
      } else {
        fallbackToSimulator("Chuyển đổi chủ động bởi người dùng.");
      }
    });
  }

  // Dimension Filtering Tabs (Group By)
  const btnGroupService = document.getElementById('group-by-service');
  const btnGroupRegion = document.getElementById('group-by-region');
  const btnGroupTags = document.getElementById('group-by-tags');

  const removeGroupActiveClasses = () => {
    [btnGroupService, btnGroupRegion, btnGroupTags].forEach(btn => {
      if (btn) btn.className = 'px-3 py-1.5 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition-all';
    });
  };

  if (btnGroupService) {
    btnGroupService.addEventListener('click', () => {
      removeGroupActiveClasses();
      btnGroupService.className = 'px-3 py-1.5 text-xs font-bold rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-500 transition-all';
      currentDimension = 'service';
      if (dataSourceMode === 'api') {
        fetchRealAWSCostData();
      } else {
        updatePieChart();
      }
      showToast('Đã gom nhóm biểu đồ chi phí theo: Dịch vụ AWS', 'info');
    });
  }

  if (btnGroupRegion) {
    btnGroupRegion.addEventListener('click', () => {
      removeGroupActiveClasses();
      btnGroupRegion.className = 'px-3 py-1.5 text-xs font-bold rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-500 transition-all';
      currentDimension = 'region';
      if (dataSourceMode === 'api') {
        fetchRealAWSCostData();
      } else {
        updatePieChart();
      }
      showToast('Đã gom nhóm biểu đồ chi phí theo: Khu vực AWS (Region)', 'info');
    });
  }

  if (btnGroupTags) {
    btnGroupTags.addEventListener('click', () => {
      removeGroupActiveClasses();
      btnGroupTags.className = 'px-3 py-1.5 text-xs font-bold rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-500 transition-all';
      currentDimension = 'tags';
      if (dataSourceMode === 'api') {
        fetchRealAWSCostData();
      } else {
        updatePieChart();
      }
      showToast('Đã gom nhóm biểu đồ chi phí theo: Nhãn phân bổ (Cost Tag)', 'info');
    });
  }

  // Simulation Speed Buttons
  const speeds = [
    { id: 'sim-speed-off', val: 0 },
    { id: 'sim-speed-low', val: 5000 },
    { id: 'sim-speed-normal', val: 2000 },
    { id: 'sim-speed-high', val: 500 }
  ];

  speeds.forEach(sp => {
    const el = document.getElementById(sp.id);
    if (el) {
      el.addEventListener('click', () => {
        speeds.forEach(item => {
          const btn = document.getElementById(item.id);
          if (btn) btn.className = 'px-2 py-1.5 text-xs font-bold rounded-lg transition-all text-slate-500 hover:text-slate-300';
        });
        el.className = 'px-2 py-1.5 text-xs font-bold rounded-lg transition-all text-white bg-slate-800/80 shadow-md';
        
        simulatedSpeedMs = sp.val;
        startRealTimeStreaming();

        const indicator = document.getElementById('sim-indicator-status');
        if (indicator) {
          if (sp.val === 0) {
            indicator.textContent = 'PAUSED';
            indicator.className = 'text-slate-500';
            showToast('Đã tạm dừng Live API Cost Stream!', 'warning');
          } else {
            indicator.textContent = 'ACTIVE';
            indicator.className = 'text-emerald-400';
            showToast(`Tốc độ API Stream đổi sang: ${sp.id.split('-').pop().toUpperCase()}`, 'info');
          }
        }
      });
    }
  });

  // Anomaly Spike Generator Button
  const btnTriggerSpike = document.getElementById('btn-trigger-spike');
  const btnStopSpike = document.getElementById('btn-stop-spike');

  if (btnTriggerSpike) {
    btnTriggerSpike.addEventListener('click', () => {
      triggerCostSpikeLeak();
    });
  }

  if (btnStopSpike) {
    btnStopSpike.addEventListener('click', () => {
      resolveCostSpikeLeak();
    });
  }

  // Budget Limit Input Listener
  const budgetInput = document.getElementById('budget-input');
  if (budgetInput) {
    budgetInput.addEventListener('input', () => {
      updateBudgetUI();
    });
  }

  // Table Search and Filter
  const searchInput = document.getElementById('table-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => filterTableAndRebuild());
  }

  const statusFilter = document.getElementById('table-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => filterTableAndRebuild());
  }

  // Custom Granularity selector
  const selectGran = document.getElementById('time-granularity');
  if (selectGran) {
    selectGran.addEventListener('change', (e) => {
      showToast(`Độ phân giải thời gian AWS đổi sang: ${e.target.value.toUpperCase()}`, 'info');
    });
  }

  // Import Data Modal open/close handlers
  const btnOpenImport = document.getElementById('btn-open-import');
  const btnCloseImport = document.getElementById('btn-close-import');
  const btnCancelModal = document.getElementById('btn-cancel-modal');
  const modalImport = document.getElementById('modal-import');
  const formImport = document.getElementById('form-import');
  const btnLoadSample = document.getElementById('btn-load-sample');

  if (btnOpenImport && modalImport) {
    btnOpenImport.addEventListener('click', () => modalImport.classList.remove('hidden'));
  }
  
  const closeModalFn = () => {
    if (modalImport) modalImport.classList.add('hidden');
  };

  if (btnCloseImport) btnCloseImport.addEventListener('click', closeModalFn);
  if (btnCancelModal) btnCancelModal.addEventListener('click', closeModalFn);

  if (btnLoadSample) {
    btnLoadSample.addEventListener('click', () => {
      const sampleText = [
        { "name": "prod-api-ecs-task", "service": "Compute (ECS)", "provider": "aws", "cost": 38.40, "metricCpu": 52, "metricRam": 60, "status": "active", "region": "ap-southeast-1", "health": "healthy", "tags": "Env:Prod,Team:Web" },
        { "name": "dev-analytics-emr", "service": "Analytics (EMR)", "provider": "aws", "cost": 84.10, "metricCpu": 15, "metricRam": 42, "status": "idle", "region": "us-east-1", "health": "warning", "tags": "Env:Dev,Team:Data" },
        { "name": "prod-customer-aurora", "service": "Database (RDS)", "provider": "aws", "cost": 156.00, "metricCpu": 65, "metricRam": 82, "status": "active", "region": "ap-southeast-1", "health": "healthy", "tags": "Env:Prod,Team:Data" },
        { "name": "unattached-staging-ebs", "service": "Storage (EBS)", "provider": "aws", "cost": 12.00, "metricCpu": 0, "metricRam": 0, "status": "unused", "region": "us-east-1", "health": "danger", "tags": "Env:Staging,Team:Web" }
      ];
      const textarea = document.getElementById('import-text');
      if (textarea) textarea.value = JSON.stringify(sampleText, null, 2);
      showToast('Đã điền dữ liệu AWS Billing mẫu chuẩn.', 'info');
    });
  }

  if (formImport) {
    formImport.addEventListener('submit', (e) => {
      e.preventDefault();
      handleDataImport();
    });
  }

  // AWS Credentials Modal open/close/toggle/save handlers
  const btnOpenCreds = document.getElementById('btn-open-credentials');
  const modalCreds = document.getElementById('credentials-modal');
  const btnCloseCreds = document.getElementById('close-credentials-modal');
  const btnCancelCreds = document.getElementById('btn-cancel-credentials');
  const btnSaveCreds = document.getElementById('btn-save-credentials');
  const toggleVisibility = document.getElementById('toggle-secret-visibility');
  const inputSecret = document.getElementById('input-aws-secret-access-key');

  if (btnOpenCreds && modalCreds) {
    btnOpenCreds.addEventListener('click', () => {
      modalCreds.classList.remove('hidden');
      setTimeout(() => {
        modalCreds.classList.remove('opacity-0');
        modalCreds.querySelector('.glass-panel').classList.remove('scale-95');
      }, 50);
    });
  }

  const closeCredsModalFn = () => {
    if (modalCreds) {
      modalCreds.classList.add('opacity-0');
      modalCreds.querySelector('.glass-panel').classList.add('scale-95');
      setTimeout(() => {
        modalCreds.classList.add('hidden');
      }, 300);
    }
  };

  if (btnCloseCreds) btnCloseCreds.addEventListener('click', closeCredsModalFn);
  if (btnCancelCreds) btnCancelCreds.addEventListener('click', closeCredsModalFn);

  // Close modal when clicking outside
  if (modalCreds) {
    modalCreds.addEventListener('click', (e) => {
      if (e.target === modalCreds) closeCredsModalFn();
    });
  }

  // Toggle secret visibility
  if (toggleVisibility && inputSecret) {
    toggleVisibility.addEventListener('click', () => {
      const isPassword = inputSecret.getAttribute('type') === 'password';
      inputSecret.setAttribute('type', isPassword ? 'text' : 'password');
      
      const icon = toggleVisibility.querySelector('i');
      if (icon) {
        if (isPassword) {
          icon.setAttribute('data-lucide', 'eye-off');
        } else {
          icon.setAttribute('data-lucide', 'eye');
        }
        lucide.createIcons(); // refresh icon
      }
    });
  }

  // Save Credentials handle
  if (btnSaveCreds) {
    btnSaveCreds.addEventListener('click', async () => {
      const accessKeyId = document.getElementById('input-aws-access-key-id')?.value || '';
      const secretAccessKey = inputSecret?.value || '';
      const sessionToken = document.getElementById('input-aws-session-token')?.value || '';

      if (!accessKeyId || !secretAccessKey) {
        showToast('Vui lòng điền đầy đủ Access Key ID và Secret Access Key!', 'warning');
        return;
      }

      // Show loading indicator
      btnSaveCreds.disabled = true;
      const originalBtnText = btnSaveCreds.innerHTML;
      btnSaveCreds.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Đang xác thực...</span>`;
      lucide.createIcons();

      try {
        const res = await fetch('http://localhost:3003/api/credentials', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            accessKeyId,
            secretAccessKey,
            sessionToken
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Lỗi cập nhật credentials');

        showToast(data.message, 'success');
        closeCredsModalFn();

        // Automatically switch datasource mode to API and fetch fresh data
        dataSourceMode = 'api';
        await fetchRealAWSCostData();

      } catch (err) {
        showToast(`Kết nối thất bại: ${err.message}`, 'danger');
      } finally {
        btnSaveCreds.disabled = false;
        btnSaveCreds.innerHTML = originalBtnText;
        lucide.createIcons();
      }
    });
  }

  // Export Buttons
  const btnExportCSV = document.getElementById('btn-export-csv');
  if (btnExportCSV) {
    btnExportCSV.addEventListener('click', exportToCSV);
  }

  const btnExportPDF = document.getElementById('btn-export-pdf');
  if (btnExportPDF) {
    btnExportPDF.addEventListener('click', () => {
      showToast('Đang biên dịch tệp PDF báo cáo AWS Cost Explorer...', 'info');
      setTimeout(() => {
        window.print();
      }, 1000);
    });
  }

  // Reset Data Option
  const btnReset = document.getElementById('btn-reset-data');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (confirm('Bạn có muốn khôi phục dữ liệu AWS Cost Explorer mặc định không? Giao dịch trực tiếp sẽ reset.')) {
        cloudData = [...INITIAL_AWS_RESOURCES];
        localStorage.setItem('aws_cost_data', JSON.stringify(cloudData));
        localStorage.setItem('aws_recommendations', JSON.stringify(INITIAL_RECOMMENDATIONS));
        
        todayCost = 445.47;
        monthToDateCost = 93548.62;
        totalAnomalies = 0;
        
        if (isSpikeActive) {
          resolveCostSpikeLeak();
        }

        stopCloudTrailPolling();

        renderDashboard();
        
        // Reset scrolling trend chart
        liveTrendLabels = [];
        liveTrendData = [];
        initCharts();

        showToast('Đã thiết lập lại dữ liệu AWS gốc thành công!', 'success');
      }
    });
  }
}

// Start/Stop Real-time cost generator interval
function startRealTimeStreaming() {
  if (simTimer) clearInterval(simTimer);
  
  if (simulatedSpeedMs === 0) return; // Sim turned off

  simTimer = setInterval(() => {
    generateLiveCostTransaction();
  }, simulatedSpeedMs);
}

// Start live second currency ticker based on hourly calculation of active services
function startLiveSecondTicker() {
  if (liveSecondTimer) clearInterval(liveSecondTimer);

  // 1. Calculate the total hourly burn rate of all active services from our cloud resources
  let totalHourlyRate = 0;
  cloudData.forEach(item => {
    if (item.status === 'stopped' || item.status === 'unused') return;
    totalHourlyRate += (item.cost || 0) / 24;
  });

  // If no services are active or rate is 0, fallback to standard average burn rate based on apiTodayCost
  if (totalHourlyRate === 0) {
    const todayBase = apiTodayCost || 445.47;
    totalHourlyRate = todayBase / 24;
  }

  const burnRatePerSecond = totalHourlyRate / 3600;

  // 2. Calculate current elapsed hours since 00:00:00 local time (including fractional minutes/seconds)
  const now = new Date();
  const hoursPassedToday = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;

  // 3. Establish today's running cost starting point: (Total Hourly Rate) * (Hours Passed Today)
  todayCost = totalHourlyRate * hoursPassedToday;

  liveSecondTimer = setInterval(() => {
    // Increment today's running cost and monthly cumulative in unison
    todayCost += burnRatePerSecond;
    monthToDateCost += burnRatePerSecond;

    // Trigger visual update with 5 decimals for vivid movement effect on Today KPI Card
    const todayValEl = document.getElementById('kpi-today-cost');
    if (todayValEl) {
      todayValEl.textContent = `$${todayCost.toFixed(5)}`;
      
      // Flash the live text to indicate active streaming billing activity
      todayValEl.classList.add('text-brand-400');
      setTimeout(() => todayValEl.classList.remove('text-brand-400'), 150);
    }

    // Update Month-to-Date total cost card in unison
    const totalValEl = document.getElementById('kpi-total-cost');
    if (totalValEl) {
      totalValEl.textContent = `$${monthToDateCost.toFixed(2)}`;
    }

    // Refresh forecasting KPIs and VND localizations
    updateForecastKPI();
    updateBudgetUI();
  }, 1000);
}

// Generate live transaction event and accrue AWS costs
function generateLiveCostTransaction() {
  // Select active templates
  const pool = isSpikeActive ? ANOMALY_ACTIVITY_TEMPLATES : LIVE_ACTIVITY_TEMPLATES;
  const tpl = pool[Math.floor(Math.random() * pool.length)];

  // Calculate random fractional cost
  const calculatedCost = Math.random() * (tpl.maxCost - tpl.minCost) + tpl.minCost;
  const costStr = calculatedCost.toFixed(5);

  // Accrue costs
  todayCost += calculatedCost;
  monthToDateCost += calculatedCost;

  // Build log text
  const timeStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  const logMsg = tpl.template.replace('${cost}', costStr);
  
  // Append to console log element
  appendLogConsole(timeStr, logMsg, isSpikeActive);

  // Trigger ticker effect on Today Cost KPI
  const todayValEl = document.getElementById('kpi-today-cost');
  if (todayValEl) {
    todayValEl.textContent = `$${todayCost.toFixed(3)}`;
    todayValEl.classList.remove('digital-ticker-active');
    void todayValEl.offsetWidth; // Reflow trigger for css animation
    todayValEl.classList.add('digital-ticker-active');
  }

  // Update cumulative month cost
  const totalValEl = document.getElementById('kpi-total-cost');
  if (totalValEl) {
    totalValEl.textContent = `$${monthToDateCost.toFixed(2)}`;
  }

  // Update dynamic monthly forecasts and VND localizations
  updateForecastKPI();

  // Update budget indicators
  updateBudgetUI();

  // Handle dynamic additions to the real-time scrolling line chart
  addRealTimePointToChart(calculatedCost);
}

// Update Forecast KPI values and dynamically calculate real-time VND localizations
function updateForecastKPI() {
  const EXCHANGE_RATE_USD_VND = 25400; // Benchmark rate

  // 1. Calculate yearly dynamic forecast based on actual elapsed days from 01/01/2026
  const startObj = new Date("2026-01-01");
  const endObj = new Date();
  const diffDays = Math.ceil(Math.abs(endObj - startObj) / (1000 * 60 * 60 * 24)) || 1;

  // Linear Yearly Forecast = (currentTotal / diffDays) * 365
  let forecastVal = (monthToDateCost / diffDays) * 365;

  if (forecastVal < monthToDateCost) {
    forecastVal = monthToDateCost * 1.05;
  }

  // 2. Update Forecasted Yearly Card UI
  const forecastEl = document.getElementById('kpi-forecast-cost');
  if (forecastEl) {
    forecastEl.textContent = `$${forecastVal.toFixed(2)}`;
  }
  const forecastVndEl = document.getElementById('kpi-forecast-cost-vnd');
  if (forecastVndEl) {
    const fVnd = forecastVal * EXCHANGE_RATE_USD_VND;
    forecastVndEl.textContent = `~${Math.round(fVnd).toLocaleString('vi-VN')} VND`;
  }

  // 3. Update Total Accrued Month-to-date (MTD) VND localization
  const totalVndEl = document.getElementById('kpi-total-cost-vnd');
  if (totalVndEl) {
    const tVnd = monthToDateCost * EXCHANGE_RATE_USD_VND;
    totalVndEl.textContent = `~${Math.round(tVnd).toLocaleString('vi-VN')} VND`;
  }

  // 4. Update Today Cost VND localization
  const todayVndEl = document.getElementById('kpi-today-cost-vnd');
  if (todayVndEl) {
    const tTodayVnd = todayCost * EXCHANGE_RATE_USD_VND;
    todayVndEl.textContent = `~${Math.round(tTodayVnd).toLocaleString('vi-VN')} VND`;
  }
}

// Append messages to the rolling liveactivity console
function appendLogConsole(timeStr, msg, isAnomaly) {
  const consoleEl = document.getElementById('live-log-console');
  if (!consoleEl) return;

  // Remove placeholder
  if (consoleEl.innerHTML.includes('Hệ thống đang sẵn sàng')) {
    consoleEl.innerHTML = '';
  }

  const logItem = document.createElement('div');
  logItem.className = `live-log-item ${isAnomaly ? 'anomaly-log' : ''}`;
  logItem.innerHTML = `<span class="text-slate-500">[${timeStr}]</span> ${msg}`;

  consoleEl.appendChild(logItem);

  // Keep console under 40 logs to prevent memory leaks
  if (consoleEl.children.length > 40) {
    consoleEl.removeChild(consoleEl.firstChild);
  }

  // Scroll to bottom
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// Generate Cost Leak Anomaly Spike
function triggerCostSpikeLeak() {
  if (isSpikeActive) return;

  isSpikeActive = true;
  totalAnomalies += 1;

  // Enhance speed to maximum during cost leak to visualize impact
  simulatedSpeedMs = 400; // super fast stream
  startRealTimeStreaming();

  // Sync simulator speed buttons
  const speedsIds = ['sim-speed-off', 'sim-speed-low', 'sim-speed-normal', 'sim-speed-high'];
  speedsIds.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.className = 'px-2 py-1.5 text-xs font-bold rounded-lg transition-all text-slate-500 hover:text-slate-300';
  });
  const btnHigh = document.getElementById('sim-speed-high');
  if (btnHigh) btnHigh.className = 'px-2 py-1.5 text-xs font-bold rounded-lg transition-all text-white bg-slate-800/80 shadow-md';

  // Toggle control state buttons
  const btnTrigger = document.getElementById('btn-trigger-spike');
  if (btnTrigger) btnTrigger.disabled = true;
  const btnStop = document.getElementById('btn-stop-spike');
  if (btnStop) btnStop.disabled = false;

  // Update Anomaly alert card (Glow active pulse, change icon, text)
  const alertCard = document.getElementById('kpi-alert-card');
  if (alertCard) {
    alertCard.classList.add('anomaly-pulse-active', 'border-rose-500/40');
  }
  const alertsCount = document.getElementById('kpi-alerts');
  if (alertsCount) {
    alertsCount.textContent = totalAnomalies.toString();
    alertsCount.className = 'text-3xl font-extrabold text-rose-500 mt-1.5 tracking-tight';
  }
  const alertIconContainer = document.getElementById('kpi-alert-icon-container');
  if (alertIconContainer) {
    alertIconContainer.className = 'p-3 bg-rose-500/20 text-rose-400 rounded-xl animate-bounce';
  }
  const alertSubtext = document.getElementById('kpi-alert-subtext');
  if (alertSubtext) {
    alertSubtext.className = 'flex items-center gap-1.5 mt-3.5 text-xs font-semibold text-rose-400 bg-rose-500/10 px-2 py-1 rounded-lg w-max';
    alertSubtext.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-500"></i><span>RÒ RỈ CHI PHÍ ĐANG DIỄN RA!</span>`;
    lucide.createIcons();
  }

  // Inject a critical AI recommendation
  const recs = getRecommendations();
  const criticalRec = {
    id: 'rec-anomaly-spike',
    title: 'KHẨN CẤP: Ngăn chặn S3 / Lambda Spillover',
    description: 'Tài nguyên trong us-east-1 đang bị kích hoạt vòng lặp vô tận. Nhấp "Apply Fix" ngay để vá cấu hình IAM.',
    impact: 'Tiết kiệm ~$320.00/giờ',
    savingVal: 320.00,
    service: 'Compute (ECS)',
    resourceId: 'res-aws-spike',
    severity: 'critical'
  };

  // Prepend critical recommendation
  recs.unshift(criticalRec);
  saveRecommendations(recs);
  renderRecommendations();

  showToast('PHÁT HIỆN SỰ CỐ BẤT THƯỜNG: Lưu lượng AWS rò rỉ tăng đột biến!', 'danger');
}

// Stop/Resolve Cost Leak Spike
function resolveCostSpikeLeak() {
  if (!isSpikeActive) return;

  isSpikeActive = false;
  simulatedSpeedMs = 2000; // Switch back to normal speed
  startRealTimeStreaming();

  // Sync simulator speed buttons
  const speedsIds = ['sim-speed-off', 'sim-speed-low', 'sim-speed-normal', 'sim-speed-high'];
  speedsIds.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.className = 'px-2 py-1.5 text-xs font-bold rounded-lg transition-all text-slate-500 hover:text-slate-300';
  });
  const btnNormal = document.getElementById('sim-speed-normal');
  if (btnNormal) btnNormal.className = 'px-2 py-1.5 text-xs font-bold rounded-lg transition-all text-white bg-slate-800/80 shadow-md';

  // Toggle buttons disabled state
  const btnTrigger = document.getElementById('btn-trigger-spike');
  if (btnTrigger) btnTrigger.disabled = false;
  const btnStop = document.getElementById('btn-stop-spike');
  if (btnStop) btnStop.disabled = true;

  // Restore Alert Card state
  const alertCard = document.getElementById('kpi-alert-card');
  if (alertCard) {
    alertCard.className = 'glass-panel p-5 rounded-2xl relative overflow-hidden animate-fade-in-up delay-3 transition-all duration-300';
  }
  const alertsCount = document.getElementById('kpi-alerts');
  if (alertsCount) {
    alertsCount.textContent = '0';
    alertsCount.className = 'text-3xl font-extrabold text-slate-300 mt-1.5 tracking-tight';
    totalAnomalies = 0;
  }
  const alertIconContainer = document.getElementById('kpi-alert-icon-container');
  if (alertIconContainer) {
    alertIconContainer.className = 'p-3 bg-slate-800 text-slate-400 rounded-xl';
  }
  const alertSubtext = document.getElementById('kpi-alert-subtext');
  if (alertSubtext) {
    alertSubtext.className = 'flex items-center gap-1.5 mt-3.5 text-xs font-semibold text-slate-400 bg-slate-900/60 px-2 py-1 rounded-lg w-max';
    alertSubtext.innerHTML = `<i data-lucide="shield" class="w-3.5 h-3.5 text-emerald-400"></i><span>Hệ thống an toàn</span>`;
    lucide.createIcons();
  }

  // Clean critical recommendations
  let recs = getRecommendations();
  recs = recs.filter(r => r.id !== 'rec-anomaly-spike');
  saveRecommendations(recs);
  renderRecommendations();

  showToast('Đã vá cấu hình hạ tầng AWS! Chi phí đang trở lại ổn định.', 'success');
}

// Add data points on scrolling real-time line chart
function addRealTimePointToChart(newCost) {
  // If we show Top 5 services Monthly comparison, we simply refresh the columns
  updateTrendChart();
}

// Utility: Map list of labels dynamically to contrast-rich, unique premium AWS colors with ZERO duplicates
function getUniqueColorsForLabels(labels) {
  const PREMIUM_UNIQUE_COLORS = [
    '#ff9900', // 1. AWS Orange (EC2)
    '#3b82f6', // 2. RDS Blue (RDS)
    '#10b981', // 3. S3 Emerald Green (S3)
    '#a855f7', // 4. Route 53 Purple (Route 53)
    '#ec4899', // 5. VPC Pink (VPC)
    '#06b6d4', // 6. EBS Cyan (EBS)
    '#f97316', // 7. Lambda Neon Orange (Lambda)
    '#4f46e5', // 8. DynamoDB Deep Indigo (DynamoDB)
    '#eab308', // 9. Cost Explorer Gold (Cost Explorer)
    '#f43f5e', // 10. CloudTrail Rose Red (CloudTrail)
    '#059669', // 11. CloudWatch Forest Green (CloudWatch)
    '#db2777', // 12. KMS Hot Pink (KMS)
    '#14b8a6', // 13. Support Turquoise Teal (Support)
    '#0ea5e9', // 14. Sky Blue
    '#84cc16', // 15. Lime Green
    '#64748b'  // 16. Slate Gray
  ];

  const assignedColors = [];
  const usedIndexes = new Set();

  labels.forEach((label, idx) => {
    const lower = label.toLowerCase();
    let colorIndex = -1;

    // Direct and fuzzy matching for iconic brand identity
    if (lower.includes('ec2') || lower.includes('elastic compute')) {
      colorIndex = 0; // Cam
    } else if (lower.includes('rds') || lower.includes('database')) {
      colorIndex = 1; // Xanh dương
    } else if (lower.includes('s3') || lower.includes('storage')) {
      colorIndex = 2; // Xanh ngọc
    } else if (lower.includes('route')) {
      colorIndex = 3; // Tím
    } else if (lower.includes('vpc')) {
      colorIndex = 4; // Hồng
    } else if (lower.includes('ebs')) {
      colorIndex = 5; // Xanh mòng két
    } else if (lower.includes('lambda')) {
      colorIndex = 6; // Cam Neon
    } else if (lower.includes('dynamo')) {
      colorIndex = 7; // Indigo
    } else if (lower.includes('cost')) {
      colorIndex = 8; // Vàng
    } else if (lower.includes('trail')) {
      colorIndex = 9; // Đỏ hồng
    } else if (lower.includes('watch')) {
      colorIndex = 10; // Xanh lá đậm
    } else if (lower.includes('kms')) {
      colorIndex = 11; // Hồng đậm
    } else if (lower.includes('support')) {
      colorIndex = 12; // Xanh ngọc lam
    }

    // Guard: If brand color is already taken by an earlier service, or not found, allocate the first free color
    if (colorIndex === -1 || usedIndexes.has(colorIndex)) {
      for (let i = 0; i < PREMIUM_UNIQUE_COLORS.length; i++) {
        if (!usedIndexes.has(i)) {
          colorIndex = i;
          break;
        }
      }
    }

    // Ultimate fallback (Modulo indexing)
    if (colorIndex === -1) {
      colorIndex = idx % PREMIUM_UNIQUE_COLORS.length;
    }

    usedIndexes.add(colorIndex);
    assignedColors.push(PREMIUM_UNIQUE_COLORS[colorIndex]);
  });

  return assignedColors;
}

// Update the monthly cost comparison chart for the Top 5 most expensive services
function updateTrendChart() {
  if (!chartCostTrend) return;

  let serviceCosts = {};

  if (dataSourceMode === 'api' && realAWSPieData) {
    // API Mode: Use direct AWS Cost Explorer current month data, fallback to yearly grouping data
    serviceCosts = realAWSPieDataCurrentMonth || { ...realAWSPieData };
  } else {
    // Simulator Mode: Aggregate monthly costs from cloudData
    cloudData.forEach(item => {
      // In simulator, cloudData items represent resources, each has item.service and item.cost (daily)
      // Let's calculate estimated monthly cost (daily cost * 30 days) to match monthly comparison
      if (item.status === 'stopped' || item.status === 'unused') return;
      const serviceName = item.service || 'Other';
      const monthlyEst = item.cost * 30; // 30-day accumulation
      serviceCosts[serviceName] = (serviceCosts[serviceName] || 0) + monthlyEst;
    });
  }

  // Sort services by cost in descending order and slice the Top 8
  const sortedServices = Object.entries(serviceCosts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const labels = sortedServices.map(entry => {
    // Clean and shorten service names for clean layout
    return entry[0]
      .replace('Amazon ', '')
      .replace('AWS ', '')
      .replace('Elastic Compute Cloud', 'EC2')
      .replace('Relational Database Service', 'RDS')
      .replace('Simple Storage Service', 'S3')
      .replace('Elastic Block Store', 'EBS')
      .replace('Container Service', 'ECS');
  });

  const data = sortedServices.map(entry => entry[1]);

  // Map each service in Top 5 dynamically to its unique AWS brand color without any overlaps!
  const backgroundColors = getUniqueColorsForLabels(sortedServices.map(entry => entry[0]));

  const labelStr = dataSourceMode === 'api' ? 'Chi phí tích lũy tháng ($ USD)' : 'Ước tính chi phí theo tháng ($ USD)';

  chartCostTrend.data.labels = labels;
  chartCostTrend.data.datasets[0].label = labelStr;
  chartCostTrend.data.datasets[0].data = data;
  chartCostTrend.data.datasets[0].backgroundColor = backgroundColors;
  chartCostTrend.data.datasets[0].hoverBackgroundColor = backgroundColors;
  chartCostTrend.update();
}

// Update Budget UI and alerts
function updateBudgetUI() {
  const budgetInput = document.getElementById('budget-input');
  if (!budgetInput) return;

  const limit = parseFloat(budgetInput.value) || 1200;
  const spent = monthToDateCost;
  const percentage = Math.min((spent / limit) * 100, 100);

  // Update UI Spent strings
  const spentText = document.getElementById('budget-spent-text');
  if (spentText) {
    spentText.textContent = `Đã tiêu: $${spent.toFixed(2)} (${percentage.toFixed(1)}%)`;
  }

  const remainingText = document.getElementById('budget-remaining-text');
  if (remainingText) {
    const remaining = Math.max(limit - spent, 0);
    remainingText.textContent = `Còn lại: $${remaining.toFixed(2)}`;
  }

  // Adjust bar width and dynamic gradients
  const progressBar = document.getElementById('budget-progress');
  if (progressBar) {
    progressBar.style.width = `${percentage}%`;

    // Swap color classes depending on usage range
    if (percentage < 75) {
      progressBar.className = 'bg-gradient-to-r from-emerald-500 to-green-400 h-full rounded-full transition-all duration-300';
    } else if (percentage >= 75 && percentage < 100) {
      progressBar.className = 'bg-gradient-to-r from-amber-500 to-orange-400 h-full rounded-full transition-all duration-300';
    } else {
      progressBar.className = 'bg-gradient-to-r from-red-600 to-rose-500 h-full rounded-full transition-all duration-300 animate-pulse';
    }
  }

  // Throw automated toast alert once budget is surpassed
  if (spent > limit && !budgetInput.dataset.alerted) {
    showToast(`AWS ALERT: Ngân sách đã đặt ra ($${limit}) đã bị vượt quá!`, 'danger');
    budgetInput.dataset.alerted = 'true';
  } else if (spent <= limit) {
    delete budgetInput.dataset.alerted;
  }
}

// Init visual charts using Chart.js with high aesthetic properties
function initCharts() {
  // 1. Top 5 Services Cost Comparison Bar Chart
  const trendCtx = document.getElementById('chart-cost-trend')?.getContext('2d');
  if (trendCtx) {
    if (chartCostTrend) chartCostTrend.destroy();

    chartCostTrend = new Chart(trendCtx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: '',
          data: [],
          backgroundColor: [],
          borderColor: 'rgba(255, 255, 255, 0.05)',
          borderWidth: 1,
          borderRadius: { topLeft: 6, topRight: 6 },
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                const val = context.parsed.y;
                return `Tổng chi phí tháng này: $${val.toFixed(2)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.03)' },
            ticks: { color: '#94a3b8', font: { size: 10, weight: 'bold' } }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.03)' },
            ticks: { 
              color: '#94a3b8', 
              font: { size: 10 },
              callback: function(value) {
                return '$' + value;
              }
            }
          }
        }
      }
    });
    updateTrendChart();
  }

  // 2. Pie Chart (Cost distribution)
  const pieCtx = document.getElementById('chart-cost-distribution')?.getContext('2d');
  if (pieCtx) {
    if (chartCostDistribution) chartCostDistribution.destroy();
    chartCostDistribution = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: [
            '#ff9900', // AWS Orange
            '#3b82f6', // Azure Blue-ish
            '#10b981', // GCP Emerald
            '#a855f7', // Purple
            '#f43f5e', // Rose
            '#eab308'  // Amber
          ],
          borderWidth: 1,
          borderColor: '#0a0e21'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#94a3b8', font: { size: 10, weight: 'bold' }, padding: 10 }
          }
        }
      }
    });
    updatePieChart();
  }

  // 3. Utilization Bar Chart
  const utilCtx = document.getElementById('chart-utilization')?.getContext('2d');
  if (utilCtx) {
    if (chartUtilization) chartUtilization.destroy();
    chartUtilization = new Chart(utilCtx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Avg CPU %',
            data: [],
            backgroundColor: 'rgba(255, 153, 0, 0.75)',
            borderRadius: 6
          },
          {
            label: 'Avg RAM %',
            data: [],
            backgroundColor: 'rgba(99, 102, 241, 0.6)',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#94a3b8', font: { size: 10 } }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#64748b', font: { size: 9 } }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.03)' },
            min: 0,
            max: 100,
            ticks: { color: '#64748b', font: { size: 9 } }
          }
        }
      }
    });
    updateUtilizationChart();
  }
}

// Update the distribution Doughnut chart based on Dimension
function updatePieChart() {
  if (!chartCostDistribution) return;

  let labels = [];
  let data = [];

  if (dataSourceMode === 'api' && realAWSPieData) {
    // Use the direct real-time AWS API Cost Explorer grouping data
    labels = Object.keys(realAWSPieData);
    data = Object.values(realAWSPieData);
  } else {
    // Simulator/Fallback logic
    const dataMap = {};
    cloudData.forEach(item => {
      if (item.status === 'stopped' || item.status === 'unused') return;

      let key = '';
      if (currentDimension === 'service') {
        key = item.service;
      } else if (currentDimension === 'region') {
        key = item.region;
      } else if (currentDimension === 'tags') {
        key = (item.tags && item.tags.split(',')[0]) || 'Untagged';
      }

      dataMap[key] = (dataMap[key] || 0) + item.cost;
    });

    labels = Object.keys(dataMap);
    data = Object.values(dataMap);
  }

  // Map consistent colors based on label naming - ensuring high distinctiveness and ZERO duplicates!
  const backgroundColors = getUniqueColorsForLabels(labels);

  // Sync title text
  const pieTitle = document.getElementById('chart-pie-title');
  if (pieTitle) {
    const term = currentDimension === 'service' ? 'dịch vụ' : (currentDimension === 'region' ? 'khu vực (region)' : 'thẻ phân loại (tags)');
    pieTitle.textContent = `Phân bổ chi phí AWS theo ${term}`;
  }

  chartCostDistribution.data.labels = labels;
  chartCostDistribution.data.datasets[0].data = data;
  chartCostDistribution.data.datasets[0].backgroundColor = backgroundColors;
  chartCostDistribution.update();
}

// Update Server Performance Utilization bar chart
function updateUtilizationChart() {
  if (!chartUtilization) return;

  // Filter only instances with metric properties
  const activeCompute = cloudData.filter(item => 
    item.service.includes('Compute') && item.status === 'active'
  );

  const labels = activeCompute.map(item => item.name);
  const cpuData = activeCompute.map(item => item.metricCpu);
  const ramData = activeCompute.map(item => item.metricRam);

  chartUtilization.data.labels = labels;
  chartUtilization.data.datasets[0].data = cpuData;
  chartUtilization.data.datasets[1].data = ramData;
  chartUtilization.update();
}

// Main Render Function for dashboards, lists
function renderDashboard() {
  filterTableAndRebuild();
  renderRecommendations();
  updateBudgetUI();
  updatePieChart();
  updateUtilizationChart();

  // Dynamic forecast calculations and VND localizations
  updateForecastKPI();

  lucide.createIcons();
}

// Filter, Sort and Render Resources Table
function filterTableAndRebuild() {
  const searchQuery = document.getElementById('table-search')?.value.toLowerCase() || '';
  const statusValue = document.getElementById('table-status-filter')?.value || 'all';

  const filtered = cloudData.filter(item => {
    // Check search query
    const matchesSearch = item.name.toLowerCase().includes(searchQuery) || 
                          item.service.toLowerCase().includes(searchQuery) ||
                          item.region.toLowerCase().includes(searchQuery);
    // Check status
    const matchesStatus = (statusValue === 'all' || item.status === statusValue || 
                           (statusValue === 'anomaly' && item.health !== 'healthy'));

    return matchesSearch && matchesStatus;
  });

  renderTable(filtered);
}

// Build table HTML elements dynamically
function renderTable(data) {
  const tbody = document.getElementById('resource-table-body');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="px-4 py-8 text-center text-slate-500 italic">
          Không tìm thấy tài nguyên AWS nào khớp với bộ lọc.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = data.map(item => {
    // Badges depending on values
    let healthBadge = '';
    if (item.health === 'healthy') {
      healthBadge = `<span class="px-2.5 py-1 text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg">Healthy</span>`;
    } else if (item.health === 'warning') {
      healthBadge = `<span class="px-2.5 py-1 text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg">Warning</span>`;
    } else {
      healthBadge = `<span class="px-2.5 py-1 text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg">Danger</span>`;
    }

    let statusBadge = '';
    if (item.status === 'active') {
      statusBadge = `<span class="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Running</span>`;
    } else if (item.status === 'stopped') {
      statusBadge = `<span class="flex items-center gap-1.5 text-xs text-slate-400 font-semibold"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>Stopped</span>`;
    } else if (item.status === 'idle') {
      statusBadge = `<span class="flex items-center gap-1.5 text-xs text-amber-400 font-semibold"><span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>Idle</span>`;
    } else {
      statusBadge = `<span class="flex items-center gap-1.5 text-xs text-red-400 font-semibold"><span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>Unused</span>`;
    }

    // Progress bar for performance metrics
    const cpuBar = item.metricCpu > 0 ? `
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold w-7">${item.metricCpu}%</span>
        <div class="w-16 bg-slate-900 rounded-full h-1.5 overflow-hidden">
          <div class="bg-brand-500 h-full" style="width: ${item.metricCpu}%"></div>
        </div>
      </div>
    ` : '<span class="text-slate-500 text-xs">-</span>';

    const ramBar = item.metricRam > 0 ? `
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold w-7">${item.metricRam}%</span>
        <div class="w-16 bg-slate-900 rounded-full h-1.5 overflow-hidden">
          <div class="bg-indigo-400 h-full" style="width: ${item.metricRam}%"></div>
        </div>
      </div>
    ` : '<span class="text-slate-500 text-xs">-</span>';

    return `
      <tr class="border-b border-slate-900/30 hover:bg-slate-900/10 transition-colors">
        <td class="px-4 py-4.5">
          <div class="font-extrabold text-slate-200">${item.name}</div>
          <div class="text-[10px] text-slate-500 font-mono mt-0.5">${item.id}</div>
          ${item.warning ? `<p class="text-[11px] text-amber-400/90 mt-1 flex items-start gap-1 font-semibold leading-relaxed bg-amber-500/5 p-1.5 rounded border border-amber-500/10"><i data-lucide="info" class="w-3.5 h-3.5 shrink-0 mt-0.5"></i>${item.warning}</p>` : ''}
        </td>
        <td class="px-4 py-4.5">
          <div class="text-xs font-bold text-slate-400 flex items-center gap-1">
            <span class="w-1 h-3 bg-brand-500 rounded-full"></span>
            AWS
          </div>
        </td>
        <td class="px-4 py-4.5 font-mono text-xs text-slate-400">${item.region}</td>
        <td class="px-4 py-4.5">${statusBadge}</td>
        <td class="px-4 py-4.5">${cpuBar}</td>
        <td class="px-4 py-4.5">${ramBar}</td>
        <td class="px-4 py-4.5 text-right font-extrabold text-slate-100">$${item.cost.toFixed(2)}</td>
        <td class="px-4 py-4.5 text-right">${healthBadge}</td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

// Render optimization recommendations dynamically
function renderRecommendations() {
  const container = document.getElementById('recommendations-container');
  if (!container) return;

  const recs = getRecommendations();

  if (recs.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-500 italic bg-slate-950/20 border border-slate-900 rounded-xl">
        Tuyệt vời! Không phát hiện cơ hội lãng phí chi phí nào vào lúc này.
      </div>
    `;
    return;
  }

  container.innerHTML = recs.map(rec => {
    let severityClass = '';
    let icon = 'shield-alert';
    
    if (rec.severity === 'critical') {
      severityClass = 'border-red-500/30 bg-red-500/[0.03] hover:border-red-500/50';
      icon = 'alert-triangle';
    } else if (rec.severity === 'high') {
      severityClass = 'border-rose-500/20 bg-rose-500/[0.01] hover:border-rose-500/40';
      icon = 'alert-circle';
    } else if (rec.severity === 'medium') {
      severityClass = 'border-amber-500/20 bg-amber-500/[0.01] hover:border-amber-500/40';
      icon = 'info';
    } else {
      severityClass = 'border-slate-800/80 bg-slate-950/10 hover:border-slate-700/80';
      icon = 'shield';
    }

    return `
      <div id="card-${rec.id}" class="p-4 rounded-xl border ${severityClass} flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300">
        <div class="flex items-start gap-3.5">
          <div class="p-2.5 rounded-xl shrink-0 ${rec.severity === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-slate-900 text-slate-300'}">
            <i data-lucide="${icon}" class="w-5 h-5"></i>
          </div>
          <div>
            <h5 class="font-extrabold text-slate-200 text-sm flex items-center gap-2 flex-wrap">
              <span>${rec.title}</span>
              <span class="px-2 py-0.5 text-[9px] uppercase font-extrabold rounded-md ${rec.severity === 'critical' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-slate-800 text-slate-400 border border-slate-700'}">${rec.severity}</span>
            </h5>
            <p class="text-xs text-slate-400 mt-1 leading-relaxed">${rec.description}</p>
            <div class="flex items-center gap-1.5 mt-2.5 text-xs font-bold text-emerald-400">
              <i data-lucide="piggy-bank" class="w-3.5 h-3.5"></i>
              <span>Tác động: ${rec.impact}</span>
            </div>
          </div>
        </div>
        
        <button onclick="applyCostOptimization('${rec.id}', ${rec.savingVal}, '${rec.resourceId}')" class="px-4 py-2 bg-slate-950/60 hover:bg-brand-500 hover:text-white border border-slate-800 hover:border-brand-500 text-slate-300 rounded-xl text-xs font-extrabold transition-all shrink-0">
          Apply Fix
        </button>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// Global scope callable function to resolve recommendations instantly
window.applyCostOptimization = function(recId, savingVal, resourceId) {
  const card = document.getElementById(`card-${recId}`);
  if (!card) return;

  // Visual shrink effect
  card.classList.add('recommendation-optimized');

  showToast(`Đang thực hiện quy trình tự động hóa tối ưu cho tài nguyên...`, 'info');

  setTimeout(() => {
    // 1. Remove recommendation from active list
    let recs = getRecommendations();
    recs = recs.filter(r => r.id !== recId);
    saveRecommendations(recs);

    // 2. Adjust financial records (Subtract wastage)
    monthToDateCost = Math.max(monthToDateCost - (savingVal * 5), 10.00); 
    todayCost = Math.max(todayCost - savingVal, 1.00);

    // Sync financial tickers immediately
    const todayValEl = document.getElementById('kpi-today-cost');
    if (todayValEl) todayValEl.textContent = `$${todayCost.toFixed(3)}`;
    const totalValEl = document.getElementById('kpi-total-cost');
    if (totalValEl) totalValEl.textContent = `$${monthToDateCost.toFixed(2)}`;

    // 3. Alter corresponding resource state in Table
    cloudData = cloudData.map(item => {
      if (item.id === resourceId) {
        // Upgrade resource status
        if (item.status === 'unused') {
          return null; // delete completely
        } else if (item.status === 'idle') {
          return {
            ...item,
            cost: item.cost * 0.35, 
            status: 'active',
            health: 'healthy',
            warning: '',
            metricCpu: 28, 
            metricRam: 35
          };
        }
      }
      return item;
    }).filter(Boolean); 

    // Save modified resource structure
    localStorage.setItem('aws_cost_data', JSON.stringify(cloudData));

    if (recId === 'rec-anomaly-spike') {
      resolveCostSpikeLeak();
    }

    renderDashboard();
    showToast(`Tối ưu thành công! Đã cắt giảm chi phí vận hành lãng phí.`, 'success');

  }, 600);
};

// Generate Cost Leak Anomaly Spike
function triggerCostSpikeLeak() {
  if (isSpikeActive) return;

  isSpikeActive = true;
  totalAnomalies += 1;

  // Enhance speed to maximum during cost leak to visualize impact
  simulatedSpeedMs = 400; 
  startRealTimeStreaming();

  // Sync simulator speed buttons
  const speedsIds = ['sim-speed-off', 'sim-speed-low', 'sim-speed-normal', 'sim-speed-high'];
  speedsIds.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.className = 'px-2 py-1.5 text-xs font-bold rounded-lg transition-all text-slate-500 hover:text-slate-300';
  });
  const btnHigh = document.getElementById('sim-speed-high');
  if (btnHigh) btnHigh.className = 'px-2 py-1.5 text-xs font-bold rounded-lg transition-all text-white bg-slate-800/80 shadow-md';

  // Toggle control state buttons
  const btnTrigger = document.getElementById('btn-trigger-spike');
  if (btnTrigger) btnTrigger.disabled = true;
  const btnStop = document.getElementById('btn-stop-spike');
  if (btnStop) btnStop.disabled = false;

  // Update Anomaly alert card
  const alertCard = document.getElementById('kpi-alert-card');
  if (alertCard) {
    alertCard.classList.add('anomaly-pulse-active', 'border-rose-500/40');
  }
  const alertsCount = document.getElementById('kpi-alerts');
  if (alertsCount) {
    alertsCount.textContent = totalAnomalies.toString();
    alertsCount.className = 'text-3xl font-extrabold text-rose-500 mt-1.5 tracking-tight';
  }
  const alertIconContainer = document.getElementById('kpi-alert-icon-container');
  if (alertIconContainer) {
    alertIconContainer.className = 'p-3 bg-rose-500/20 text-rose-400 rounded-xl animate-bounce';
  }
  const alertSubtext = document.getElementById('kpi-alert-subtext');
  if (alertSubtext) {
    alertSubtext.className = 'flex items-center gap-1.5 mt-3.5 text-xs font-semibold text-rose-400 bg-rose-500/10 px-2 py-1 rounded-lg w-max';
    alertSubtext.innerHTML = `<i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-500"></i><span>RÒ RỈ CHI PHÍ ĐANG DIỄN RA!</span>`;
    lucide.createIcons();
  }

  // Inject critical recommendation
  const recs = getRecommendations();
  const criticalRec = {
    id: 'rec-anomaly-spike',
    title: 'KHẨN CẤP: Ngăn chặn S3 / Lambda Spillover',
    description: 'Tài nguyên trong us-east-1 đang bị kích hoạt vòng lặp vô tận. Nhấp "Apply Fix" ngay để vá cấu hình IAM.',
    impact: 'Tiết kiệm ~$320.00/giờ',
    savingVal: 320.00,
    service: 'Compute (ECS)',
    resourceId: 'res-aws-spike',
    severity: 'critical'
  };

  recs.unshift(criticalRec);
  saveRecommendations(recs);
  renderRecommendations();

  showToast('PHÁT HIỆN SỰ CỐ BẤT THƯỜNG: Lưu lượng AWS rò rỉ tăng đột biến!', 'danger');
}

// Stop/Resolve Cost Leak Spike
function resolveCostSpikeLeak() {
  if (!isSpikeActive) return;

  isSpikeActive = false;
  simulatedSpeedMs = 2000; 
  startRealTimeStreaming();

  // Sync simulator speed buttons
  const speedsIds = ['sim-speed-off', 'sim-speed-low', 'sim-speed-normal', 'sim-speed-high'];
  speedsIds.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.className = 'px-2 py-1.5 text-xs font-bold rounded-lg transition-all text-slate-500 hover:text-slate-300';
  });
  const btnNormal = document.getElementById('sim-speed-normal');
  if (btnNormal) btnNormal.className = 'px-2 py-1.5 text-xs font-bold rounded-lg transition-all text-white bg-slate-800/80 shadow-md';

  // Toggle buttons disabled state
  const btnTrigger = document.getElementById('btn-trigger-spike');
  if (btnTrigger) btnTrigger.disabled = false;
  const btnStop = document.getElementById('btn-stop-spike');
  if (btnStop) btnStop.disabled = true;

  // Restore Alert Card state
  const alertCard = document.getElementById('kpi-alert-card');
  if (alertCard) {
    alertCard.className = 'glass-panel p-5 rounded-2xl relative overflow-hidden animate-fade-in-up delay-3 transition-all duration-300';
  }
  const alertsCount = document.getElementById('kpi-alerts');
  if (alertsCount) {
    alertsCount.textContent = '0';
    alertsCount.className = 'text-3xl font-extrabold text-slate-300 mt-1.5 tracking-tight';
    totalAnomalies = 0;
  }
  const alertIconContainer = document.getElementById('kpi-alert-icon-container');
  if (alertIconContainer) {
    alertIconContainer.className = 'p-3 bg-slate-800 text-slate-400 rounded-xl';
  }
  const alertSubtext = document.getElementById('kpi-alert-subtext');
  if (alertSubtext) {
    alertSubtext.className = 'flex items-center gap-1.5 mt-3.5 text-xs font-semibold text-slate-400 bg-slate-900/60 px-2 py-1 rounded-lg w-max';
    alertSubtext.innerHTML = `<i data-lucide="shield" class="w-3.5 h-3.5 text-emerald-400"></i><span>Hệ thống an toàn</span>`;
    lucide.createIcons();
  }

  // Clean critical recommendations
  let recs = getRecommendations();
  recs = recs.filter(r => r.id !== 'rec-anomaly-spike');
  saveRecommendations(recs);
  renderRecommendations();

  showToast('Đã vá cấu hình hạ tầng AWS! Chi phí đang trở lại ổn định.', 'success');
}

// Handle CUR JSON/CSV File import
function handleDataImport() {
  const textarea = document.getElementById('import-text');
  const fileInput = document.getElementById('import-file');
  const importMode = document.querySelector('input[name="import-mode"]:checked')?.value || 'append';

  let rawText = textarea?.value.trim() || '';

  if (fileInput?.files.length > 0) {
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
      processTextData(e.target.result, importMode);
      textarea.value = '';
      fileInput.value = '';
      document.getElementById('modal-import')?.classList.add('hidden');
    };
    reader.readAsText(file);
  } else if (rawText) {
    processTextData(rawText, importMode);
    textarea.value = '';
    document.getElementById('modal-import')?.classList.add('hidden');
  } else {
    showToast('Vui lòng tải tệp hoặc nhập dữ liệu văn bản thô để nạp!', 'warning');
  }
}

// Process imported raw data
function processTextData(text, mode) {
  try {
    let parsed = [];
    if (text.trim().startsWith('[')) {
      parsed = JSON.parse(text);
    } else {
      const lines = text.split('\n');
      const headers = lines[0].split(',');
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const cols = lines[i].split(',');
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h.trim()] = cols[idx]?.trim() || '';
        });
        parsed.push({
          id: obj.id || `res-imported-${i}`,
          name: obj.name || 'Imported Resource',
          service: obj.service || 'Compute (EC2)',
          provider: 'aws',
          cost: parseFloat(obj.cost) || 12.5,
          metricCpu: parseInt(obj.metricCpu) || 0,
          metricRam: parseInt(obj.metricRam) || 0,
          status: obj.status || 'active',
          region: obj.region || 'us-east-1',
          health: obj.health || 'healthy',
          warning: obj.warning || '',
          tags: obj.tags || 'Env:Prod'
        });
      }
    }

    if (Array.isArray(parsed)) {
      if (mode === 'replace') {
        cloudData = parsed;
        todayCost = parsed.reduce((acc, c) => acc + (c.status === 'active' ? c.cost * 0.1 : 0), 0);
        monthToDateCost = todayCost * 22;
      } else {
        cloudData = [...cloudData, ...parsed];
      }

      localStorage.setItem('aws_cost_data', JSON.stringify(cloudData));
      renderDashboard();
      initCharts();

      showToast(`Nạp dữ liệu thành công! Đã nạp thêm ${parsed.length} tài nguyên AWS.`, 'success');
    }
  } catch (err) {
    showToast('Lỗi nạp dữ liệu! Vui lòng kiểm tra định dạng tệp JSON/CSV.', 'danger');
  }
}

// Dynamic Interactive Export CSV
function exportToCSV() {
  const headers = ['ID', 'Tên tài nguyên', 'Dịch vụ', 'Region', 'Trạng thái', 'CPU', 'RAM', 'Chi phí/ngày', 'Thẻ phân bổ'];
  const rows = cloudData.map(item => [
    item.id,
    item.name,
    item.service,
    item.region,
    item.status,
    item.metricCpu,
    item.metricRam,
    item.cost.toFixed(2),
    item.tags
  ]);

  let csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
    + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `aws_billing_report_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  
  link.click();
  document.body.removeChild(link);

  showToast('Đã kết xuất báo cáo CSV chi phí AWS thành công!', 'success');
}

// Advanced Custom Toast Handler
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  
  let bgClass = 'bg-slate-900 border-slate-800 text-slate-200';
  let icon = 'info';

  if (type === 'success') {
    bgClass = 'bg-emerald-950/95 border-emerald-500/30 text-emerald-300';
    icon = 'check-circle';
  } else if (type === 'danger') {
    bgClass = 'bg-rose-950/95 border-rose-500/30 text-rose-300';
    icon = 'alert-triangle';
  } else if (type === 'warning') {
    bgClass = 'bg-amber-950/95 border-amber-500/30 text-amber-300';
    icon = 'alert-circle';
  }

  toast.className = `p-4 rounded-xl border ${bgClass} shadow-xl flex items-start gap-3 w-80 animate-fade-in-up duration-200`;
  toast.innerHTML = `
    <div class="shrink-0 mt-0.5"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
    <div class="flex-1 text-xs font-bold leading-relaxed">${message}</div>
    <button class="shrink-0 text-slate-500 hover:text-white transition-colors" onclick="this.parentElement.remove()"><i data-lucide="x" class="w-4 h-4"></i></button>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => {
    toast.remove();
  }, 5000);
}
