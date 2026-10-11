const $ = id => document.getElementById(id);
let recording = null; // id of the action whose new key is being recorded

// The Keys section: a table per group of AXS_ACTIONS, plus notes on keys that stay Axiom's.
const KEY_GROUPS = [
  { pages: AXS_PULSE, title: 'Pulse', notes: [['x', "X preview of the selected coin (Axiom's own key)"]] },
  { pages: AXS_BOTH, title: 'Pulse and trade page' },
  { pages: AXS_TRADE, title: 'Trade page' },
  { pages: AXS_ANYWHERE, title: 'Anywhere', notes: [['Space', 'Held with another key: left to Axiom (e.g. quick buy)']] }
];

function buildKeyTables() {
  for (const group of KEY_GROUPS) {
    const table = document.createElement('table');
    for (const action of AXS_ACTIONS.filter(a => a.pages === group.pages)) {
      const row = table.insertRow();
      row.dataset.id = action.id;
      row.classList.toggle('vim', !!action.vim);
      const key = document.createElement('button');
      key.className = 'key';
      key.onclick = () => startRecording(action.id);
      key.onblur = () => recording === action.id && stopRecording();
      const reset = document.createElement('button');
      reset.className = 'reset';
      reset.textContent = '↺';
      reset.title = `Back to ${axsKeyLabel(action.key)}`;
      reset.onclick = () => setKey(action.id, null);
      row.insertCell().append(key);
      row.insertCell().textContent = action.label;
      row.insertCell().append(reset);
    }
    for (const [keys, text] of group.notes || []) {
      const row = table.insertRow();
      const kbd = document.createElement('kbd');
      kbd.textContent = keys;
      row.insertCell().append(kbd);
      const cell = row.insertCell();
      cell.colSpan = 2;
      cell.className = 'muted';
      cell.textContent = text;
    }
    const title = document.createElement('h2');
    title.textContent = group.title;
    $('keyTables').append(title, table);
  }
}

function refresh() {
  chrome.storage.sync.get(AXS_DEFAULTS, s => {
    $('enabled').checked = s.enabled;
    $('vimNav').checked = s.vimNav;
    if (document.activeElement !== $('zoomSteps')) $('zoomSteps').value = s.zoomSteps;
    document.body.classList.toggle('off', !s.enabled);
    document.body.classList.toggle('vim-off', !s.vimNav);
    const keymap = axsKeymap(s.keys);
    const changed = AXS_ACTIONS.filter(a => !axsSameKey(keymap[a.id], a.key)).length;
    $('keysMeta').textContent = changed ? `${changed} changed` : 'All default';
    for (const action of AXS_ACTIONS) {
      const row = document.querySelector(`tr[data-id="${action.id}"]`);
      const key = row.querySelector('.key');
      const clash = clashWith(action, keymap);
      // While recording, the keycap shows a blinking cursor and the label says what to do.
      key.textContent = recording === action.id ? '' : axsKeyLabel(keymap[action.id]);
      key.classList.toggle('recording', recording === action.id);
      row.classList.toggle('recording', recording === action.id);
      row.cells[1].textContent = recording === action.id ? 'Press the new key…' : action.label;
      key.title = clash ? `Also “${clash.label}”: change one of them` : 'Click, then press the new key';
      row.classList.toggle('conflict', !!clash);
      row.classList.toggle('changed', !axsSameKey(keymap[action.id], action.key));
      row.querySelector('.reset').disabled = axsSameKey(keymap[action.id], action.key);
    }
    $('resetKeys').disabled = AXS_ACTIONS.every(a => axsSameKey(keymap[a.id], a.key));
    let taught = 0;
    for (const row of document.querySelectorAll('.teach')) {
      const value = s[row.dataset.key];
      const code = row.querySelector('code');
      code.textContent = value || row.dataset.empty;
      code.title = value; // long selectors are cut to one line
      row.classList.toggle('taught', !!value);
      row.querySelector('.r').disabled = !value;
      if (value) taught++;
    }
    $('teachMeta').textContent = taught ? `${taught} taught` : 'Auto-detect';
  });
}

// Another action with the same key, on a page both work on.
function clashWith(action, keymap) {
  return AXS_ACTIONS.find(o => o !== action && axsSameKey(keymap[o.id], keymap[action.id]) && o.pages.some(p => action.pages.includes(p)));
}

function status(text) {
  $('status').textContent = text;
  $('status').hidden = !text;
}

buildKeyTables();
axsMigrateKeys().catch(() => {});
refresh();
chrome.storage.onChanged.addListener(refresh);

$('version').textContent = `v${chrome.runtime.getManifest().version}`;

// Keys and Teach stay open or closed the way you left them (Keys starts closed, Teach open).
for (const [id, store, openByDefault] of [['help', 'axs:helpOpen', false], ['teachFold', 'axs:teachOpen', true]]) {
  try {
    const saved = localStorage.getItem(store);
    $(id).open = saved === null ? openByDefault : saved === '1';
  } catch {}
  $(id).ontoggle = () => { try { localStorage.setItem(store, $(id).open ? '1' : '0'); } catch {} };
}

$('enabled').onchange = e => chrome.storage.sync.set({ enabled: e.target.checked });
$('vimNav').onchange = e => chrome.storage.sync.set({ vimNav: e.target.checked });
$('zoomSteps').onchange = e => {
  const n = Math.round(Number(e.target.value));
  chrome.storage.sync.set({ zoomSteps: n >= 1 ? Math.min(20, n) : AXS_DEFAULTS.zoomSteps }); // blank or junk: default
  refresh();
};

// --- Key recorder: click a key in the Keys section, then press the new one

function startRecording(id) {
  recording = id;
  status('');
  refresh();
}

function stopRecording() {
  recording = null;
  refresh();
}

document.addEventListener('pointerdown', e => {
  if (recording && !e.target.closest?.(`tr[data-id="${recording}"] .key`)) stopRecording();
});

document.addEventListener('keydown', e => {
  if (!recording) return;
  if (e.key === 'Tab') return stopRecording(); // moving on: let Tab do its job
  e.preventDefault();
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
  const id = recording;
  stopRecording();
  if (e.key === 'Escape' || !e.code) return;
  // While Space is held every key goes to Axiom (its Space + key hotkeys), so a Space key would never work.
  if (e.code === 'Space') return status("Space is left to Axiom for its Space + key hotkeys, so it can't be used.");
  setKey(id, { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
});

// Saves an action's key (null: back to its default) and says if another action now has the same key.
async function setKey(id, key) {
  const action = AXS_ACTIONS.find(a => a.id === id);
  const { keys } = await chrome.storage.sync.get({ keys: {} });
  const next = { ...keys };
  if (!key || axsSameKey(key, action.key)) delete next[id];
  else next[id] = key;
  await chrome.storage.sync.set({ keys: next });
  const keymap = axsKeymap(next);
  const clash = clashWith(action, keymap);
  status(clash ? `${axsKeyLabel(keymap[id])} is also “${clash.label}”. Change one of them.` : '');
}

$('resetKeys').onclick = () => {
  chrome.storage.sync.set({ keys: {} });
  status('');
};

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
  // Always shown too, so it can be copied by hand if the clipboard doesn't take it.
  $('debugText').hidden = false;
  $('debugText').value = res.text;
  $('debugText').select();
  try {
    await navigator.clipboard.writeText(res.text);
    status('Debug info copied. Paste it to Claude (or copy it from the box above).');
  } catch {
    status('Copy the text above (Ctrl+C) and paste it to Claude.');
  }
};
