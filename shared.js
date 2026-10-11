// Shared by the content script and the popup.

// Axiom's trade-page tab names: how the tab bar (and so the Holders tab) is recognized.
const AXS_TRADE_TABS = ['Trades', 'Positions', 'Orders', 'Holders', 'Top Traders', 'Dev Tokens'];

const AXS_DEFAULTS = {
  enabled: true,
  vimNav: true,
  // Mouse-wheel notches per zoom-out press on the trade-page chart.
  zoomSteps: 4,
  // Keys changed in the popup, by action id (see AXS_ACTIONS). Actions not in here keep their default.
  keys: {},
  // CSS selectors learned with the popup's Teach rows. Empty = auto-detect, except pairHideSelector:
  // without it the hide key does nothing on trade pages.
  hideSelector: '',
  pairHideSelector: '',
  holdersSelector: '',
  twitterSelector: '',
  websiteSelector: '',
  tabBarSelector: '',
  blacklistSelector: ''
};

// Where a shortcut works: Pulse, trade pages, both, or every axiom.trade page.
const AXS_PULSE = ['pulse'];
const AXS_TRADE = ['pair'];
const AXS_BOTH = ['pulse', 'pair'];
const AXS_ANYWHERE = ['pulse', 'pair', 'other'];

// Every shortcut with its default key, in the popup's order. Keys go by physical key (`code`), so they
// work with any keyboard layout (e.g. Greek). vim: turned off by the popup's "Vim keys" switch.
// If two share a key on a page, the first one listed that applies there gets it.
const AXS_ACTIONS = [
  { id: 'down', pages: AXS_PULSE, vim: true, label: 'Next coin', key: axsKey('KeyJ') },
  { id: 'up', pages: AXS_PULSE, vim: true, label: 'Previous coin', key: axsKey('KeyK') },
  { id: 'left', pages: AXS_PULSE, vim: true, label: 'Previous column or side panel', key: axsKey('KeyH') },
  { id: 'right', pages: AXS_PULSE, vim: true, label: 'Next column or side panel', key: axsKey('KeyL') },
  { id: 'open', pages: AXS_PULSE, vim: true, label: 'Open the selected coin', key: axsKey('Enter') },
  { id: 'clear', pages: AXS_PULSE, vim: true, label: 'Clear the selection', key: axsKey('Escape') },
  // Shift+X, because plain x is Axiom's own X-preview key on Pulse.
  { id: 'hide', pages: AXS_BOTH, label: 'Hide the coin (trade page: then go back, after Teach)', key: axsKey('KeyX', 'shift') },
  { id: 'website', pages: AXS_BOTH, label: 'Open its website in a new window', key: axsKey('KeyW') },
  { id: 'holdersDown', pages: AXS_TRADE, vim: true, label: 'Scroll Holders down a row', key: axsKey('KeyJ') },
  { id: 'holdersUp', pages: AXS_TRADE, vim: true, label: 'Scroll Holders up a row', key: axsKey('KeyK') },
  { id: 'xPreview', pages: AXS_TRADE, label: 'X preview while held', key: axsKey('KeyX') },
  { id: 'closePreview', pages: AXS_TRADE, label: 'Close the X preview', key: axsKey('Escape') },
  { id: 'zoomOut', pages: AXS_TRADE, label: 'Zoom the chart out (hold to keep going)', key: axsKey('KeyZ') },
  { id: 'zoomReset', pages: AXS_TRADE, label: 'Reset the chart view', key: axsKey('KeyZ', 'shift') },
  { id: 'blacklist', pages: AXS_TRADE, label: 'Blacklist dev, hide, go back', key: axsKey('KeyB', 'shift') },
  { id: 'back', pages: AXS_ANYWHERE, vim: true, label: 'Back', key: axsKey('KeyH', 'shift') },
  { id: 'forward', pages: AXS_ANYWHERE, vim: true, label: 'Forward', key: axsKey('KeyL', 'shift') }
];

function axsKey(code, ...mods) {
  return { code, ctrl: mods.includes('ctrl'), alt: mods.includes('alt'), shift: mods.includes('shift'), meta: mods.includes('meta') };
}

// Every action's key: the one set in the popup, else its default. `keys` is the stored setting.
function axsKeymap(keys) {
  return Object.fromEntries(AXS_ACTIONS.map(a => [a.id, typeof keys?.[a.id]?.code === 'string' ? keys[a.id] : a.key]));
}

function axsSameKey(a, b) {
  return a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta;
}

// Before 0.4 only the hide key could be changed, stored as `hideKey`: move it into `keys`.
async function axsMigrateKeys() {
  const { hideKey, keys } = await chrome.storage.sync.get(['hideKey', 'keys']);
  if (!hideKey) return;
  await chrome.storage.sync.set({ keys: { hide: hideKey, ...keys } });
  await chrome.storage.sync.remove('hideKey');
}

// Pulse column titles (lowercase), left to right. hjkl moves between coins inside these columns, plus
// the items of the side panels beside them; the first Final Stretch coin is preselected when you arrive on Pulse.
const AXS_PULSE_COLUMNS = ['new pairs', 'final stretch', 'migrated'];

// Token (trade) page path. Enter follows a link like this inside the selected coin; j/k scroll holders there.
const AXS_PAIR_PATH = /^\/meme\//;

// X/Twitter link hosts. On a trade page, x hovers the token's link to show Axiom's preview.
const AXS_TWITTER_HOST = /(^|\.)(x|twitter)\.com$/i;

// Links that aren't the token's own website: socials, explorers, other trading sites, image search.
const AXS_NOT_WEBSITE_HOST = /(^|\.)(x\.com|twitter\.com|t\.me|telegram\.(me|org)|discord\.(gg|com)|solscan\.io|solana\.fm|explorer\.solana\.com|dexscreener\.com|birdeye\.so|pump\.fun|gmgn\.ai|bullx\.io|photon-sol\.tinyastro\.io|axiom\.trade|google\.com|tiktok\.com|youtube\.com|instagram\.com)$/i;

// Used until a selector is taught. Earlier entries win ties.
const AXS_AUTO_HIDE_SELECTORS = [
  '[class*="eye-off"]',
  '[class*="eye-slash"]',
  '[class*="EyeOff"]',
  '[class*="eyeOff"]',
  '[aria-label*="hide" i]',
  '[title*="hide" i]',
  '[data-tooltip-content*="hide" i]',
  '[data-tip*="hide" i]'
];

function axsKeyMatches(e, k) {
  return (e.code === k.code || (e.code === 'NumpadEnter' && k.code === 'Enter')) &&
    e.ctrlKey === !!k.ctrl && e.altKey === !!k.alt &&
    e.shiftKey === !!k.shift && e.metaKey === !!k.meta;
}

const AXS_KEY_NAMES = {
  Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-',
  Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',',
  Period: '.', Slash: '/'
};

// A plain letter shows as typed (j); with modifiers, like a shortcut (Shift + J).
function axsKeyLabel(k) {
  const mods = [k.ctrl && 'Ctrl', k.alt && 'Alt', k.shift && 'Shift', k.meta && 'Meta'].filter(Boolean);
  let name = AXS_KEY_NAMES[k.code] || k.code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
  if (!mods.length && /^Key[A-Z]$/.test(k.code)) name = name.toLowerCase();
  return [...mods, name].join(' + ');
}
