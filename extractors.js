/* Loaded in the offscreen document. Exposes window.Extractors. */
const Extractors = (() => {
  const TEXT_EXT = new Set([
    'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml',
    'log', 'ini', 'conf', 'cfg', 'toml', 'env', 'js', 'jsx', 'ts', 'tsx', 'py',
    'java', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift',
    'kt', 'scala', 'sql', 'css', 'scss', 'less', 'sh', 'bash', 'ps1', 'bat',
    'dockerfile', 'gitignore', 'vue', 'svelte', 'r', 'm', 'mm', 'lua', 'dart',
  ]);
  const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif']);

  const extOf = (name) => {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  };

  function cleanText(s) {
    return String(s || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  async function decodeTextFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) {
      try {
        return new TextDecoder('gb18030').decode(bytes);
      } catch (__) {
        return new TextDecoder('utf-8').decode(bytes);
      }
    }
  }

  async function fromPdf(file, options, onProgress) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf/pdf.worker.min.js');
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({
      data,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: true,
    }).promise;
    const parts = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items = (content.items || [])
        .filter((it) => it && typeof it.str === 'string' && it.str.trim())
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
        .sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x));
      const lines = [];
      let line = [];
      let y = null;
      for (const it of items) {
        if (y === null || Math.abs(it.y - y) <= 2) {
          line.push(it.str);
          if (y === null) y = it.y;
        } else {
          lines.push(line.join(' ').replace(/\s{2,}/g, ' ').trim());
          line = [it.str];
          y = it.y;
        }
      }
      if (line.length) lines.push(line.join(' ').replace(/\s{2,}/g, ' ').trim());
      const pageText = lines.filter(Boolean).join('\n');
      parts.push(`${options.pageMarkers ? `[第 ${n} 页]\n` : ''}${pageText}`);
      onProgress({ status: `正在解析 PDF 第 ${n}/${pdf.numPages} 页`, progress: n / pdf.numPages });
    }
    return { text: parts.join('\n\n'), meta: { pages: pdf.numPages } };
  }

  async function fromDocx(file) {
    const buf = await file.arrayBuffer();
    if (typeof mammoth.convertToMarkdown === 'function') {
      const result = await mammoth.convertToMarkdown({ arrayBuffer: buf });
      return { text: result.value || '', meta: {} };
    }
    const result = await mammoth.convertToHtml({ arrayBuffer: buf });
    return { text: htmlToText(result.value || ''), meta: {} };
  }

  async function fromSpreadsheet(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const blocks = wb.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: '\t', blankrows: false });
      return `### 工作表：${name}\n${csv}`;
    });
    return { text: blocks.join('\n\n'), meta: { sheets: wb.SheetNames.length } };
  }

  const slideNum = (name) => {
    const m = /slide(\d+)\.xml$/.exec(name);
    return m ? parseInt(m[1], 10) : 0;
  };

  async function fromPptx(file, options) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const names = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => slideNum(a) - slideNum(b));
    if (!names.length) throw new Error('未找到幻灯片内容');
    const parser = new DOMParser();
    const NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const parts = [];
    for (let i = 0; i < names.length; i++) {
      const xml = await zip.file(names[i]).async('string');
      const doc = parser.parseFromString(xml, 'application/xml');
      const paragraphs = Array.from(doc.getElementsByTagNameNS(NS, 'p'));
      const lines = paragraphs
        .map((p) =>
          Array.from(p.getElementsByTagNameNS(NS, 't'))
            .map((t) => t.textContent || '')
            .join('')
            .trim()
        )
        .filter(Boolean);
      parts.push(`${options.pageMarkers ? `[第 ${i + 1} 张幻灯片]\n` : ''}${lines.join('\n')}`);
    }
    return { text: parts.join('\n\n'), meta: { slides: names.length } };
  }

  async function fromOdf(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const contentFile = zip.file('content.xml');
    if (!contentFile) throw new Error('ODF 文件缺少 content.xml');
    const xml = await contentFile.async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const blocks = [];
    const all = Array.from(doc.getElementsByTagName('*'));
    for (const el of all) {
      const local = el.localName;
      if (local === 'p' || local === 'h') {
        const t = (el.textContent || '').trim();
        if (t && !blocks.includes(t)) blocks.push(t);
      } else if (local === 'table-row') {
        const cells = Array.from(el.children)
          .filter((c) => c.localName === 'table-cell' || c.localName === 'covered-table-cell')
          .map((c) => (c.textContent || '').trim());
        if (cells.some(Boolean)) blocks.push(cells.join('\t'));
      }
    }
    return { text: blocks.join('\n'), meta: {} };
  }

  async function fromEpub(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const container = zip.file('META-INF/container.xml');
    let opfPath = 'content.opf';
    if (container) {
      const cdoc = new DOMParser().parseFromString(await container.async('string'), 'application/xml');
      const root = cdoc.getElementsByTagName('rootfile')[0];
      if (root && root.getAttribute('full-path')) opfPath = root.getAttribute('full-path');
    }
    let ordered = [];
    const opf = zip.file(opfPath);
    if (opf) {
      const doc = new DOMParser().parseFromString(await opf.async('string'), 'application/xml');
      const manifest = {};
      Array.from(doc.getElementsByTagName('item')).forEach((it) => {
        manifest[it.getAttribute('id')] = it.getAttribute('href');
      });
      const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
      ordered = Array.from(doc.getElementsByTagName('itemref'))
        .map((ref) => manifest[ref.getAttribute('idref')])
        .filter(Boolean)
        .map((href) => base + href);
    }
    if (!ordered.length) {
      ordered = Object.keys(zip.files)
        .filter((n) => /\.x?html?$/i.test(n) && !/_toc/i.test(n))
        .sort();
    }
    const parts = [];
    for (const name of ordered) {
      const f = zip.file(name);
      if (!f) continue;
      parts.push(htmlToText(await f.async('string')));
    }
    return { text: parts.filter(Boolean).join('\n\n'), meta: {} };
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script, style, noscript, svg, iframe').forEach((n) => n.remove());
    if (doc.body && typeof doc.body.innerText === 'string' && doc.body.innerText.trim()) {
      return cleanText(doc.body.innerText);
    }
    const raw = String(html || '')
      .replace(/<\s*br\s*\/?[^>]*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|section|article)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    const el = document.createElement('textarea');
    el.innerHTML = raw;
    return cleanText(el.value);
  }

  function rtfToText(src) {
    let s = String(src || '');
    s = s.replace(/\\u(-?\d+)\??/g, (_, d) => {
      const n = parseInt(d, 10);
      return String.fromCharCode(n < 0 ? n + 65536 : n);
    });
    s = s.replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    s = s.replace(/\\par[d]?\b/gi, '\n').replace(/\\line\b/gi, '\n').replace(/\\tab\b/gi, '\t');
    s = s.replace(/\\\*\\[a-zA-Z]+\b/g, '').replace(/\\[a-zA-Z]+-?\d*\s?/g, '');
    s = s.replace(/[{}]/g, '');
    return cleanText(s);
  }

  async function fromImage(file, options, onProgress) {
    const lang = options.ocrLang || 'chi_sim+eng';
    const result = await Tesseract.recognize(file, lang, {
      workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('lib/tesseract/'),
      langPath: chrome.runtime.getURL('lib/tessdata/'),
      gzip: true,
      cacheMethod: 'write',
      logger: (m) => {
        if (m.status === 'loading tesseract core') onProgress({ status: '正在加载 OCR 引擎', progress: 0.05 });
        else if (m.status === 'initializing tesseract') onProgress({ status: '正在初始化 OCR', progress: 0.15 });
        else if (m.status === 'loading language traineddata') onProgress({ status: '正在加载语言包', progress: 0.25 });
        else if (m.status === 'recognizing text') onProgress({ status: '正在识别文字', progress: 0.3 + (m.progress || 0) * 0.7 });
      },
    });
    const text = cleanText((result && result.data && result.data.text) || '');
    if (!text) throw new Error('图片中未识别到文字');
    return { text, meta: { engine: 'OCR', lang } };
  }

  async function extract(file, options, onProgress) {
    const ext = extOf(file.name);
    const type = (file.type || '').toLowerCase();
    onProgress({ status: '读取文件中', progress: 0.02 });
    let result;
    if (ext === 'pdf' || type === 'application/pdf') {
      result = await fromPdf(file, options, onProgress);
    } else if (IMAGE_EXT.has(ext) || type.startsWith('image/')) {
      result = await fromImage(file, options, onProgress);
    } else if (ext === 'docx' || ext === 'dotx') {
      result = await fromDocx(file);
    } else if (['xls', 'xlsx', 'xlsm', 'xlsb', 'csv', 'tsv'].includes(ext)) {
      result = ext === 'csv' || ext === 'tsv'
        ? { text: cleanText(await decodeTextFile(file)), meta: {} }
        : await fromSpreadsheet(file);
    } else if (ext === 'pptx') {
      result = await fromPptx(file, options);
    } else if (['odt', 'ods', 'odp'].includes(ext)) {
      result = await fromOdf(file);
    } else if (ext === 'epub') {
      result = await fromEpub(file);
    } else if (ext === 'html' || ext === 'htm' || type === 'text/html') {
      result = { text: htmlToText(await decodeTextFile(file)), meta: {} };
    } else if (ext === 'xml') {
      const raw = cleanText(await decodeTextFile(file));
      result = { text: raw.replace(/>\s*</g, '>\n<'), meta: {} };
    } else if (ext === 'rtf') {
      result = { text: rtfToText(await decodeTextFile(file)), meta: {} };
    } else if (TEXT_EXT.has(ext) || !ext || type.startsWith('text/')) {
      result = { text: cleanText(await decodeTextFile(file)), meta: {} };
    } else {
      // Last resort: maybe it is plain text with an unusual extension.
      const guess = cleanText(await decodeTextFile(file));
      if (guess && !/[\u0000-\u0008]/.test(guess.slice(0, 2000))) {
        result = { text: guess, meta: { fallback: true } };
      } else {
        throw new Error(`暂不支持 .${ext || '未知'} 格式，建议先另存为 PDF / DOCX / TXT`);
      }
    }
    return { text: cleanText(result.text || ''), meta: result.meta || {} };
  }

  return { extract, extOf };
})();
