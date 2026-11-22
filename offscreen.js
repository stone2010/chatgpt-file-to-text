/* Runs inside the hidden offscreen document (extension origin). */
(() => {
  const port = chrome.runtime.connect({ name: 'offscreen' });
  port.postMessage({ type: 'ready' });

  function base64ToBytes(b64) {
    const binary = atob(b64 || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'process') return;
    const { id, files = [], options = {} } = msg;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const file = new File([base64ToBytes(f.data)], f.name, {
          type: f.type || 'application/octet-stream',
          lastModified: f.lastModified || Date.now(),
        });
        port.postMessage({ type: 'progress', id, index: i, name: f.name, status: '准备处理', progress: 0 });
        const result = await Extractors.extract(file, options, (p) => {
          port.postMessage({
            type: 'progress',
            id,
            index: i,
            name: f.name,
            status: p.status || '处理中',
            progress: typeof p.progress === 'number' ? p.progress : 0,
          });
        });
        port.postMessage({
          type: 'item',
          id,
          index: i,
          name: f.name,
          ok: true,
          text: result.text,
          meta: result.meta,
        });
      } catch (err) {
        port.postMessage({
          type: 'item',
          id,
          index: i,
          name: f.name,
          ok: false,
          error: err && err.message ? err.message : String(err),
        });
      }
    }
    port.postMessage({ type: 'done', id });
  });
})();
