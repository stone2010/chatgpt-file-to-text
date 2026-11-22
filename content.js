/* Content script: intercepts attachments on ChatGPT and offers text conversion. */
(() => {
  'use strict';

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

  const S = {
    settings: { ...DEFAULTS },
    files: [],
    origin: null,
    bypass: false,
    host: null,
    shadow: null,
    layer: null,
    port: null,
    req: null,
    timer: null,
  };

  const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    .cftt-banner {
      position: fixed; right: 22px; bottom: 116px; z-index: 2147483647; width: 348px;
      background: #22232b; color: #ececf1; border: 1px solid #42444f; border-radius: 14px;
      box-shadow: 0 14px 42px rgba(0,0,0,.48); padding: 14px 14px 12px; font-size: 13px;
      animation: cftt-in .18s ease-out;
    }
    @media (max-width: 720px) { .cftt-banner { right: 10px; left: 10px; width: auto; bottom: 108px; } .cftt-card { width: calc(100vw - 24px) !important; } }
    @keyframes cftt-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .cftt-row { display: flex; align-items: flex-start; gap: 10px; }
    .cftt-icon { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg,#8b6cf5,#5b8cff); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
    .cftt-icon svg { width: 16px; height: 16px; fill: #fff; }
    .cftt-title { font-weight: 650; font-size: 13.5px; line-height: 1.35; }
    .cftt-sub { color: #a6a8b5; font-size: 11.5px; margin-top: 3px; line-height: 1.45; }
    .cftt-files { margin: 10px 0 11px 38px; max-height: 78px; overflow: auto; display: flex; flex-direction: column; gap: 4px; }
    .cftt-file { display: flex; align-items: center; gap: 6px; color: #c9cad3; font-size: 11.5px; }
    .cftt-file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cftt-dot { width: 5px; height: 5px; border-radius: 50%; background: #8b6cf5; flex: 0 0 auto; }
    .cftt-actions { display: flex; gap: 7px; margin-left: 38px; }
    button.cftt-btn { border: 0; border-radius: 8px; padding: 7px 10px; font-size: 12px; cursor: pointer; color: #e8e8ee; background: #33343d; transition: filter .12s, background .12s; }
    button.cftt-btn:hover { filter: brightness(1.18); }
    button.cftt-btn:disabled { opacity: .5; cursor: not-allowed; }
    button.cftt-primary { background: linear-gradient(135deg,#8063ec,#5679e8); color: #fff; font-weight: 600; }
    button.cftt-ghost { background: transparent; color: #9395a3; padding: 7px 5px; }
    .cftt-overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(8,8,12,.68); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .cftt-card { width: 520px; max-height: 86vh; overflow: auto; background: #22232b; color: #ececf1; border: 1px solid #454752; border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,.6); padding: 20px; animation: cftt-in .16s ease-out; }
    .cftt-card h2 { margin: 0 0 4px; font-size: 16px; font-weight: 650; }
    .cftt-card p.cftt-desc { margin: 0 0 14px; font-size: 12px; color: #a6a8b5; line-height: 1.55; }
    .cftt-list { display: flex; flex-direction: column; gap: 9px; margin-bottom: 14px; }
    .cftt-item { background: #2b2c35; border: 1px solid #3b3d48; border-radius: 10px; padding: 9px 11px; font-size: 12px; }
    .cftt-item-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .cftt-item-name { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cftt-badge { font-size: 10.5px; padding: 2px 7px; border-radius: 20px; background: #3a3b46; color: #b9bbc7; white-space: nowrap; }
    .cftt-badge.ok { background: #1e4537; color: #7ee0b0; }
    .cftt-badge.err { background: #4d2830; color: #ff9aa8; }
    .cftt-status { color: #9b9daa; font-size: 11px; margin-top: 5px; }
    .cftt-bar { height: 4px; border-radius: 4px; background: #3c3e49; margin-top: 7px; overflow: hidden; }
    .cftt-bar i { display: block; height: 100%; width: 0%; border-radius: 4px; background: linear-gradient(90deg,#8063ec,#5b8cff); transition: width .2s; }
    textarea.cftt-textarea { width: 100%; height: 240px; resize: vertical; background: #191a20; color: #e4e5ec; border: 1px solid #444652; border-radius: 10px; padding: 12px; font-size: 12px; line-height: 1.6; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; outline: none; }
    textarea.cftt-textarea:focus { border-color: #8063ec; }
    .cftt-warn { margin: 10px 0 0; color: #ffb27a; font-size: 11.5px; line-height: 1.5; }
    .cftt-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    .cftt-foot button.cftt-btn { padding: 8px 14px; font-size: 12.5px; }
  `;

  init();

  async function init() {
    try {
      S.settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
    } catch (_) {}
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(DEFAULTS)) {
        if (changes[k]) S.settings[k] = changes[k].newValue;
      }
      if (!S.settings.enabled && S.files.length) clearPending();
    });
    installCapturers();
  }

  function installCapturers() {
    window.addEventListener('change', (e) => {
      if (S.bypass) return;
      const t = e.target;
      if (!t || t.tagName !== 'INPUT' || t.type !== 'file') return;
      if (capture(t.files, { kind: 'change', node: t })) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    window.addEventListener('drop', (e) => {
      if (S.bypass) return;
      const dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      if (capture(dt.files, { kind: 'drop', node: e.target, transfer: dt })) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    window.addEventListener('paste', (e) => {
      if (S.bypass) return;
      const cd = e.clipboardData;
      if (!cd) return;
      let files = Array.from(cd.files || []);
      if (!files.length && cd.items) {
        files = Array.from(cd.items)
          .filter((it) => it.kind === 'file')
          .map((it) => { try { return it.getAsFile(); } catch (_) { return null; } })
          .filter(Boolean);
      }
      if (!files.length) return;
      if (capture(files, { kind: 'paste', node: e.target, clipboard: cd })) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  function keyOf(f) { return `${f.name}|${f.size}|${f.lastModified}`; }

  function capture(list, origin) {
    if (!S.settings.enabled || !S.settings.showBanner) return false;
    const files = Array.from(list || []).filter((f) => f && f.size > 0);
    if (!files.length) return false;
    const seen = new Set(S.files.map(keyOf));
    const fresh = files.filter((f) => !seen.has(keyOf(f)));
    if (!fresh.length) return false;
    S.files.push(...fresh);
    S.origin = origin;
    renderBanner();
    return true;
  }

  function clearPending() {
    S.files = [];
    S.origin = null;
    if (S.layer) S.layer.innerHTML = '';
  }

  function ensureHost() {
    if (S.host) return;
    const host = document.createElement('div');
    host.id = 'cftt-root';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    const layer = document.createElement('div');
    shadow.appendChild(layer);
    S.host = host;
    S.shadow = shadow;
    S.layer = layer;
  }

  function btn(label, cls, onClick) {
    const b = document.createElement('button');
    b.className = `cftt-btn ${cls || ''}`;
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderBanner() {
    if (!S.files.length) return;
    ensureHost();
    S.layer.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'cftt-banner';

    const row = document.createElement('div');
    row.className = 'cftt-row';
    row.innerHTML = `
      <div class="cftt-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 2.5V9h4.5M8 13h8m-8 4h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div style="flex:1">
        <div class="cftt-title">检测到 ${S.files.length} 个附件，可转为文字上传</div>
        <div class="cftt-sub">提取其中的文字直接写入输入框，不占用文件上传额度</div>
      </div>`;
    card.appendChild(row);

    const list = document.createElement('div');
    list.className = 'cftt-files';
    S.files.forEach((f, i) => {
      const line = document.createElement('div');
      line.className = 'cftt-file';
      const dot = document.createElement('i');
      dot.className = 'cftt-dot';
      const name = document.createElement('span');
      name.textContent = `${f.name}  (${formatSize(f.size)})`;
      const del = document.createElement('button');
      del.className = 'cftt-btn cftt-ghost';
      del.style.cssText = 'margin-left:auto;padding:0 4px;line-height:1;font-size:14px;';
      del.textContent = '×';
      del.title = '不转换这个文件';
      del.addEventListener('click', () => {
        S.files.splice(i, 1);
        if (!S.files.length) clearPending();
        else renderBanner();
      });
      line.append(dot, name, del);
      list.appendChild(line);
    });
    card.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'cftt-actions';
    actions.appendChild(btn('提取文字并输入', 'cftt-primary', startProcessing));
    actions.appendChild(btn('仍按文件发送', '', () => {
      restoreFiles();
      clearPending();
    }));
    actions.appendChild(btn('取消', 'cftt-ghost', () => clearPending()));
    card.appendChild(actions);
    S.layer.appendChild(card);
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function formatSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function restoreFiles() {
    const o = S.origin;
    if (!o) return;
    S.bypass = true;
    setTimeout(() => { S.bypass = false; }, 80);
    try {
      if (o.kind === 'change' && o.node) {
        o.node.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (o.kind === 'drop' && o.node && o.transfer) {
        o.node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: o.transfer }));
      } else if (o.kind === 'paste' && o.node && o.clipboard) {
        o.node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: o.clipboard }));
      }
    } catch (err) {
      console.error('[file-to-text] restore failed:', err);
    }
  }

  function getPort() {
    if (S.port) return S.port;
    const port = chrome.runtime.connect({ name: 'content' });
    port.onDisconnect.addListener(() => { S.port = null; });
    port.onMessage.addListener(onPortMessage);
    S.port = port;
    return port;
  }

  function onPortMessage(msg) {
    const req = S.req;
    if (!req || msg.id !== req.id) return;
    if (msg.type === 'progress') {
      const item = req.items[msg.index];
      if (item) {
        item.status = msg.status;
        item.progress = msg.progress;
        updateProgressUI();
      }
    } else if (msg.type === 'item') {
      req.items[msg.index] = {
        name: msg.name,
        ok: msg.ok,
        text: msg.text || '',
        error: msg.error,
        meta: msg.meta || {},
        status: msg.ok ? '已完成' : '失败',
        progress: 1,
      };
      updateProgressUI();
    } else if (msg.type === 'done') {
      clearTimeout(S.timer);
      if (S.req === req) showPreview();
    }
  }

  async function startProcessing() {
    if (S.busy || !S.files.length) return;
    S.busy = true;
    const files = S.files.slice();
    const req = {
      id: null,
      items: files.map((f) => ({ name: f.name, ok: false, status: '等待处理', progress: 0 })),
    };
    renderProgress(req);
    try {
      const payload = [];
      for (const f of files) {
        payload.push({
          name: f.name,
          type: f.type || '',
          size: f.size,
          lastModified: f.lastModified,
          data: arrayBufferToBase64(await f.arrayBuffer()),
        });
      }
      const port = getPort();
      req.id = `c${Date.now()}_${Math.random().toString(36).slice(2)}`;
      S.req = req;
      port.postMessage({ type: 'process', id: req.id, files: payload, options: { ...S.settings } });
      S.timer = setTimeout(() => {
        if (S.req === req) {
          req.items.forEach((it) => { if (it.status !== '已完成' && it.status !== '失败') it.status = '超时'; });
          updateProgressUI();
        }
      }, 300000);
    } catch (err) {
      req.items.forEach((it) => { it.status = '读取失败'; it.error = err.message; });
      updateProgressUI();
      S.busy = false;
    }
  }

  function renderProgress(req) {
    ensureHost();
    S.layer.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'cftt-overlay';
    const card = document.createElement('div');
    card.className = 'cftt-card';
    const h = document.createElement('h2');
    h.textContent = '正在提取文字…';
    const p = document.createElement('p');
    p.className = 'cftt-desc';
    p.textContent = '所有处理均在本地完成，不会把文件发送到第三方服务。图片识别首次加载语言包可能需要几秒。';
    const list = document.createElement('div');
    list.className = 'cftt-list';
    req.items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'cftt-item';
      row.dataset.idx = String(i);
      row.innerHTML = `
        <div class="cftt-item-head"><div class="cftt-item-name"></div><span class="cftt-badge">等待中</span></div>
        <div class="cftt-status">准备处理</div>
        <div class="cftt-bar"><i></i></div>`;
      row.querySelector('.cftt-item-name').textContent = it.name;
      list.appendChild(row);
    });
    const foot = document.createElement('div');
    foot.className = 'cftt-foot';
    foot.appendChild(btn('取消', 'cftt-ghost', () => {
      clearTimeout(S.timer);
      S.req = null;
      S.busy = false;
      closeUI();
      clearPending();
    }));
    card.append(h, p, list, foot);
    overlay.appendChild(card);
    S.layer.appendChild(overlay);
    S.progressOverlay = overlay;
    S.currentReq = req;
  }

  function updateProgressUI() {
    const req = S.currentReq;
    const overlay = S.progressOverlay;
    if (!req || !overlay) return;
    const rows = overlay.querySelectorAll('.cftt-item');
    req.items.forEach((it, i) => {
      const row = rows[i];
      if (!row) return;
      const badge = row.querySelector('.cftt-badge');
      const status = row.querySelector('.cftt-status');
      const bar = row.querySelector('.cftt-bar i');
      badge.className = 'cftt-badge' + (it.ok === true ? ' ok' : it.ok === false ? ' err' : '');
      badge.textContent = it.ok === true ? '完成' : it.ok === false ? '失败' : `${Math.round((it.progress || 0) * 100)}%`;
      status.textContent = it.error ? it.error : (it.status || '处理中');
      bar.style.width = `${Math.round((it.progress || 0) * 100)}%`;
    });
  }

  function buildPayload(items) {
    const blocks = [];
    for (const it of items) {
      if (!it.ok || !it.text || !it.text.trim()) continue;
      const isImage = IMAGE_RE.test(it.name) || it.meta && it.meta.engine === 'OCR';
      const label = isImage ? '图片 OCR 文字' : '文件内容';
      let extra = '';
      if (it.meta && it.meta.pages) extra += `，共 ${it.meta.pages} 页`;
      else if (it.meta && it.meta.slides) extra += `，共 ${it.meta.slides} 张幻灯片`;
      else if (it.meta && it.meta.sheets) extra += `，共 ${it.meta.sheets} 个工作表`;
      const head = `【${label}：${it.name}${extra}】`;
      blocks.push(S.settings.delimiters
        ? `${head}\n${it.text}\n【${label}结束：${it.name}】`
        : `${head}\n${it.text}`);
    }
    if (!blocks.length) return '';
    const header = S.settings.addHeader
      ? '以下附件已由「文件转文字」插件提取为文字，请基于这些内容回答问题：\n\n'
      : '';
    return header + blocks.join('\n\n');
  }

  function showPreview() {
    S.busy = false;
    const req = S.req;
    const payload = req ? buildPayload(req.items) : '';
    ensureHost();
    S.layer.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'cftt-overlay';
    const card = document.createElement('div');
    card.className = 'cftt-card';

    const h = document.createElement('h2');
    h.textContent = payload ? '文字已提取，确认后写入输入框' : '没有可写入的文字';
    const desc = document.createElement('p');
    desc.className = 'cftt-desc';
    desc.textContent = payload
      ? '你可以直接编辑下面的文字，确认后会移除附件并把文字写入 ChatGPT 输入框，光标停在末尾方便继续输入 prompt。'
      : '所有文件都提取失败了。请检查文件格式，或点击插件图标调整识别语言。';

    const area = document.createElement('textarea');
    area.className = 'cftt-textarea';
    area.spellcheck = false;
    area.value = payload;
    area.placeholder = '提取出的文字会出现在这里…';
    card.append(h, desc, area);

    const failed = req ? req.items.filter((it) => !it.ok) : [];
    if (failed.length) {
      const warn = document.createElement('p');
      warn.className = 'cftt-warn';
      warn.textContent = `以下文件未能提取：${failed.map((f) => `${f.name}（${f.error || '失败'}）`).join('；')}`;
      card.appendChild(warn);
    }

    const foot = document.createElement('div');
    foot.className = 'cftt-foot';
    if (payload) {
      foot.appendChild(btn('复制文字', '', () => copyText(area.value)));
      foot.appendChild(btn('取消', 'cftt-ghost', () => { closeUI(); }));
      foot.appendChild(btn('插入到输入框', 'cftt-primary', () => {
        try {
          insertIntoComposer(area.value);
          if (S.settings.cleanupResidual) cleanupResidual();
          closeUI();
          clearPending();
        } catch (err) {
          alert(`插入失败：${err.message}`);
        }
      }));
    } else {
      foot.appendChild(btn('关闭', 'cftt-primary', () => { closeUI(); clearPending(); }));
    }
    card.appendChild(foot);
    overlay.appendChild(card);
    S.layer.appendChild(overlay);
    S.req = null;
    S.currentReq = null;
  }

  function closeUI() {
    if (S.shadow) S.layer.innerHTML = '';
    S.progressOverlay = null;
    S.currentReq = null;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
  }

  function findEditor() {
    const selectors = [
      '#prompt-textarea',
      'textarea[data-id="root"]',
      'div[contenteditable="true"][data-placeholder]',
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function placeCaretAtEnd(el) {
    try {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const end = (el.value || '').length;
        el.setSelectionRange(end, end);
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  function insertIntoComposer(text) {
    const editor = findEditor();
    if (!editor) throw new Error('未找到 ChatGPT 输入框，请确认页面已加载完成');
    editor.focus();
    placeCaretAtEnd(editor);

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (_) {}

    const probe = text.replace(/\s+/g, '').slice(0, 16);
    const raw = editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT'
      ? (editor.value || '')
      : (editor.innerText || editor.textContent || '');
    const contains = raw.replace(/\s+/g, '').includes(probe);
    if (!inserted || !contains) {
      if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
        const setter = Object.getOwnPropertyDescriptor(
          editor.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value'
        ).set;
        setter.call(editor, `${editor.value || ''}${editor.value ? '\n\n' : ''}${text}`);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        editor.textContent = `${editor.textContent || ''}${editor.textContent ? '\n\n' : ''}${text}`;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }

    if (S.settings.autoScroll) {
      requestAnimationFrame(() => {
        try { editor.scrollTop = editor.scrollHeight; } catch (_) {}
        let p = editor.parentElement;
        let depth = 0;
        while (p && depth++ < 8) {
          const style = getComputedStyle(p);
          if (p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(style.overflowY)) {
            p.scrollTop = p.scrollHeight;
          }
          p = p.parentElement;
        }
        try { editor.scrollIntoView({ block: 'end', behavior: 'smooth' }); } catch (_) {}
        editor.focus({ preventScroll: true });
        placeCaretAtEnd(editor);
      });
    } else {
      editor.focus();
      placeCaretAtEnd(editor);
    }
  }

  function cleanupResidual() {
    const editor = findEditor();
    if (!editor) return;
    const scope = editor.closest('form') || editor.parentElement?.parentElement?.parentElement || document.body;
    const buttons = Array.from(scope.querySelectorAll('button, [role="button"]'));
    for (const b of buttons) {
      const label = [b.getAttribute('aria-label'), b.getAttribute('title'), b.getAttribute('data-testid'), b.textContent]
        .filter(Boolean).join(' ');
      if (!/remove|delete|close|移除|删除|关闭|清除/i.test(label)) continue;
      if (/send|submit|发送|停止/i.test(label) && !/remove/i.test(label)) continue;
      try { b.click(); } catch (_) {}
    }
  }
})();
