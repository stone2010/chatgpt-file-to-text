const DEFAULTS = {
  enabled: true,
  showBanner: true,
  ocrLang: 'chi_sim+eng',
  pageMarkers: true,
  delimiters: true,
  addHeader: true,
  autoScroll: true,
  cleanupResidual: true,
};

const statusEl = document.getElementById('status');

function showStatus(text) {
  statusEl.textContent = text;
  setTimeout(() => { if (statusEl.textContent === text) statusEl.textContent = ''; }, 1600);
}

async function init() {
  const saved = await chrome.storage.sync.get(DEFAULTS);
  document.querySelectorAll('[data-key]').forEach((el) => {
    const key = el.dataset.key;
    const value = saved[key];
    if (el.type === 'checkbox') el.checked = value !== false;
    else el.value = value;
    el.addEventListener('change', async () => {
      const next = el.type === 'checkbox' ? el.checked : el.value;
      await chrome.storage.sync.set({ [key]: next });
      showStatus('已保存');
    });
  });
}

init();
