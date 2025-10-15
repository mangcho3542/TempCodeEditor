// index.js
// Monaco-based playground (mobile-friendly) + safe sandbox + object serialization + focus fixes

// Ensure loader path
require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' }});

const OUTPUT_PREFIX = '[PLAY] ';

function appendOutput(text) {
  const out = document.getElementById('output');
  out.textContent += text + '\n';
  out.scrollTop = out.scrollHeight;
}

// create a fresh sandbox iframe (used for "stop")
function createSandbox() {
  const existing = document.getElementById('sandbox');
  if (existing) existing.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'sandbox';
  iframe.sandbox = 'allow-scripts';
  iframe.style.display = 'none';
  iframe.style.pointerEvents = 'none';
  iframe.style.position = 'absolute';
  iframe.style.left = '-9999px';
  iframe.style.top = '-9999px';
  document.body.appendChild(iframe);
  return iframe;
}

let sandbox = createSandbox();

window.addEventListener('message', (e) => {
  const d = e.data;
  if (d && typeof d === 'object' && d.__playground_message) {
    appendOutput(d.text);
  } else {
    appendOutput(String(d));
  }
});

// load monaco and create editor
require(['vs/editor/editor.main'], function () {
  const editorContainer = document.getElementById('editorContainer');

  const editor = monaco.editor.create(document.getElementById('editor'), {
    value: `// 예시: 객체, 배열, 순환 참조 출력 확인\nconsole.log("hello mobile");\nconsole.log({a:1, b:[1,2,3]});\nconst obj = {name:"loop"}; obj.self = obj; console.log(obj);\n`,
    language: 'javascript',
    theme: 'vs-dark',
    fontSize: 14,
    automaticLayout: true,
    accessibilitySupport: 'off',
    minimap: { enabled: false },
  });

  // Focus fixes for mobile:
  // 1) make container focusable & focus editor on touchstart/click/mousedown
  editorContainer.setAttribute('tabindex', '0');
  function focusEditor(e) {
    // prevent double-handling on touch->mouse
    e.preventDefault && e.preventDefault();
    try { editor.focus(); } catch (err) {}
  }
  editorContainer.addEventListener('touchstart', focusEditor, { passive: false });
  editorContainer.addEventListener('mousedown', focusEditor);
  editorContainer.addEventListener('click', focusEditor);

  // also ensure editor dom node is focusable (safety)
  const dom = editor.getDomNode();
  if (dom && !dom.getAttribute('tabindex')) dom.setAttribute('tabindex', '0');

  // Buttons
  const runBtn = document.getElementById('run');
  const stopBtn = document.getElementById('stop');
  const saveBtn = document.getElementById('save');

  // Keyboard shortcuts
  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      runBtn.click();
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      saveBtn.click();
    }
  });

  // Safe serialize (handles objects, circular, Error, bigint, functions)
  function getCircularReplacer() {
    const seen = new WeakSet();
    return function(key, value) {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      if (typeof value === 'bigint') return value.toString() + 'n';
      return value;
    };
  }

  function serializeArg(arg) {
    const t = typeof arg;
    if (t === 'string') return arg;
    if (t === 'undefined') return 'undefined';
    if (t === 'function') return arg.toString();
    if (t === 'symbol') return arg.toString();
    if (arg instanceof Error) {
      return (arg && (arg.stack || arg.message)) || String(arg);
    }
    try {
      return JSON.stringify(arg, getCircularReplacer(), 2);
    } catch (e) {
      try { return String(arg); } catch (e2) { return '[Unserializable]'; }
    }
  }

  // Run user code inside sandbox via srcdoc
  runBtn.addEventListener('click', () => {
    document.getElementById('output').textContent = '';
    if (sandbox) {
      // keep sandbox hidden and non-interactive so editor still receives touches
      sandbox.style.display = 'none';
      sandbox.style.pointerEvents = 'none';
    }

    const userCode = editor.getValue();

    // Build srcdoc with watchdog & serialization
    const src = `
<!doctype html>
<html>
<body>
<script>
(function(){
  function getCircularReplacer(){ const seen = new WeakSet(); return function(k, v){ if (typeof v === 'object' && v !== null) { if (seen.has(v)) return '[Circular]'; seen.add(v); } if (typeof v === 'bigint') return v.toString() + 'n'; return v; } }
  function serializeArg(arg){
    const t = typeof arg;
    if (t === 'string') return arg;
    if (t === 'undefined') return 'undefined';
    if (t === 'function') return arg.toString();
    if (t === 'symbol') return arg.toString();
    if (arg instanceof Error) return (arg && (arg.stack || arg.message)) || String(arg);
    try { return JSON.stringify(arg, getCircularReplacer(), 2); } catch(e) { try { return String(arg); } catch(e2) { return '[Unserializable]'; } }
  }
  function send(level, ...args){
    try {
      const text = args.map(serializeArg).join(' ');
      parent.postMessage({ __playground_message: true, text: '[' + level.toUpperCase() + '] ' + text }, '*');
    } catch(e) {
      parent.postMessage({ __playground_message: true, text: '[ERROR] Could not serialize log' }, '*');
    }
  }
  console.log = (...a) => send('log', ...a);
  console.info = (...a) => send('info', ...a);
  console.warn = (...a) => send('warn', ...a);
  console.error = (...a) => send('error', ...a);

  // watchdog (timeout) to prevent infinite loops
  var WATCHDOG_MS = 7000;
  var wd = setTimeout(function(){ parent.postMessage({ __playground_message: true, text: '[ERROR] Execution timed out after ' + WATCHDOG_MS + 'ms' }, '*'); throw new Error('Execution timed out'); }, WATCHDOG_MS);

  try {
    // run user code
    var result = (function(){
      ${userCode.replace(/<\/script>/g, '<\\\\/script>')}
    })();
    if (typeof result !== 'undefined') send('result', result);
  } catch (err) {
    send('error', err);
  } finally {
    clearTimeout(wd);
  }
})();
<\/script>
</body>
</html>
    `;

    // inject into iframe (keeps iframe hidden so it won't block touches)
    sandbox.srcdoc = src;

    // small delay: sometimes mobile needs a moment (no harm)
    setTimeout(() => {
      // ensure sandbox still hidden and non-interactive
      sandbox.style.display = 'none';
      sandbox.style.pointerEvents = 'none';
    }, 50);
  });

  // stop: recreate sandbox (kills running scripts)
  stopBtn.addEventListener('click', () => {
    appendOutput('[INFO] Stopping sandbox and clearing state');
    sandbox.remove();
    sandbox = createSandbox();
  });

  // save to localStorage
  saveBtn.addEventListener('click', () => {
    const code = editor.getValue();
    localStorage.setItem('playground_code', code);
    appendOutput('[INFO] Saved to localStorage');
  });

  // load saved
  const saved = localStorage.getItem('playground_code');
  if (saved) editor.setValue(saved);
});
