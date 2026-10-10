// Shared by the content script and the popup.

// Axiom's trade-page tab names: how the tab bar (and so the Holders tab) is recognized.
const AXS_TRADE_TABS = ['Trades', 'Positions', 'Orders', 'Holders', 'Top Traders', 'Dev Tokens'];

const AXS_DEFAULTS = {
  enabled: true,
  vimNav: true,
  // Mouse-wheel notches per z press on the trade-page chart.
  zoomSteps: 4,
  // Stored by physical key (`code`), so it works with any keyboard layout (e.g. Greek).
  // Shift+X, because plain x is Axiom's own Twitter-preview key.
  hideKey: { code: 'KeyX', ctrl: false, alt: false, shift: true, meta: false },
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

// Fixed vim keys, by physical key. Only active on /pulse.
const AXS_NAV_KEYS = { KeyH: 'left', KeyJ: 'down', KeyK: 'up', KeyL: 'right' };
// Shift + key, Vimium-style browser history. Active on all axiom.trade pages.
const AXS_HISTORY_KEYS = { KeyH: 'back', KeyL: 'forward' };

// Pulse column titles (lowercase), left to right. hjkl only moves between coins inside these columns;
// the first Final Stretch coin is preselected when you arrive on Pulse.
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
  return e.code === k.code &&
    e.ctrlKey === !!k.ctrl && e.altKey === !!k.alt &&
    e.shiftKey === !!k.shift && e.metaKey === !!k.meta;
}

function axsKeyLabel(k) {
  const name = k.code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
  return [k.ctrl && 'Ctrl', k.alt && 'Alt', k.shift && 'Shift', k.meta && 'Meta', name]
    .filter(Boolean).join(' + ');
}
