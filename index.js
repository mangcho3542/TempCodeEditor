// index.js (수정판)
// - 실행은 오직 버튼 클릭으로만 트리거
// - postMessage 필터링: 오직 sandbox에서 보낸 {__playground_message: true}만 처리
// - 객체 직렬화 및 순환 참조 처리 유지

// Monaco loader path
require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' }});

function appendOutput(text) {
  const out = document.getElementById('output');
  out.textContent += text + '\n';
  out.scrollTop = out.scrollHeight;
}

function createSandbox() {
  const existing = document.getElementById('sandbox');
  if (existing) existing.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'sandbox';
  iframe.sandbox = 'allow-scripts';
  // 숨겨두고 pointer-events 비허용 -> 에디터 터치/포커스를 방해하지 않음
  iframe.style.display = 'none';
  iframe.style.pointerEvents = 'none';
  iframe.style.position = 'absolute';
  iframe.style.left = '-9999px';
  iframe.style.top = '-9999px';
  document.body.appendChild(iframe);
  return iframe;
}

let sandbox = createSandbox();

// 메시지 리스너: 오직 우리가 만든 메시지 포맷 + sandbox에서 온 메시지만 처리
window.addEventListener('message', (e) => {
  try {
    const d = e.data;
    // 엄격 필터: 반드시 객체이고, __playground_message === true, 그리고 출처가 현재 sandbox여야 함
    if (
      d &&
      typeof d === 'object' &&
      d.__playground_message === true &&
      sandbox &&
      e.source === sandbox.contentWindow
    ) {
      appendOutput(d.text);
    } else {
      // 무시: 다른 iframe/라이브러리에서 오는 객체형 메시지 때문에 [object Object] 찍는 것 방지
    }
  } catch (err) {
    // 방어 코드: 그래도 뭔가 터지면 무시
  }
});

// Monaco 초기화 및 에디터 생성
require(['vs/editor/editor.main'], function () {
  const editorContainer = document.getElementById('editorContainer');

  const editor = monaco.editor.create(document.getElementById('editor'), {
    value: `// 예시: 객체, 순환 참조 출력 확인\nconsole.log("hello mobile");\nconsole.log({a:1, b:[1,2,3]});\nconst obj = {name:"loop"}; obj.self = obj; console.log(obj);\n`,
    language: 'javascript',
    theme: 'vs-dark',
    fontSize: 14,
    automaticLayout: true,
    accessibilitySupport: 'off',
    minimap: { enabled: false },
  });

  // 모바일 포커스 보정: container를 클릭/터치하면 에디터에 포커스
  editorContainer.setAttribute('tabindex', '0');
  function focusEditor(e) {
    e.preventDefault && e.preventDefault();
    try { editor.focus(); } catch (err) {}
  }
  editorContainer.addEventListener('touchstart', focusEditor, { passive: false });
  editorContainer.addEventListener('mousedown', focusEditor);
  editorContainer.addEventListener('click', focusEditor);

  // 보조: editor DOM에도 tabindex
  const dom = editor.getDomNode();
  if (dom && !dom.getAttribute('tabindex')) dom.setAttribute('tabindex', '0');

  // 버튼들
  const runBtn = document.getElementById('run');
  const stopBtn = document.getElementById('stop');
  const saveBtn = document.getElementById('save');

  // 주의: 실행은 오직 버튼 클릭으로만 트리거. (Ctrl/Cmd+Enter 바인딩 제거)
  runBtn.addEventListener('click', () => {
    document.getElementById('output').textContent = '';

    // 보이지 않게 유지 (포인터 차단) — editor 터치 방해하지 않음
    if (sandbox) {
      sandbox.style.display = 'none';
      sandbox.style.pointerEvents = 'none';
    }

    const userCode = editor.getValue();

    // 샌드박스에 주입할 srcdoc. 순환참조/에러/워치독 처리 포함.
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

  // watchdog (timeout) : 무한루프 방지
  var WATCHDOG_MS = 7000;
  var wd = setTimeout(function(){ parent.postMessage({ __playground_message: true, text: '[ERROR] Execution timed out after ' + WATCHDOG_MS + 'ms' }, '*'); throw new Error('Execution timed out'); }, WATCHDOG_MS);

  try {
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

    // 주입 (iframe은 계속 hidden 상태)
    sandbox.srcdoc = src;

    // 약간의 지연 후에도 iframe이 보이지 않도록
    setTimeout(() => {
      if (sandbox) {
        sandbox.style.display = 'none';
        sandbox.style.pointerEvents = 'none';
      }
    }, 50);
  });

  // Stop: sandbox 재생성으로 현재 실행 중인 스크립트 제거
  stopBtn.addEventListener('click', () => {
    appendOutput('[INFO] Stopping sandbox and clearing state');
    sandbox.remove();
    sandbox = createSandbox();
  });

  // Save: 로컬 저장
  saveBtn.addEventListener('click', () => {
    const code = editor.getValue();
    localStorage.setItem('playground_code', code);
    appendOutput('[INFO] Saved to localStorage');
  });

  // 로드된 코드가 있으면 복원
  const saved = localStorage.getItem('playground_code');
  if (saved) editor.setValue(saved);
});
