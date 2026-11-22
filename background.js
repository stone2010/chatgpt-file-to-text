/* Background service worker: bridges content script <-> offscreen document. */

const OFFSCREEN_URL = 'offscreen.html';
const pending = new Map(); // id -> { contentPort }
let nextId = 0;

let offscreenPort = null;
let offscreenReady = false;
let offscreenReadyWaiters = [];
let creatingOffscreen = null;

function markOffscreenReady() {
  offscreenReady = true;
  offscreenReadyWaiters.forEach((fn) => fn());
  offscreenReadyWaiters = [];
}

function waitForOffscreen() {
  if (offscreenReady && offscreenPort) return Promise.resolve();
  return new Promise((resolve) => offscreenReadyWaiters.push(resolve));
}

async function ensureOffscreen() {
  if (offscreenPort && offscreenReady) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    await waitForOffscreen();
    return;
  }
  creatingOffscreen = (async () => {
    try {
      const contexts = chrome.runtime.getContexts
        ? await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
          })
        : [];
      if (!contexts.length) {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons: ['WORKERS', 'DOM_PARSER', 'BLOBS'],
          justification: '在本地解析用户选择的文件并执行 OCR 文字识别',
        });
      }
    } catch (err) {
      console.error('[file-to-text] offscreen create failed:', err);
      throw err;
    }
  })();
  try {
    await creatingOffscreen;
    await waitForOffscreen();
  } finally {
    creatingOffscreen = null;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'offscreen') {
    offscreenPort = port;
    markOffscreenReady();
    port.onDisconnect.addListener(() => {
      if (offscreenPort === port) {
        offscreenPort = null;
        offscreenReady = false;
      }
    });
    port.onMessage.addListener((msg) => {
      if (!msg || !msg.id) return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      try {
        if (msg.type === 'progress') {
          entry.contentPort.postMessage({
            type: 'progress',
            id: msg.id,
            index: msg.index,
            name: msg.name,
            status: msg.status,
            progress: msg.progress,
          });
        } else if (msg.type === 'item') {
          entry.contentPort.postMessage({
            type: 'item',
            id: msg.id,
            index: msg.index,
            name: msg.name,
            ok: msg.ok,
            text: msg.text,
            error: msg.error,
            meta: msg.meta,
          });
        } else if (msg.type === 'done') {
          entry.contentPort.postMessage({ type: 'done', id: msg.id });
          pending.delete(msg.id);
        }
      } catch (err) {
        console.error('[file-to-text] forward failed:', err);
        pending.delete(msg.id);
      }
    });
    return;
  }

  if (port.name === 'content') {
    port.onDisconnect.addListener(() => {
      for (const [id, entry] of pending.entries()) {
        if (entry.contentPort === port) pending.delete(id);
      }
    });
    port.onMessage.addListener(async (msg) => {
      if (!msg || msg.type !== 'process') return;
      const id = msg.id || `b${++nextId}`;
      pending.set(id, { contentPort: port });
      try {
        await ensureOffscreen();
        if (!offscreenPort) throw new Error('处理引擎未就绪');
        offscreenPort.postMessage({
          type: 'process',
          id,
          options: msg.options || {},
          files: msg.files || [],
        });
      } catch (err) {
        try {
          port.postMessage({
            type: 'item',
            id,
            index: -1,
            ok: false,
            error: err && err.message ? err.message : String(err),
          });
          port.postMessage({ type: 'done', id });
        } catch (_) {}
        pending.delete(id);
      }
    });
  }
});
