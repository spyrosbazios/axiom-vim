const $ = id => document.getElementById(id);
let recording = false;

function refresh() {
  chrome.storage.sync.get(AXS_DEFAULTS, s => {
    $('enabled').checked = s.enabled;
    $('vimNav').checked = s.vimNav;
    if (document.activeElement !== $('zoomSteps')) $('zoomSteps').value = s.zoomSteps;
    if (!recording) $('hideKey').textContent = axsKeyLabel(s.hideKey);
    $('hideHint').textContent = $('pairHideHint').textContent = axsKeyLabel(s.hideKey);
    document.body.classList.toggle('vim-off', !s.vimNav);
    for (const row of document.querySelectorAll('.teach')) {
      const value = s[row.dataset.key];
      row.querySelector('code').textContent = value || row.dataset.empty;
      row.querySelector('.r').disabled = !value;
    }
  });
}

function status(text) {
  $('status').textContent = text;
  $('status').hidden = !text;
}

refresh();
chrome.storage.onChanged.addListener(refresh);

// The Keys section stays open or closed the way you left it.
try { $('help').open = localStorage.getItem('axs:helpOpen') === '1'; } catch {}
$('help').ontoggle = () => { try { localStorage.setItem('axs:helpOpen', $('help').open ? '1' : '0'); } catch {} };

$('enabled').onchange = e => chrome.storage.sync.set({ enabled: e.target.checked });
$('vimNav').onchange = e => chrome.storage.sync.set({ vimNav: e.target.checked });
$('zoomSteps').onchange = e => {
  const n = Math.round(Number(e.target.value));
  chrome.storage.sync.set({ zoomSteps: n >= 1 ? Math.min(20, n) : AXS_DEFAULTS.zoomSteps }); // blank or junk: default
  refresh();
};

// --- Hide key recorder

$('hideKey').onclick = () => {
  recording = true;
  $('hideKey').textContent = 'Press a key…';
  $('hideKey').classList.add('recording');
};

function stopRecording() {
  recording = false;
  $('hideKey').classList.remove('recording');
  refresh();
}

$('hideKey').onblur = () => recording && stopRecording();
document.addEventListener('pointerdown', e => recording && e.target !== $('hideKey') && stopRecording());

document.addEventListener('keydown', e => {
  if (!recording) return;
  if (e.key === 'Tab') return stopRecording(); // moving on: let Tab do its job
  e.preventDefault();
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
  if (e.key !== 'Escape') {
    chrome.storage.sync.set({
      hideKey: { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }
    });
  }
  stopRecording();
});

// --- Teach and debug: talk to the content script in the active tab

async function ask(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    status('Open (or reload) an axiom.trade tab first, then try again.');
    return null;
  }
}

for (const row of document.querySelectorAll('.teach')) {
  row.querySelector('.t').onclick = async () => {
    const res = await ask({ type: 'axs:teach', what: row.dataset.what });
    if (res?.ok) window.close();
    else if (res) status(res.message || 'Could not start Teach.');
  };
  row.querySelector('.r').onclick = () => chrome.storage.sync.set({ [row.dataset.key]: '' });
}

$('debug').onclick = async () => {
  const res = await ask({ type: 'axs:debug' });
  if (!res) return;
  if (!res.ok || !res.text) return status(res.message || 'Could not collect debug info.');
  try {
    await navigator.clipboard.writeText(res.text);
    status('Debug info copied. Paste it to Claude.');
  } catch {
    // Clipboard blocked: show it so it can be copied by hand.
    $('debugText').hidden = false;
    $('debugText').value = res.text;
    $('debugText').select();
    status('Copy the text above (Ctrl+C) and paste it to Claude.');
  }
};
