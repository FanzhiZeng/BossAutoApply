// popup.js
// 负责：读写用户配置（chrome.storage.local）、控制 content script 的启停、
// 展示实时进度日志。

const JOB_PAGE_PREFIX = 'https://www.zhipin.com/web/geek/job';
const STORAGE_KEY_CONFIG = 'ba_config';

const els = {
  hint: document.getElementById('not-on-page-hint'),
  form: document.getElementById('config-form'),
  keywords: document.getElementById('keywords'),
  excludeKeywords: document.getElementById('excludeKeywords'),
  excludeCompanies: document.getElementById('excludeCompanies'),
  salaryMin: document.getElementById('salaryMin'),
  salaryMax: document.getElementById('salaryMax'),
  jobType: document.getElementById('jobType'),
  experience: document.getElementById('experience'),
  degree: document.getElementById('degree'),
  greeting: document.getElementById('greeting'),
  maxApplications: document.getElementById('maxApplications'),
  minDelay: document.getElementById('minDelay'),
  maxDelay: document.getElementById('maxDelay'),
  startBtn: document.getElementById('start-btn'),
  stopBtn: document.getElementById('stop-btn'),
  statusBadge: document.getElementById('status-badge'),
  appliedCount: document.getElementById('applied-count'),
  skippedCount: document.getElementById('skipped-count'),
  errorCount: document.getElementById('error-count'),
  logPanel: document.getElementById('log-panel')
};

const DEFAULT_GREETING = '您好，我对这个岗位很感兴趣，我的经历和岗位要求比较契合，期待能和您聊聊，谢谢！';

function splitList(value) {
  return (value || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function readConfigFromForm() {
  return {
    keywords: splitList(els.keywords.value),
    excludeKeywords: splitList(els.excludeKeywords.value),
    excludeCompanies: splitList(els.excludeCompanies.value),
    salaryMin: Number(els.salaryMin.value) || 0,
    salaryMax: Number(els.salaryMax.value) || 0,
    jobType: els.jobType.value,
    experience: els.experience.value,
    degree: els.degree.value,
    greeting: els.greeting.value.trim() || DEFAULT_GREETING,
    maxApplications: Math.min(200, Math.max(1, Number(els.maxApplications.value) || 20)),
    minDelayMs: Math.max(1000, (Number(els.minDelay.value) || 3) * 1000),
    maxDelayMs: Math.max(1000, (Number(els.maxDelay.value) || 8) * 1000)
  };
}

function writeConfigToForm(config) {
  if (!config) return;
  els.keywords.value = (config.keywords || []).join(', ');
  els.excludeKeywords.value = (config.excludeKeywords || []).join(', ');
  els.excludeCompanies.value = (config.excludeCompanies || []).join(', ');
  els.salaryMin.value = config.salaryMin || '';
  els.salaryMax.value = config.salaryMax || '';
  els.jobType.value = config.jobType || '';
  els.experience.value = config.experience || '';
  els.degree.value = config.degree || '';
  els.greeting.value = config.greeting || DEFAULT_GREETING;
  els.maxApplications.value = config.maxApplications || 20;
  els.minDelay.value = (config.minDelayMs || 3000) / 1000;
  els.maxDelay.value = (config.maxDelayMs || 8000) / 1000;
}

async function loadSavedConfig() {
  const data = await chrome.storage.local.get(STORAGE_KEY_CONFIG);
  writeConfigToForm(data[STORAGE_KEY_CONFIG] || { greeting: DEFAULT_GREETING });
}

async function saveConfig(config) {
  await chrome.storage.local.set({ [STORAGE_KEY_CONFIG]: config });
}

async function getActiveJobTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.startsWith(JOB_PAGE_PREFIX)) return tab;
  return null;
}

function renderState(state) {
  if (!state) return;
  els.appliedCount.textContent = state.appliedCount || 0;
  els.skippedCount.textContent = state.skippedCount || 0;
  els.errorCount.textContent = state.errorCount || 0;

  els.startBtn.disabled = !!state.running;
  els.stopBtn.disabled = !state.running;

  els.statusBadge.textContent = state.running ? '运行中' : '未运行';
  els.statusBadge.className = 'badge ' + (state.running ? 'running' : 'idle');

  els.logPanel.innerHTML = '';
  (state.log || []).forEach((entry) => {
    const line = document.createElement('div');
    line.className = `log-line ${entry.level || 'info'}`;
    line.textContent = `[${entry.time}] ${entry.message}`;
    els.logPanel.appendChild(line);
  });
  els.logPanel.scrollTop = els.logPanel.scrollHeight;
}

async function refreshStateFromBackground() {
  const state = await chrome.runtime.sendMessage({ type: 'BA_GET_LATEST_STATE' }).catch(() => null);
  renderState(state);
}

async function init() {
  await loadSavedConfig();

  const tab = await getActiveJobTab();
  els.hint.classList.toggle('hidden', !!tab);
  els.startBtn.disabled = !tab;

  await refreshStateFromBackground();

  if (tab) {
    const liveState = await chrome.tabs.sendMessage(tab.id, { type: 'BA_GET_STATE' }).catch(() => null);
    if (liveState) renderState(liveState);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'BA_PROGRESS') {
      renderState(message.payload);
    }
  });

  els.startBtn.addEventListener('click', async () => {
    const activeTab = await getActiveJobTab();
    if (!activeTab) {
      els.hint.classList.remove('hidden');
      return;
    }
    const config = readConfigFromForm();
    await saveConfig(config);

    const response = await chrome.tabs.sendMessage(activeTab.id, { type: 'BA_START', config }).catch((e) => ({
      ok: false,
      reason: e.message
    }));

    if (!response || !response.ok) {
      alert('启动失败：' + (response ? response.reason : '无法连接到页面，请刷新 BOSS 直聘页面后重试'));
      return;
    }
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    els.statusBadge.textContent = '运行中';
    els.statusBadge.className = 'badge running';
  });

  els.stopBtn.addEventListener('click', async () => {
    const activeTab = await getActiveJobTab();
    if (!activeTab) return;
    await chrome.tabs.sendMessage(activeTab.id, { type: 'BA_STOP' }).catch(() => {});
    els.stopBtn.disabled = true;
  });

  els.form.addEventListener('change', async () => {
    await saveConfig(readConfigFromForm());
  });
}

init();
