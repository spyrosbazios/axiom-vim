// Axiom Vim. Default keys (every one can be changed in the popup, see AXS_ACTIONS):
// Pulse: vim-style navigation (h/j/k/l, Enter opens, w website, Shift+X hides) through the coin
// columns and the side panels, starting on the first Final Stretch coin; the selected coin
// counts as hovered, so Axiom's own hover shortcuts (x = Twitter preview) act on it.
// Trade page: j/k scroll Holders, hold x for the X preview, w opens the website,
// z/Z zoom the chart out/reset; Shift+B blacklists the dev, hides the token and goes back; Shift+X
// hides the token and goes back.
// Anywhere: Shift+H / Shift+L go back / forward.

(() => {
  // --- State ------------------------------------------------------------------------

  let settings = { ...AXS_DEFAULTS };
  let mouse = null; // last real pointer position; null when the pointer is outside the window
  let kbdAnchor = null; // mouse position when the keyboard last took over (or the page/route started)
  let mouseMoved = false; // has the mouse moved since then? Only then does "the coin under the mouse" count
  let lastPath = location.pathname;
  let cursor = null; // selected coin: { el, column (title), clip, y (ring centre), fp, below, above, looks, prev }
  let ring = null;
  let rafId = 0;
  let hovered = null; // element that last got our synthetic hover
  let holders = null; // cached { tab, list }
  let holdersMissAt = 0; // when holders detection last failed (to avoid rescanning on every key repeat)
  let columnCache = { columns: [], at: 0 };
  let teaching = false; // or the TEACH key being taught
  let xHeld = false; // the X preview is open because x is held down
  let spaceHeld = false; // Space+key is one of Axiom's own hotkeys (e.g. quick buy): leave those alone
  let preselectTimer = 0;
  let pairHidePending = false; // a hide / blacklist is leaving the trade page: ignore repeat presses
  let toastEl = null;
  let toastTimer = 0;
  let lastToast = ''; // for debug info
  const watchedDocs = new WeakSet();

  // --- Setup --------------------------------------------------------------------------

  axsMigrateKeys().catch(() => {});
  chrome.storage.sync.get(AXS_DEFAULTS, s => { settings = s; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue ?? AXS_DEFAULTS[k];
    if (!settings.enabled || !settings.vimNav) clearCursor();
    forgetHolders();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === 'axs:debug') {
      try {
        reply({ ok: true, text: debugInfo() });
      } catch (err) {
        reply({ ok: false, message: `Debug info failed: ${err.message}` });
      }
      return;
    }
    if (msg?.type !== 'axs:teach') return;
    const what = msg.what || (onPairPage() ? 'pairHide' : 'pulseHide');
    const spec = TEACH[what];
    const here = onPulse() ? 'pulse' : onPairPage() ? 'pair' : '';
    if (!spec) return reply({ ok: false, message: 'Unknown item to teach.' });
    if (spec.where !== here) return reply({ ok: false, message: spec.where === 'pulse' ? 'Open Pulse first.' : 'Open a trade page first.' });
    startTeaching(what);
    reply({ ok: true });
  });

  addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  addEventListener('keydown', onKeyDown, true);
  addEventListener('keyup', onKeyUp, true);
  // Registered before the hover guard below, which may stop these events.
  addEventListener('mouseout', e => { if (e.isTrusted && !e.relatedTarget) mouse = null; }, true);
  // While we hover a coin for the keyboard, real hover changes (e.g. the list scrolling under a
  // resting mouse) are held back so they can't steal it.
  for (const type of ['pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave']) {
    addEventListener(type, e => {
      if (hovered && !hovered.isConnected) hovered = null; // page changed under us
      if (hovered && e.isTrusted) e.stopImmediatePropagation();
    }, true);
  }
  addEventListener('pointerdown', e => { if (e.isTrusted) holdersMissAt = 0; }, true); // a click may open the Holders tab
  addEventListener('blur', () => {
    if (!document.hasFocus()) { // left the window while holding x or Space: their keyups won't come
      releaseX();
      spaceHeld = false;
    }
    setTimeout(watchFrames); // or focus just moved into an iframe
  });
  document.addEventListener('load', e => { if (e.target.tagName === 'IFRAME') watchFrames(); }, true); // never reaches window
  const timers = [setInterval(watchFrames, 1000), setInterval(checkRoute, 250)];
  setTimeout(watchFrames); // iframes that loaded before this script ran
  schedulePreselect();

  // After the extension is reloaded or removed this copy keeps running in open tabs; make it inert.
  function alive() {
    try {
      if (chrome.runtime?.id) return true;
    } catch {}
    timers.forEach(clearInterval);
    clearCursor();
    if (teaching) stopTeaching('');
    return false;
  }

  // --- Mouse and route ----------------------------------------------------------------

  function onPointerMove(e) {
    if (!e.isTrusted || !alive()) return; // untrusted = our own keyboard-hover events
    mouse = { x: e.clientX, y: e.clientY };
    if (!kbdAnchor) {
      kbdAnchor = mouse;
      return;
    }
    if (mouseMoved || Math.hypot(mouse.x - kbdAnchor.x, mouse.y - kbdAnchor.y) <= 10) return;
    // Moving the mouse hands control back to it: drops the keyboard selection and keyboard hover,
    // so the hide key never hits a coin you didn't pick.
    mouseMoved = true;
    xHeld = false;
    if (cursor) clearCursor();
    else unhover();
  }

  function keyboardTookOver() {
    kbdAnchor = mouse && { ...mouse };
    mouseMoved = false;
  }

  // Single-page navigation: leaving or coming back to a page starts afresh.
  function checkRoute() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    releaseX();
    clearCursor();
    keyboardTookOver();
    pairHidePending = false;
    forgetHolders();
    if (teaching) stopTeaching('Teach cancelled (page changed)');
    schedulePreselect();
  }

  // --- Keys ---------------------------------------------------------------------------

  function onKeyDown(e) {
    if (!e.isTrusted || !alive()) return; // untrusted: e.g. our own Alt+R to the chart
    if (e.code === 'Space') spaceHeld = true;
    if (teaching) {
      if (e.key === 'Escape') {
        consume(e);
        stopTeaching('Teach cancelled');
      }
      return;
    }
    checkRoute();
    if (!settings.enabled || e.isComposing || isTyping(e) || spaceHeld) return;
    const page = onPulse() ? 'pulse' : onPairPage() ? 'pair' : 'other';
    const keymap = axsKeymap(settings.keys);
    // A key the action can't use here (e.g. Esc with nothing selected) goes on to the next one, then the page.
    for (const action of AXS_ACTIONS) {
      if (!action.pages.includes(page) || (action.vim && !settings.vimNav) || !axsKeyMatches(e, keymap[action.id])) continue;
      if (RUN[action.id](e)) return consume(e);
    }
  }

  // Moving always uses the key, even at the end of a column.
  const move = dir => () => {
    navigate(dir);
    return true;
  };

  // What each action does (ids as in AXS_ACTIONS). Returns true if it used the key, so the page doesn't
  // get it too. Holding a key repeats moving, scrolling and zooming out; the others ignore the repeats.
  const RUN = {
    down: move('down'),
    up: move('up'),
    left: move('left'),
    right: move('right'),
    open: e => {
      if (!cursor) return false;
      if (!e.repeat) openCurrent();
      return true;
    },
    clear: () => {
      if (!cursor) return false;
      clearCursor();
      return true;
    },
    hide: e => e.repeat || (onPulse() ? hideCurrent() : hidePairAndGoBack()), // holding it must not hide a whole column
    website: e => e.repeat || (onPulse() ? openCoinWebsite() : openWebsite()),
    holdersDown: () => scrollHolders(1),
    holdersUp: () => scrollHolders(-1),
    // The X preview shows while the key is held (see onKeyUp).
    xPreview: e => {
      if (e.repeat) return true;
      if (!hoverTwitter()) return false;
      xHeld = true;
      return true;
    },
    closePreview: () => {
      if (!hovered) return false;
      releaseX();
      unhover();
      return true;
    },
    zoomOut: () => zoomChart(false),
    zoomReset: e => e.repeat || zoomChart(true),
    blacklist: e => e.repeat || blacklistHideAndGoBack(),
    back: e => {
      if (!e.repeat) history.back();
      return true;
    },
    forward: e => {
      if (!e.repeat) history.forward();
      return true;
    }
  };

  // The current key of an action, for messages.
  function keyName(id) {
    return axsKeyLabel(axsKeymap(settings.keys)[id]);
  }

  function onKeyUp(e) {
    if (e.isTrusted && e.code === 'Space') spaceHeld = false;
    // Modifiers don't matter here: they may be let go first.
    if (e.isTrusted && xHeld && e.code === axsKeymap(settings.keys).xPreview.code) {
      consume(e);
      releaseX();
    }
  }

  // Ends the hold-x preview.
  function releaseX() {
    if (!xHeld) return;
    xHeld = false;
    unhover();
  }

  function consume(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onPulse() {
    return location.pathname.startsWith('/pulse');
  }

  function onPairPage() {
    return AXS_PAIR_PATH.test(location.pathname);
  }

  const NOT_TEXT_INPUT = /^(checkbox|radio|range|button|submit|reset|color|file|image)$/i;

  function isTyping(e) {
    const t = e.composedPath()[0];
    // nodeType instead of instanceof: keys can come from iframes (e.g. the chart), another realm.
    if (t?.nodeType !== 1) return false;
    if (t.tagName === 'INPUT') return !NOT_TEXT_INPUT.test(t.type);
    return t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
  }

  // --- Pulse: coins and columns ---------------------------------------------------------

  // Every coin card has exactly one hide control, so the controls tell us where the cards are.
  // Only controls inside the Pulse columns count, so menus and dropdowns are ignored. Side panels
  // (e.g. Axiom's wallet tracker and Discover) are extra columns at either end, see sidePanels.
  // Returns { found, columns: [[hit]], byCard: Map<cardEl, hit>, middle },
  // hit = { card, control, rect, column (title), col, idx }; control is null for a panel item without
  // a hide button. `found` is false if no column titles were found.
  function scanCards() {
    const pulseCols = pulseColumns();
    const roots = pulseCols.map(c => c.root);
    const sels = settings.hideSelector ? [settings.hideSelector] : AXS_AUTO_HIDE_SELECTORS;
    const kindOf = new Map();
    sels.forEach((sel, i) => {
      for (const el of queryAll(sel)) {
        if (!kindOf.has(el) && el.getClientRects().length && roots.some(r => r.contains(el))) kindOf.set(el, `${i}:${el.tagName}`);
      }
    });

    // Keep only the most common kind: a lone "Hide …" button in a column header is not a coin.
    let controls = outermost([...kindOf.keys()]);
    const counts = new Map();
    for (const c of controls) counts.set(kindOf.get(c), (counts.get(kindOf.get(c)) || 0) + 1);
    const kind = [...counts].sort((a, b) => b[1] - a[1] || parseInt(a[0]) - parseInt(b[0]))[0]?.[0];
    controls = controls.filter(c => kindOf.get(c) === kind);

    // A card is the largest ancestor that holds exactly one control (and isn't column-sized).
    const under = new Map();
    for (const c of controls) {
      for (let n = c.parentElement; n && n !== document.body; n = n.parentElement) under.set(n, (under.get(n) || 0) + 1);
    }
    const maxCardHeight = innerHeight * 0.4;
    const hits = controls.map(control => {
      let card = control;
      for (let p = control.parentElement; p && p !== document.body && under.get(p) === 1 &&
        p.getBoundingClientRect().height <= maxCardHeight && !roots.some(r => p.contains(r)); p = p.parentElement) card = p;
      card = unwrap(card);
      return { card, control, rect: card.getBoundingClientRect() };
    });

    // A hover toolbar can give the hovered coin a second control, which splits it into small pieces.
    // Grow any piece much smaller than a typical coin to the coin around it, then drop duplicates.
    const heights = hits.map(h => h.rect.height).sort((a, b) => a - b);
    const typical = heights[Math.floor(heights.length / 2)] || 0;
    for (const h of hits) {
      if (h.rect.height >= typical * 0.5) continue;
      for (let p = h.card.parentElement; p && p !== document.body && !roots.includes(p); p = p.parentElement) {
        const r = p.getBoundingClientRect();
        if (r.height > typical * 1.6) break; // that's the list, not the coin
        h.card = p;
        h.rect = r;
        if (r.height >= typical * 0.7) break;
      }
    }
    const coins = hits.filter((h, i) => !hits.some((o, j) => (o.card === h.card ? j < i : o.card.contains(h.card))));

    // One column per Pulse column, left to right, coins top to bottom, with the side panels at either
    // end. Empty columns are skipped.
    const perPulse = pulseCols.map(({ title, root }) => {
      const col = coins.filter(h => root.contains(h.card)).sort((a, b) => a.rect.top - b.rect.top);
      col.forEach(h => { h.column = title; });
      return col;
    });
    const panels = sidePanels(pulseCols);
    const perColumn = [...panels.left.map(panelItems), ...perPulse, ...panels.right.map(panelItems)];
    const columns = perColumn.filter(col => col.length);
    columns.forEach((col, c) => col.forEach((h, i) => { h.col = c; h.idx = i; }));
    // Start in the middle Pulse column (Final Stretch); if it's empty, the middle of the Pulse columns left.
    const filled = perPulse.filter(col => col.length);
    const mid = perPulse[Math.floor((perPulse.length - 1) / 2)];
    const middle = columns.indexOf(mid?.length ? mid : filled[Math.floor(filled.length / 2)]);
    return {
      found: pulseCols.length > 0,
      columns,
      byCard: new Map(columns.flat().map(h => [h.card, h])),
      middle: middle >= 0 ? middle : Math.floor(columns.length / 2)
    };
  }

  // Side panels: tall boxes beside the Pulse columns, like Axiom's wallet tracker (left) and Discover
  // (right). Only the columns' relatives count, and nothing floating, so popups and menus never do.
  // Returns { left, right }: [{ title, root }] each, left to right. Titles count out from the columns:
  // "right panel", "right panel 2", …
  function sidePanels(pulseCols) {
    const roots = pulseCols.map(c => c.root);
    if (!roots.length) return { left: [], right: [] };
    const rects = roots.map(r => r.getBoundingClientRect());
    const left = Math.min(...rects.map(r => r.left));
    const right = Math.max(...rects.map(r => r.right));
    const top = Math.min(...rects.map(r => r.top));
    const bottom = Math.max(...rects.map(r => r.bottom));
    let common = roots[0];
    while (!roots.every(r => common.contains(r))) common = common.parentElement;

    const found = [];
    for (let p = common; p && p !== document.documentElement; p = p.parentElement) {
      for (const el of p.children) {
        if (roots.some(r => el.contains(r))) continue;
        const r = el.getBoundingClientRect();
        if ((r.right <= left + 2 || r.left >= right - 2) && r.width >= 120 && r.width <= innerWidth * 0.5 &&
          r.height >= innerHeight * 0.4 && r.top < bottom && r.bottom > top && r.right > 0 && r.left < innerWidth &&
          getComputedStyle(el).position !== 'fixed') found.push({ root: el, r });
      }
    }
    const named = (side, list) => list.map((p, i) => ({ root: p.root, title: `${side} panel${i ? ` ${i + 1}` : ''}` }));
    return {
      left: named('left', found.filter(p => p.r.right <= left + 2).sort((a, b) => b.r.left - a.r.left)).reverse(),
      right: named('right', found.filter(p => p.r.left >= right - 2).sort((a, b) => a.r.left - b.r.left))
    };
  }

  // A panel's items, top to bottom: the rows of each list in it. A list is a box whose children are
  // mostly one kind of element, stacked, each the size of an item (Axiom's are virtual lists of
  // absolutely positioned rows). Lists inside an item (its lines of text) don't count; a panel with
  // several lists (Discover) goes through them in the order they show on screen.
  function panelItems({ title, root }) {
    const kindOf = el => `${el.tagName}.${typeof el.className === 'string' ? el.className : ''}`;
    const lists = [];
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.children.length < 2) continue;
      const kids = [...el.children];
      const counts = new Map();
      for (const c of kids) counts.set(kindOf(c), (counts.get(kindOf(c)) || 0) + 1);
      const [kind, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (n < kids.length * 0.6) continue;
      const width = el.getBoundingClientRect().width;
      const rows = kids.filter(c => kindOf(c) === kind)
        .map(c => ({ el: c, r: c.getBoundingClientRect() }))
        .filter(({ r }) => r.height > 0)
        .sort((a, b) => a.r.top - b.r.top);
      const itemSized = ({ r }) => r.height >= 24 && r.height <= innerHeight * 0.35 && r.width >= 120 && r.width >= width * 0.7;
      const stacked = rows.every((x, i) => !i || x.r.top >= rows[i - 1].r.bottom - 2);
      const virtual = rows.length >= 2 && getComputedStyle(rows[0].el).position === 'absolute';
      if ((rows.length >= 3 || virtual) && stacked && rows.every(itemSized)) lists.push({ el, rows });
    }
    const outer = lists.filter(l => !lists.some(o => o !== l && o.rows.some(x => x.el.contains(l.el))));
    const shownTop = l => Math.max(l.el.getBoundingClientRect().top, scrollParent(l.el).getBoundingClientRect().top);
    return outer.sort((a, b) => shownTop(a) - shownTop(b)).flatMap(l => l.rows.map(({ el }) => {
      const card = unwrap(el);
      return { card, control: panelHideControl(card), rect: card.getBoundingClientRect(), column: title };
    }));
  }

  // A panel item's own hide button, if it has one (Discover's coins do; tracked trades don't).
  function panelHideControl(card) {
    for (const sel of [settings.hideSelector, ...AXS_AUTO_HIDE_SELECTORS].filter(Boolean)) {
      try {
        const el = card.querySelector(sel);
        if (el) return el;
      } catch {}
    }
    return null;
  }

  // The Pulse columns, found by their titles, left to right: [{ title, head, root }]. Each root is the
  // largest box around its title that doesn't reach another title (or most of the page width).
  function pulseColumns() {
    const cached = columnCache.columns;
    const fresh = Date.now() - columnCache.at < 1000;
    const intact = cached.every(c => c.root.isConnected && c.head.isConnected && c.head.textContent.trim().toLowerCase() === c.title);
    if (intact && (cached.length === AXS_PULSE_COLUMNS.length || fresh)) return cached;

    const titles = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      const text = n.nodeValue.trim().toLowerCase();
      const el = n.parentElement;
      if (!AXS_PULSE_COLUMNS.includes(text) || !el?.getClientRects().length) continue;
      // The header is the topmost match; lower ones are e.g. "Migrated" badges on coins.
      const prev = titles.get(text);
      if (!prev || el.getBoundingClientRect().top < prev.getBoundingClientRect().top) titles.set(text, el);
    }
    const heads = [...titles.values()];
    const maxWidth = innerWidth * 0.6;
    const columns = [...titles].map(([title, head]) => {
      let root = head;
      for (let p = root.parentElement; p && p !== document.body && !heads.some(o => o !== head && p.contains(o)) &&
        p.getBoundingClientRect().width <= maxWidth; p = p.parentElement) root = p;
      return { title, head, root };
    }).sort((a, b) => a.root.getBoundingClientRect().left - b.root.getBoundingClientRect().left);
    columnCache = { columns, at: Date.now() };
    return columns;
  }

  // Steps through row wrappers (e.g. virtual-list rows) down to the box that looks like the card.
  function unwrap(el) {
    const area = r => r.width * r.height;
    while (el.children.length === 1 && area(el.children[0].getBoundingClientRect()) >= 0.85 * area(el.getBoundingClientRect())) {
      el = el.children[0];
    }
    return el;
  }

  // The coin at a point. Only the topmost element counts: a coin under a popup or dialog doesn't.
  function cardAt(model, x, y) {
    for (let n = document.elementFromPoint(x, y); n && n !== document.body; n = n.parentElement) {
      const hit = model.byCard.get(n);
      if (hit) return hit;
    }
    return null;
  }

  // The coin under the mouse, if the mouse is in the window.
  function hoveredCoin(model) {
    return mouse && cardAt(model, mouse.x, mouse.y);
  }

  // The selected coin in a fresh scan. Pulse re-renders coins and inserts new ones all the time, so
  // match the coin itself (logo + ticker) first, then the element. If it's gone (e.g. hidden), like
  // vim: the coin that was below it, else the one above, else whatever is under the ring. Never
  // another column.
  function cursorHit(model) {
    if (!cursor) return null;
    const inColumn = [...model.byCard.values()].filter(h => h.column === cursor.column);
    const fps = new Map(inColumn.map(h => [h, fingerprint(h.card)]));
    const same = model.byCard.get(cursor.el);
    if (same && fps.get(same) === cursor.fp) return same;
    // Still here but changed: it changed in place (our hover added buttons, a value updated), unless
    // the list shifted under it. Following its old look after an in-place change can land on a
    // look-alike (two trades of one coin) and swap between the two every frame.
    const own = inColumn.find(h => h.card.contains(cursor.el) || cursor.el.contains(h.card));
    if (own && !listShifted(inColumn, fps, own)) return own;
    const nearest = list => list.reduce((best, h) =>
      (!best || Math.abs(middleY(h.rect) - cursor.y) < Math.abs(middleY(best.rect) - cursor.y) ? h : best), null);
    const byFp = fp => fp && nearest(inColumn.filter(h => fps.get(h) === fp));
    return byFp(cursor.fp) ||
      inColumn.find(h => h.card.contains(cursor.el) || cursor.el.contains(h.card)) ||
      byFp(cursor.below) || byFp(cursor.above) ||
      nearest(inColumn);
  }

  // A list that reuses its rows shows each coin one row further on: most rows change at once. Our hover
  // changes only the selected coin and the one we just left, so those two don't count.
  function listShifted(inColumn, fps, own) {
    let changed = 0;
    let kept = 0;
    for (const h of inColumn) {
      const before = cursor.looks?.get(h.card);
      if (h === own || h.card === cursor.prev || before === undefined) continue; // new rows: e.g. scrolled into view
      if (before === fps.get(h)) kept++;
      else changed++;
    }
    return changed > kept;
  }

  // Logo URL plus the first bit of text (the ticker). Ages like "12s" change every second, so skip them.
  function fingerprint(card) {
    let text = '';
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n; !text && (n = walker.nextNode());) {
      const t = n.nodeValue.trim();
      if (/\p{L}/u.test(t) && !/^\d+[smhd]$/.test(t)) text = t;
    }
    return `${card.querySelector('img[src]')?.getAttribute('src') || ''}|${text}`;
  }

  function middleY(r) {
    return r.top + r.height / 2;
  }

  // --- Pulse: cursor and ring -----------------------------------------------------------

  // Arriving on Pulse (page load or coming back): select the first Final Stretch coin as soon as it
  // shows up, unless the mouse or keyboard got there first. No Final Stretch coin: nothing preselected.
  function schedulePreselect() {
    clearTimeout(preselectTimer);
    if (!onPulse()) return;
    const giveUpAt = Date.now() + 10000;
    const attempt = () => {
      if (!onPulse() || cursor || mouseMoved || teaching || !settings.enabled || !settings.vimNav) return;
      const model = scanCards();
      const first = model.columns.find(col => col[0].column === AXS_PULSE_COLUMNS[1])?.[0];
      if (first) setCursor(first, model);
      else if (Date.now() < giveUpAt) preselectTimer = setTimeout(attempt, 250);
    };
    preselectTimer = setTimeout(attempt, 300); // let stored settings load first
  }


  function navigate(dir) {
    const model = scanCards();
    const { columns } = model;
    if (!model.found) return toast('Pulse columns not found (looked for New Pairs / Final Stretch / Migrated)');
    if (!columns.length) return toast('No coins found (try Teach in the extension popup)');

    const cur = cursorHit(model);
    if (!cur) {
      // First press only places the cursor: on the coin under the mouse if the mouse was just used,
      // else on the first coin of the middle column (e.g. right after coming back to Pulse).
      const underMouse = mouseMoved && hoveredCoin(model);
      return setCursor(underMouse || columns[model.middle][0], model);
    }

    const col = columns[cur.col];
    if (dir === 'down') return setCursor(col[Math.min(cur.idx + 1, col.length - 1)], model);
    if (dir === 'up') return setCursor(col[Math.max(cur.idx - 1, 0)], model);

    const next = columns[cur.col + (dir === 'left' ? -1 : 1)];
    if (!next) return;
    // Land on the coin at the same height on screen, among those not scrolled out of sight.
    const y = middleY(cur.rect);
    const dist = h => Math.abs(middleY(h.rect) - y);
    const shown = next.filter(onScreen);
    setCursor((shown.length ? shown : next).reduce((best, h) => (dist(h) < dist(best) ? h : best)), model);
  }

  // Is the coin at least partly visible in its list (virtual lists render a few rows out of sight)?
  function onScreen(hit) {
    const c = scrollParent(hit.card).getBoundingClientRect();
    return hit.rect.bottom > Math.max(c.top, 0) && hit.rect.top < Math.min(c.bottom, innerHeight);
  }

  function setCursor(hit, model) {
    cursor = { prev: cursor?.el };
    pointCursorAt(hit, model);
    keyboardTookOver();
    hit.card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    hoverCard(hit);
    if (!rafId) rafId = requestAnimationFrame(drawRing);
  }

  // prev: the coin we hovered before this one (its look changes back when we leave it).
  function pointCursorAt(hit, model) {
    const col = model.columns[hit.col] || [];
    const looks = new Map(col.map(h => [h.card, fingerprint(h.card)]));
    const fpAt = i => (col[i] ? looks.get(col[i].card) : '');
    if (cursor.el && cursor.el !== hit.card) cursor.prev = cursor.el;
    Object.assign(cursor, {
      el: hit.card, column: hit.column, clip: scrollParent(hit.card), y: middleY(hit.rect),
      fp: looks.get(hit.card), below: fpAt(hit.idx + 1), above: fpAt(hit.idx - 1), looks
    });
  }

  function clearCursor() {
    cursor = null;
    if (ring) ring.style.display = 'none';
    unhover();
  }

  // Follows the selected coin every frame: Pulse inserts new coins and re-renders constantly.
  function drawRing() {
    rafId = 0;
    if (!cursor) return;
    if (!cursor.el.isConnected || fingerprint(cursor.el) !== cursor.fp) {
      // Re-rendered or moved to another row: follow it. Gone: see cursorHit.
      const model = scanCards();
      const hit = cursorHit(model);
      if (!hit) return clearCursor();
      pointCursorAt(hit, model);
      hoverCard(hit);
    }
    if (!ring) {
      ring = document.createElement('div');
      ring.dataset.axs = 'ring';
      ring.style.cssText = [
        'position:fixed', 'z-index:2147483646', 'pointer-events:none', 'box-sizing:border-box',
        'border:2px solid #7c8cff', 'border-radius:6px',
        'box-shadow:0 0 0 1px rgba(0,0,0,.6),0 0 12px rgba(124,140,255,.5)'
      ].join(';');
      document.documentElement.appendChild(ring);
    }
    const r = cursor.el.getBoundingClientRect();
    cursor.y = middleY(r);
    const c = cursor.clip.getBoundingClientRect();
    const top = Math.max(r.top, c.top);
    const bottom = Math.min(r.bottom, c.bottom);
    if (bottom - top < 4) {
      ring.style.display = 'none';
    } else {
      Object.assign(ring.style, {
        display: 'block', left: `${r.left}px`, top: `${top}px`, width: `${r.width}px`, height: `${bottom - top}px`
      });
    }
    rafId = requestAnimationFrame(drawRing);
  }

  function scrollParent(el) {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (canScrollY(n)) return n;
    return document.documentElement;
  }

  // --- Pulse: hide, open, website ------------------------------------------------------

  // The selected coin, else the one under the mouse; null (with a toast) if there's neither.
  function targetCoin(model) {
    if (!model.found) {
      toast('Pulse columns not found (looked for New Pairs / Final Stretch / Migrated)');
      return null;
    }
    const hit = cursorHit(model) || hoveredCoin(model);
    if (!hit) toast(cursor || mouse ? 'No coin found here (try Teach in the extension popup)' : 'Select or hover a coin first');
    return hit;
  }

  function hideCurrent() {
    const hit = targetCoin(scanCards());
    if (!hit) return false;
    if (!hit.control) {
      toast('This item has no hide button');
      return false;
    }
    clickOnly(hit.control);
    // The ring loop moves the cursor to the next coin once this one is gone.
    return true;
  }

  function openCoinWebsite() {
    const hit = targetCoin(scanCards());
    if (!hit) return false;
    const link = websiteLink(hit.card);
    if (!link) {
      toast('No website link on this coin');
      return false;
    }
    openWindow(link.href);
    return true;
  }

  function openCurrent() {
    const hit = cursorHit(scanCards());
    if (!hit) return;
    const link = [hit.card.closest('a[href]'), ...hit.card.querySelectorAll('a[href]')]
      .find(a => a && a.origin === location.origin && AXS_PAIR_PATH.test(a.pathname));
    if (link) return link.click();
    const spot = cardBodySpot(hit);
    if (!spot) return toast('No safe spot to click on this coin');
    pressAndClick(spot.el, spot.x, spot.y);
  }

  // Things on a card that do their own thing when clicked or hovered: buttons, links, images and icons,
  // plus hover-panel / tooltip / popup triggers (e.g. dev migrations, which opens a panel and Solscan)
  // and open panels themselves.
  const INTERACTIVE = [
    'a', 'button', 'input', 'select', 'textarea', 'label', 'img', 'svg', 'video', 'canvas',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="dialog"]', '[role="tooltip"]', '[role="menu"]',
    '[onclick]', '[tabindex]', '[title]', '[data-state]', '[data-side]', '[aria-haspopup]', '[aria-expanded]',
    '[aria-describedby]', '[data-tooltip-id]', '[data-tooltip-content]', '[data-tip]'
  ].join(',');

  // Where to hover and click a coin: empty card padding if possible (clicking blank card space is what
  // opens it), else plain text. Never a widget: Buy, socials, copy, hide, or anything with its own
  // hover panel or tooltip. Edges first, then the middle and outwards.
  function cardBodySpot({ card, control }) {
    const r = card.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const points = [[r.left + 4, cy], [r.right - 4, cy], [cx, r.top + 4], [cx, r.bottom - 4]];
    for (const fy of [0.5, 0.15, 0.85, 0.3, 0.7]) {
      for (const fx of [0.5, 0.35, 0.65, 0.05, 0.95, 0.2, 0.8]) points.push([r.left + r.width * fx, r.top + r.height * fy]);
    }
    const cardArea = r.width * r.height;
    let textSpot = null;
    for (const [x, y] of points) {
      const el = document.elementFromPoint(x, y);
      if (!el || !card.contains(el) || control?.contains(el) || interactiveBetween(el, card, cardArea)) continue;
      if (!hasOwnText(el)) return { el, x, y };
      textSpot ||= { el, x, y };
    }
    return textSpot;
  }

  // Wrappers covering most of the card don't count: a whole-card hover trigger would otherwise block every spot.
  function interactiveBetween(el, card, cardArea) {
    for (let n = el; n && n !== card; n = n.parentElement) {
      if (!n.matches(INTERACTIVE)) continue;
      const r = n.getBoundingClientRect();
      if (r.width * r.height < 0.8 * cardArea) return true;
    }
    return false;
  }

  function hasOwnText(el) {
    return [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
  }

  // --- Trade page: hide / blacklist, then go back ----------------------------------------

  // The hide key: clicks Axiom's own hide button (taught once), then goes back to where the token was opened from.
  function hidePairAndGoBack() {
    if (pairHidePending) return true; // already leaving: swallow repeat taps until the page changes
    if (!settings.pairHideSelector) {
      toast('Teach the trade-page hide button first (extension popup → Teach, on a trade page)');
      return false;
    }
    const hide = taughtElement(settings.pairHideSelector, 'hide');
    if (!hide.el) {
      toast(hide.error);
      return false;
    }
    clickOnly(hide.el);
    leavePairPage();
    return true;
  }

  // Shift+B: clicks Axiom's "Blacklist dev", hides the token too (if the hide button is taught), then goes back.
  // Nothing happens unless the Blacklist dev button is found.
  function blacklistHideAndGoBack() {
    if (pairHidePending) return true;
    const blacklist = blacklistButton();
    if (!blacklist) return false;
    const r = blacklist.getBoundingClientRect();
    pressAndClick(blacklist, r.left + r.width / 2, r.top + r.height / 2);
    const hide = settings.pairHideSelector ? taughtElement(settings.pairHideSelector, 'hide') : null;
    if (hide?.el) clickOnly(hide.el);
    toast(hide?.el ? 'Blacklisted the dev and hid the token'
      : hide ? `Blacklisted the dev. ${hide.error}`
        : 'Blacklisted the dev. Teach the trade-page hide button to hide the token too.');
    leavePairPage();
    return true;
  }

  // Axiom's own "Blacklist dev" button: the taught one, else the only button saying so.
  function blacklistButton() {
    if (settings.blacklistSelector) {
      const taught = taughtElement(settings.blacklistSelector, 'Blacklist dev');
      if (!taught.el) toast(taught.error);
      return taught.el || null;
    }
    const labelled = [...queryAll('[aria-label], [title]')].filter(el => BLACKLIST_TEXT.test(el.getAttribute('aria-label') || el.title));
    const texts = textElements(BLACKLIST_TEXT).map(el => el.closest('button, [role="button"], [role="menuitem"]') || el);
    const found = outermost([...new Set([...labelled, ...texts])]);
    if (found.length === 1) return found[0];
    toast('Blacklist dev button not found (try Teach in the extension popup)');
    return null;
  }

  const BLACKLIST_TEXT = /^\s*blacklist\s+dev\b/i;

  // The one element a taught selector points at (visible first: it may only be displayed on hover).
  // Returns { el } or { error }.
  function taughtElement(sel, name) {
    const matches = outermost([...queryAll(sel)]);
    const shown = matches.filter(el => el.getClientRects().length);
    const pick = shown.length ? shown : matches;
    if (pick.length === 1) return { el: pick[0] };
    return {
      error: pick.length
        ? `The taught ${name} button matches ${pick.length} buttons here (a floating panel?). Teach it again while the panel is open.`
        : `The ${name} button isn't on this page.`
    };
  }

  // Back to where the token was opened from; to Pulse if there's no earlier Axiom page
  // (opened directly, or from another site), instead of leaving Axiom.
  function leavePairPage() {
    pairHidePending = true;
    setTimeout(() => { pairHidePending = false; }, 3000); // in case the page never changes
    setTimeout(() => {
      if (window.navigation ? navigation.canGoBack : history.length > 1) history.back();
      else location.assign('/pulse');
    }, 250);
  }

  // --- Trade page: j/k scroll the Holders list ------------------------------------------

  function scrollHolders(dir) {
    const found = holdersList();
    if (!found) {
      toast(settings.holdersSelector ? 'Holders list not found (is the Holders tab open?)' : 'Holders list not found (try Teach in the extension popup)');
      return false;
    }
    if (found.tab && isInactiveTab(found.tab)) {
      toast('Open the Holders tab first');
      return false;
    }
    found.list.scrollBy({ top: dir * rowHeight(found.list), behavior: 'instant' });
    return true;
  }

  // The list of the Holders tab (the tab next to Trades / Top Traders, not the "Holders" stat).
  // It's either the scrolling panel the tab bar sits in, or a scroll box below the tab.
  // Side panels such as tracked wallets don't qualify: they aren't below the tab.
  function holdersList() {
    if (holders?.list.isConnected && holders.list.getClientRects().length && (!holders.tab || holders.tab.isConnected)) return holders;
    holders = null;
    if (Date.now() - holdersMissAt < 500) return null; // just failed: don't rescan the page on every key repeat
    const tabs = textElements(/^holders\b/i).filter(isTabLabel);
    if (settings.holdersSelector) {
      // Taught: exactly one visible match, or nothing (e.g. another tab is open).
      const m = [...queryAll(settings.holdersSelector)].filter(el => el.getClientRects().length);
      if (m.length === 1) holders = { tab: tabs[0] || null, list: m[0] };
    } else {
      let best = null;
      const lists = [...document.querySelectorAll('*')].filter(canScrollY);
      for (const tab of tabs) {
        const t = tab.getBoundingClientRect();
        const x = t.left + t.width / 2;
        for (const list of lists) {
          if (!list.contains(tab)) {
            const r = list.getBoundingClientRect();
            if (r.top < t.bottom - 4 || x < r.left || x > r.right) continue;
          }
          // Closest relative wins: the panel around the tab bar, or the box right under it.
          const depth = commonDepth(tab, list);
          const area = list.clientWidth * list.clientHeight;
          if (!best || depth > best.depth || (depth === best.depth && area > best.area)) best = { tab, list, depth, area };
        }
      }
      if (best) holders = { tab: best.tab, list: best.list };
    }
    if (!holders) holdersMissAt = Date.now();
    return holders;
  }

  function forgetHolders() {
    holders = null;
    holdersMissAt = 0;
  }

  // Tab widgets mark the open tab with aria-selected or data-state. Without those we can't tell, so go ahead.
  function isInactiveTab(label) {
    const tab = label.closest('[role="tab"], [aria-selected], [data-state]');
    return !!tab && (tab.getAttribute('aria-selected') === 'false' || tab.getAttribute('data-state') === 'inactive');
  }

  // One row's height: the height shared by the most siblings anywhere in the list (rows outnumber tabs and headers).
  function rowHeight(list) {
    let best = [40, 2];
    const queue = [list];
    for (let i = 0; i < queue.length && i < 300; i++) {
      const sizes = new Map();
      for (const kid of queue[i].children) {
        const h = Math.round(kid.getBoundingClientRect().height);
        if (h > 12) sizes.set(h, (sizes.get(h) || 0) + 1);
        queue.push(kid);
      }
      for (const [h, n] of sizes) if (n > best[1]) best = [h, n];
    }
    return best[0];
  }

  // How deep in the page the closest shared ancestor of `a` and `b` is.
  function commonDepth(a, b) {
    for (let n = a; n; n = n.parentElement) {
      if (!n.contains(b)) continue;
      let depth = 0;
      for (let m = n; m; m = m.parentElement) depth++;
      return depth;
    }
    return 0;
  }

  // --- Trade page: the bottom tab bar (tells the Holders tab from the Holders stat) ------

  // A tab label sits in a short tab bar with other trade-page tab names.
  function isTabLabel(el) {
    return tabBarScore(el) >= 2;
  }

  // How many known tab names the small box around `el` (its tab bar) shows; 0 if it isn't in one.
  // A taught tab bar settles it.
  function tabBarScore(el) {
    const bar = taughtTabBar();
    if (bar) return bar.contains(el) ? 2 : 0;
    let n = el;
    for (let i = 0; i < 8 && n.parentElement; i++) {
      n = n.parentElement;
      if (n.getBoundingClientRect().height > 150) break; // grew past the tab bar (checked before reading its text)
      const count = tabNamesIn(n.textContent);
      if (count >= 2) return count;
    }
    return 0;
  }

  function tabNamesIn(text) {
    const lower = text.toLowerCase();
    return AXS_TRADE_TABS.filter(name => lower.includes(name.toLowerCase())).length;
  }

  function taughtTabBar() {
    if (!settings.tabBarSelector) return null;
    const m = [...queryAll(settings.tabBarSelector)].filter(el => el.getClientRects().length);
    return m.length === 1 ? m[0] : null;
  }

  // --- Trade page: w opens the website, x shows the X preview ---------------------------

  function openWebsite() {
    const link = websiteLink(document);
    if (!link) {
      toast('Website link not found (try Teach in the extension popup)');
      return false;
    }
    openWindow(link.href);
    return true;
  }

  // Opens `href` in a new browser window (the background worker does it; see background.js).
  function openWindow(href) {
    chrome.runtime.sendMessage({ type: 'axs:openWindow', url: href })
      .then(r => r?.ok || toast(`Couldn't open the website: ${r?.message || 'no reply'}`))
      .catch(err => toast(`Couldn't open the website: ${err.message}`));
  }

  // The topmost visible external link in `root` that isn't a social, explorer or trading site.
  // Links that say "website" or show a globe icon go first. The taught link only applies to the
  // trade page (`root` = document), not inside Pulse coins.
  function websiteLink(root) {
    const page = root === document;
    const shown = el => (page ? inViewport(el) : el.getClientRects().length > 0);
    if (page && settings.websiteSelector) {
      const taught = topmost([...queryAll(settings.websiteSelector)].map(el => el.closest('a[href]') || el).filter(shown));
      if (taught?.href) return taught;
    }
    const hint = a => /website|globe|global|\bweb\b|www/i.test(`${a.getAttribute('aria-label') || ''} ${a.title} ${a.innerHTML.slice(0, 300)}`);
    const links = [...root.querySelectorAll('a[href]')].filter(a =>
      /^https?:$/.test(a.protocol) && a.origin !== location.origin && !AXS_NOT_WEBSITE_HOST.test(a.hostname) && shown(a));
    const hinted = links.filter(hint);
    return topmost(hinted.length ? hinted : links);
  }

  // Hovers the token's own X link so Axiom shows its preview.
  function hoverTwitter() {
    const link = twitterLink();
    if (!link) {
      toast('Twitter link not found');
      return false;
    }
    const r = link.getBoundingClientRect();
    const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const inner = document.elementFromPoint(at.x, at.y);
    hoverElement(link.contains(inner) ? inner : link, at);
    keyboardTookOver();
    return true;
  }

  // The topmost visible X link on screen (the token header sits above trades and holders).
  // Profile, community and tweet links beat "search on X" links.
  function twitterLink() {
    if (settings.twitterSelector) {
      const taught = topmost([...queryAll(settings.twitterSelector)].map(el => el.closest('a[href]') || el).filter(inViewport));
      if (taught) return taught;
    }
    const links = [...document.querySelectorAll('a[href]')].filter(a => AXS_TWITTER_HOST.test(a.hostname) && inViewport(a));
    const profiles = links.filter(a => !a.pathname.startsWith('/search'));
    return topmost(profiles.length ? profiles : links);
  }

  // --- Trade page: z / Z zoom the chart -------------------------------------------------
  // Axiom's chart is TradingView's charting library, in a same-origin iframe. We use its own inputs:
  // mouse-wheel notches to zoom out; its Reset button (or its Alt+R shortcut) to restore.

  const CHART_RESET_BUTTON = [
    '[class*="control-bar__btn--turn-button"]',
    '[aria-label="Reset chart" i]', '[title="Reset chart" i]',
    '[aria-label="Reset chart view" i]', '[title="Reset chart view" i]'
  ].join(',');

  function zoomChart(reset) {
    const pane = chartPane();
    if (!pane) {
      toast('Chart not found');
      return false;
    }
    const doc = pane.ownerDocument;
    if (reset) {
      const button = doc.querySelector(CHART_RESET_BUTTON);
      if (button) {
        const b = button.getBoundingClientRect();
        pressAndClick(button, b.left + b.width / 2, b.top + b.height / 2);
      } else {
        const target = doc.activeElement || doc.body;
        for (const type of ['keydown', 'keyup']) target.dispatchEvent(keyEvent(type, { key: 'r', code: 'KeyR', altKey: true, keyCode: 82 }));
      }
      return true;
    }
    // Near the right edge, so the latest candles stay in view while zooming out.
    const r = pane.getBoundingClientRect();
    const x = r.left + r.width * 0.9;
    const y = middleY(r);
    const target = doc.elementFromPoint(x, y) || pane;
    const steps = Math.min(20, Math.max(1, Math.round(settings.zoomSteps) || AXS_DEFAULTS.zoomSteps));
    for (let i = 0; i < steps; i++) {
      target.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, deltaY: 100, deltaMode: 0
      }));
    }
    return true;
  }

  // The chart's main pane: the largest visible canvas on the page or in a same-origin iframe.
  function chartPane() {
    let best = null;
    for (const doc of [document, ...frameDocs()]) {
      for (const c of doc.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        if (!c.getClientRects().length || r.width < 100 || r.height < 60) continue;
        const area = r.width * r.height;
        if (!best || area > best.area) best = { c, area };
      }
    }
    return best?.c || null;
  }

  function frameDocs() {
    const docs = [];
    for (const f of document.querySelectorAll('iframe')) {
      try {
        if (f.contentDocument && inViewport(f)) docs.push(f.contentDocument);
      } catch {} // cross-origin
    }
    return docs;
  }

  // Keyboard handlers often read the legacy keyCode, which the constructor can't set.
  function keyEvent(type, init) {
    const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
    for (const k of ['keyCode', 'which']) Object.defineProperty(e, k, { get: () => init.keyCode });
    return e;
  }

  // Keys and mouse moves inside a same-origin iframe (e.g. the focused chart) never reach this page,
  // so listen in there too.
  function watchFrames() {
    for (const f of document.querySelectorAll('iframe')) {
      let doc;
      try { doc = f.contentDocument; } catch {}
      if (!doc || watchedDocs.has(doc)) continue;
      watchedDocs.add(doc);
      doc.addEventListener('keydown', onKeyDown, true);
      doc.addEventListener('keyup', onKeyUp, true);
      doc.addEventListener('pointermove', e => {
        const r = f.getBoundingClientRect();
        onPointerMove({ isTrusted: e.isTrusted, clientX: e.clientX + r.left + f.clientLeft, clientY: e.clientY + r.top + f.clientTop });
      }, { capture: true, passive: true });
    }
  }

  // --- Keyboard hover -------------------------------------------------------------------
  // The selected coin (or X link) gets the mouse events a real hover would produce, so Axiom's own
  // hover features act on it.

  function hoverCard(hit) {
    const spot = cardBodySpot(hit);
    if (!spot) return unhover();
    hoverElement(spot.el, spot);
  }

  function hoverElement(el, at) {
    if (el === hovered) return;
    moveHover(hovered?.isConnected ? hovered : realHoverTarget(), el, at);
    hovered = el;
  }

  // Hands the hover back to whatever is under the real mouse.
  function unhover() {
    if (!hovered) return;
    const from = hovered;
    hovered = null;
    moveHover(from.isConnected ? from : null, realHoverTarget(), mouse);
  }

  function realHoverTarget() {
    return mouse ? document.elementFromPoint(mouse.x, mouse.y) : null;
  }

  // Same event order a browser uses when the mouse moves from `from` to `to`.
  function moveHover(from, to, at) {
    const base = { cancelable: true, composed: true, view: window, clientX: at?.x ?? 0, clientY: at?.y ?? 0 };
    if (from) {
      fireBoth(from, 'out', { ...base, bubbles: true, relatedTarget: to });
      for (const el of ancestorsUntil(from, to)) fireBoth(el, 'leave', { ...base, bubbles: false, relatedTarget: to });
    }
    if (to) {
      fireBoth(to, 'over', { ...base, bubbles: true, relatedTarget: from });
      for (const el of ancestorsUntil(to, from).reverse()) fireBoth(el, 'enter', { ...base, bubbles: false, relatedTarget: from });
      fireBoth(to, 'move', { ...base, bubbles: true });
    }
  }

  // `el` and its ancestors, stopping before the first one that also contains `other`.
  function ancestorsUntil(el, other) {
    const out = [];
    for (let n = el; n && !(other && n.contains(other)); n = n.parentElement) out.push(n);
    return out;
  }

  function fireBoth(el, kind, init) {
    el.dispatchEvent(new PointerEvent(`pointer${kind}`, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent(`mouse${kind}`, init));
  }

  // --- Teach: learn a control from one click --------------------------------------------
  // The click is swallowed, so teaching never actually hides, opens or follows anything.

  const TEACH = {
    pulseHide: { where: 'pulse', prompt: 'Click the hide (eye) icon on any coin', learn: learnPulseHide },
    pairHide: { where: 'pair', prompt: "Click the token's hide button", learn: learnPairHide },
    tabBar: { where: 'pair', prompt: 'Click any of the bottom tabs (Trades, Holders, …)', learn: learnTabBar },
    holders: { where: 'pair', prompt: 'Click anywhere inside the Holders list', learn: learnHolders },
    twitter: { where: 'pair', prompt: "Click the token's X (Twitter) link", learn: learnTwitter },
    website: { where: 'pair', prompt: "Click the token's website link", learn: learnWebsite },
    blacklist: { where: 'pair', prompt: 'Click the Blacklist dev button', learn: learnBlacklist }
  };
  const TEACH_BLOCKED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];

  function startTeaching(what) {
    if (teaching) stopTeaching('');
    teaching = what;
    TEACH_BLOCKED.forEach(t => addEventListener(t, consume, true));
    addEventListener('click', onTeachClick, true);
    toast(`${TEACH[what].prompt}. Esc to cancel.`, 0);
  }

  function stopTeaching(message) {
    teaching = false;
    TEACH_BLOCKED.forEach(t => removeEventListener(t, consume, true));
    removeEventListener('click', onTeachClick, true);
    if (message) toast(message);
  }

  function onTeachClick(e) {
    consume(e);
    const target = e.composedPath()[0];
    let message = 'Could not read that element. Try Teach again.';
    try {
      if (target instanceof Element) message = TEACH[teaching].learn(target);
    } catch (err) {
      message = `Teach failed: ${err.message}`;
    } finally {
      stopTeaching(message); // never leave the page's clicks blocked
    }
  }

  const BUY_TEXT = /\b(buy|sell)\b/i;

  function learnPulseHide(target) {
    // Must be one per coin, this coin's own, and never a Buy/Sell button: the hide key clicks it.
    const clickable = target.closest('button, [role="button"]') || target;
    const row = listRow(target);
    const sel = selectorCandidates(target).find(c => {
      const all = outermost([...queryAll(c)]);
      if (all.length < 2) return false; // other coins must have it too
      if (all.filter(m => m === clickable || clickable.contains(m) || m.contains(clickable)).length !== 1) return false;
      if (row && all.filter(m => row.contains(m)).length !== 1) return false;
      return !all.some(m => BUY_TEXT.test((m.closest('button, a, [role="button"]') || m).textContent));
    });
    if (!sel) return "Couldn't single out the hide icon (it must be one per coin), so nothing was learned.";
    chrome.storage.sync.set({ hideSelector: sel });
    return `Learned ✓ ${queryAll(sel).length} hide buttons on page. Select or hover a coin and press ${keyName('hide')}.`;
  }

  function learnPairHide(target) {
    // Must single out this one button, or the hide key could press something else (e.g. a balance eye).
    const sel = uniqueSelector(selectorCandidates(target), target.closest('button, [role="button"]') || target);
    if (!sel) return 'Could not recognize that button uniquely on this page, so nothing was learned.';
    chrome.storage.sync.set({ pairHideSelector: sel });
    return `Learned ✓ trade-page hide button. Press ${keyName('hide')} here to hide the token and go back.`;
  }

  function learnBlacklist(target) {
    const clickable = target.closest('button, [role="button"], [role="menuitem"]') || target;
    const sel = uniqueSelector([...selectorCandidates(target), ...elementSelectors(clickable)], clickable);
    if (!sel) return 'Could not recognize that button uniquely on this page, so nothing was learned.';
    chrome.storage.sync.set({ blacklistSelector: sel });
    return `Learned ✓ Blacklist dev button. ${keyName('blacklist')} blacklists, hides the token and goes back.`;
  }

  function learnTabBar(target) {
    // The bar is the first box around the clicked tab that also shows other tab names.
    let bar = null;
    for (let n = target; n && n !== document.body; n = n.parentElement) {
      if (n.textContent.length > 2000) break;
      if (tabNamesIn(n.textContent) >= 2) {
        bar = n;
        break;
      }
    }
    bar ||= target.closest('[role="tablist"]');
    if (!bar) return "Couldn't find other tabs (Trades, Holders, …) around that, so nothing was learned.";
    const sel = uniqueSelector([...(bar.getAttribute('role') === 'tablist' ? ['[role="tablist"]'] : []), ...elementSelectors(bar)], bar);
    if (!sel) return 'Could not recognize the tab bar uniquely on this page, so nothing was learned.';
    chrome.storage.sync.set({ tabBarSelector: sel });
    forgetHolders();
    return `Learned ✓ tab bar. ${keyName('holdersDown')} / ${keyName('holdersUp')} scroll Holders.`;
  }

  function learnHolders(target) {
    let list = target;
    while (list && list !== document.documentElement && !canScrollY(list)) list = list.parentElement;
    if (!list || list === document.documentElement) return "That isn't inside a scrolling list, so nothing was learned.";
    const sel = uniqueSelector(elementSelectors(list), list);
    if (!sel) return 'Could not recognize that list uniquely on this page, so nothing was learned.';
    chrome.storage.sync.set({ holdersSelector: sel });
    forgetHolders();
    return `Learned ✓ Holders list. ${keyName('holdersDown')} / ${keyName('holdersUp')} scroll it.`;
  }

  function learnTwitter(target) {
    const link = target.closest('a[href]');
    if (!link || !AXS_TWITTER_HOST.test(link.hostname)) return "That isn't an X (Twitter) link, so nothing was learned.";
    // Classes plus the X host first: social links often share classes, but only one goes to X.
    const host = link.hostname.replace(/^www\./, '');
    const sel = uniqueSelector([`${classSelector(link)}[href*="${host}"]`, ...elementSelectors(link), ...selectorCandidates(target)], link);
    if (!sel) return 'Could not recognize that link uniquely on this page, so nothing was learned.';
    chrome.storage.sync.set({ twitterSelector: sel });
    return `Learned ✓ X link. Hold ${keyName('xPreview')} for its preview.`;
  }

  function learnWebsite(target) {
    const link = target.closest('a[href]');
    if (!link || link.origin === location.origin) return "That isn't a link to another site, so nothing was learned.";
    const sel = uniqueSelector([...elementSelectors(link), ...selectorCandidates(target)], link);
    if (!sel) return 'Could not recognize that link uniquely on this page, so nothing was learned.';
    chrome.storage.sync.set({ websiteSelector: sel });
    return `Learned ✓ website link. Press ${keyName('website')} to open it.`;
  }

  // The first candidate that matches exactly one thing on the page, and that thing is `el` (or is inside it / wraps it).
  // If none does (e.g. a bar of other tokens or a floating panel repeats the same button), the first one
  // narrowed down to a box around `el`, nearest box first: the box by name, else the exact chain of
  // boxes from it down to `el` (panel rows can reuse the token header's own markup).
  function uniqueSelector(candidates, el) {
    const unique = c => {
      if (c.length > MAX_SELECTOR) return false;
      const m = outermost([...queryAll(c)]);
      return m.length === 1 && (m[0] === el || el.contains(m[0]) || m[0].contains(el));
    };
    const plain = candidates.find(unique);
    if (plain) return plain;
    let path = '';
    for (let n = el.parentElement, depth = 0; n && n !== document.body; n = n.parentElement, depth++) {
      path = path ? `${stableClassSelector(n)} > ${path}` : stableClassSelector(n);
      // Single classes only on the nearest boxes: there are many, and each costs a page-wide query.
      for (const scope of new Set([...scopeSelectors(n, depth < 8), path])) {
        const sel = candidates.map(c => `${scope} ${c}`).find(unique);
        if (sel) return sel;
      }
    }
    return '';
  }

  // Taught selectors live in chrome.storage.sync, which refuses items over 8 KB.
  const MAX_SELECTOR = 2000;

  // Ways to name a box around a control: a hand-written id, a test name, one of its stable classes
  // (rarest on the page first), all of them. Not labels or titles: around the token those often hold its name.
  function scopeSelectors(el, singles) {
    const tag = el.tagName.toLowerCase();
    const out = [];
    if (el.id && !/[:\d]/.test(el.id)) out.push(`#${CSS.escape(el.id)}`);
    const testId = el.getAttribute('data-testid');
    if (testId) out.push(`[data-testid="${CSS.escape(testId)}"]`);
    const classes = stableClasses(el);
    if (singles) {
      const count = new Map(classes.map(c => [c, document.getElementsByClassName(c).length]));
      out.push(...[...classes].sort((a, b) => count.get(a) - count.get(b)).map(c => `${tag}.${CSS.escape(c)}`));
    }
    if (classes.length) out.push(stableClassSelector(el));
    return out;
  }

  // Classes with a variant or ! (e.g. Axiom's `[&_button]:!opacity-100`) are often switched on and off
  // with the page's state, such as while the box is hovered, so a selector using them stops matching.
  function stableClasses(el) {
    return [...el.classList].filter(c => !/[:!]/.test(c));
  }

  function stableClassSelector(el) {
    return el.tagName.toLowerCase() + stableClasses(el).map(c => '.' + CSS.escape(c)).join('');
  }

  // The list row (coin card) around `el`: about as wide as its list, with at least two look-alike siblings.
  function listRow(el) {
    for (let n = el; n.parentElement && n.parentElement !== document.body; n = n.parentElement) {
      const r = n.getBoundingClientRect();
      if (r.height < 20 || r.width < n.parentElement.getBoundingClientRect().width * 0.6) continue;
      const alike = [...n.parentElement.children].filter(s =>
        s.tagName === n.tagName && Math.abs(s.getBoundingClientRect().height - r.height) <= Math.max(4, r.height * 0.15));
      if (alike.length >= 3) return n;
    }
    return null;
  }

  // Ways to name an element that isn't an icon button: a hand-written id, a label or test name, its classes.
  function elementSelectors(el) {
    const tag = el.tagName.toLowerCase();
    const out = [];
    if (el.id && !/[:\d]/.test(el.id)) out.push(`#${CSS.escape(el.id)}`); // ids with digits or ':' are usually generated
    for (const a of ['data-testid', 'data-name', 'aria-label', 'title']) {
      const v = el.getAttribute(a);
      if (v && !/:\/\/|www\./i.test(v)) out.push(`${tag}[${a}="${CSS.escape(v)}"]`); // a URL in a title is token-specific
    }
    out.push(classSelector(el));
    if (el.parentElement && el.parentElement !== document.body) out.push(`${classSelector(el.parentElement)} > ${classSelector(el)}`);
    return out;
  }

  function classSelector(el) {
    return el.tagName.toLowerCase() + [...el.classList].map(c => '.' + CSS.escape(c)).join('');
  }

  const HIDE_CLASS = /eye-?(off|slash|close|hide)|hide/i;
  const ICON_CLASS = /^(ri|fa|bi|ti|mdi|lucide|icon)-/i;
  const GENERIC_ICON_CLASS = /^fa-(solid|regular|light|thin|duotone|brands|sharp|fw|lg|xs|sm|\dx)$/;
  const LABEL_ATTRS = ['aria-label', 'title', 'data-tooltip-content', 'data-tip'];

  // Ways to recognize the clicked control, most stable first:
  // icon class > label attribute > SVG path shape > button classes > button classes + icon.
  function selectorCandidates(t) {
    const clickable = t.closest('button, [role="button"]');
    const near = [...new Set([t, t.closest('svg, i'), clickable, ...(clickable ? clickable.querySelectorAll('*') : [])])]
      .filter(Boolean);
    const out = [];

    let icon = '';
    for (const re of [HIDE_CLASS, ICON_CLASS]) {
      for (const n of near) {
        const cls = [...n.classList].find(c => re.test(c) && !GENERIC_ICON_CLASS.test(c));
        if (cls) {
          const sel = `${n.tagName.toLowerCase()}.${CSS.escape(cls)}`;
          icon ||= sel;
          out.push(sel);
        }
      }
    }
    for (const n of near) {
      for (const a of LABEL_ATTRS) {
        const v = n.getAttribute(a);
        if (v) out.push(`[${a}="${CSS.escape(v)}"]`);
      }
    }
    const svg = t.closest('svg') || near.find(n => n.tagName.toLowerCase() === 'svg');
    const path = svg?.querySelector('path[d]');
    if (path) out.push(`path[d="${CSS.escape(path.getAttribute('d'))}"]`);

    const classes = classSelector(clickable || t);
    out.push(classes);
    if (icon && clickable) out.push(`${classes} ${icon}`);
    return [...new Set(out)];
  }

  // --- Debug info (popup → Copy debug info) ---------------------------------------------
  // Page structure only, so detection can be fixed without seeing the page: element types, a few
  // class names, sizes, tab names, link hosts. Anything shaped like a Solana address is masked.

  function debugInfo() {
    const mask = v => String(v).replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, '<addr>').slice(0, 80);
    // allClasses: every class, to compare with a taught selector (which uses them all).
    const desc = (el, allClasses = false) => {
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, allClasses ? 40 : 5).join('.') : '';
      const attrs = ['id', 'role', 'aria-selected', 'data-state']
        .filter(a => el.hasAttribute(a)).map(a => `${a}=${mask(el.getAttribute(a))}`).join(' ');
      const pos = getComputedStyle(el).position; // fixed / absolute: a floating panel
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${attrs ? ` [${attrs}]` : ''}${/fixed|absolute/.test(pos) ? ` pos=${pos}` : ''} text:${el.textContent.length}`;
    };
    const chain = (el, stop = document.body, max = 12, allClasses = false) => {
      const out = [];
      for (let n = el, i = 0; n && n !== stop && n !== document.body && i < max; n = n.parentElement, i++) out.push(desc(n, allClasses));
      return out;
    };
    const info = { version: chrome.runtime.getManifest().version, page: mask(location.pathname), lastMessage: lastToast, settings, errors: [] };
    // A part that fails is noted (with where it failed) instead of losing the rest.
    const part = (name, fn) => {
      try {
        fn();
      } catch (err) {
        info.errors.push(`${name}: ${err.message} @ ${(err.stack || '').split('\n')[1]?.trim() || '?'}`);
      }
    };
    if (onPulse()) part('pulse', () => {
      const model = scanCards();
      const controls = [...queryAll(settings.hideSelector || AXS_AUTO_HIDE_SELECTORS.join(','))];
      info.pulse = {
        columnTitlesFound: pulseColumns().map(c => c.title), coinsPerColumn: model.columns.map(c => c.length), middle: model.middle,
        sample: (model.columns[model.middle] || []).slice(0, 4).map(h => ({
          card: desc(h.card), control: desc(h.control), height: Math.round(h.rect.height),
          controlsInside: controls.filter(c => h.card.contains(c)).length
        })),
        // Side panels, with what each of their first items looks like.
        sidePanels: Object.values(sidePanels(pulseColumns())).flat().map(p => {
          const items = panelItems(p);
          return {
            title: p.title, panel: desc(p.root), items: items.length,
            sample: items.slice(0, 2).map(h => ({ card: desc(h.card), height: Math.round(h.rect.height), hide: h.control ? desc(h.control) : null }))
          };
        })
      };
    });
    if (onPairPage()) {
      part('hide button', () => {
        // The taught hide button's matches, each up to where they all meet: shows how a floating panel's
        // copies differ from the token's own. If it matches nothing, what its last part (the button or
        // icon itself) matches, with every class up the page: shows which box changed since Teach.
        // Look-alikes (e.g. a bar of token pills) are listed once, with a count.
        const taught = outermost([...queryAll(settings.pairHideSelector)]);
        const last = settings.pairHideSelector.match(/(?:\\.|[^\s\\>])+$/)?.[0];
        const hides = (taught.length ? taught : outermost([...queryAll(last || AXS_AUTO_HIDE_SELECTORS.join(','))])).slice(0, 300);
        let meet = hides[0]?.parentElement;
        while (meet && !hides.every(el => meet.contains(el))) meet = meet.parentElement;
        info.pairHideMatches = taught.length;
        info.pairHideShowing = taught.length ? 'taught selector' : last ? `its last part: ${last}` : 'eye-like buttons';
        info.pairHideMeet = meet ? desc(meet) : null;
        const groups = new Map();
        for (const el of hides) {
          const lines = chain(el, hides.length > 1 ? meet : null, 30, !taught.length);
          const key = lines.map(line => line.replace(/ text:\d+$/, '')).join('<');
          if (groups.has(key)) groups.get(key).count++;
          else groups.set(key, { count: 1, shown: el.getClientRects().length > 0, chain: lines });
        }
        info.pairHideChains = [...groups.values()].slice(0, 8);
      });
      part('holders', () => {
        info.tabBar = taughtTabBar() ? desc(taughtTabBar()) : 'not taught';
        info.holdersText = textElements(/holders/i).slice(0, 6).map(el => ({ text: mask(el.textContent.trim()), tabScore: tabBarScore(el), chain: chain(el) }));
        forgetHolders();
        const list = holdersList();
        info.holdersList = list ? desc(list.list) : null;
        info.scrollers = [...document.querySelectorAll('*')].filter(canScrollY).slice(0, 15)
          .map(el => ({ el: desc(el), h: el.clientHeight, scrollH: el.scrollHeight }));
      });
      part('chart', () => {
        info.chart = {
          iframes: [...document.querySelectorAll('iframe')].map(f => {
            let sameOrigin = false;
            try { sameOrigin = !!f.contentDocument; } catch {}
            return { src: mask((f.getAttribute('src') || '').split('?')[0]), sameOrigin };
          }),
          paneFound: !!chartPane()
        };
      });
      part('links', () => {
        info.linkHostsOnScreen = [...new Set([...document.querySelectorAll('a[href]')].filter(inViewport).map(a => a.hostname))].slice(0, 25);
      });
    }
    return JSON.stringify(info, null, 1);
  }

  // --- DOM helpers ------------------------------------------------------------------------

  // Stored selectors are user-taught, so a bad one must never throw.
  function queryAll(sel) {
    try { return document.querySelectorAll(sel); } catch { return []; }
  }

  function outermost(els) {
    return els.filter(el => !els.some(o => o !== el && o.contains(el)));
  }

  function textElements(re) {
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      if (re.test(n.nodeValue.trim()) && n.parentElement?.getClientRects().length) found.push(n.parentElement);
    }
    return found;
  }

  function canScrollY(el) {
    return el.scrollHeight > el.clientHeight + 1 && /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY);
  }

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  function topmost(els) {
    return els
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .sort((p, q) => p.r.top - q.r.top || p.r.left - q.r.left)[0]?.el || null;
  }

  // A click only, no mousedown: hide buttons sit inside cards that may open on mousedown.
  function clickOnly(el) {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
    }));
  }

  // The full press sequence, for things that react on mousedown (cards, tabs, chart buttons).
  function pressAndClick(el, x, y) {
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
    const ptr = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...ptr, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', ptr));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }

  // --- Toast ------------------------------------------------------------------------------

  function toast(text, ms = 2500) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.dataset.axs = 'toast';
      toastEl.style.cssText = [
        'position:fixed', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:2147483647', 'pointer-events:none', 'max-width:90vw',
        'padding:8px 14px', 'border-radius:8px', 'background:#111827', 'color:#f9fafb',
        'border:1px solid #374151', 'font:13px/1.4 system-ui,sans-serif',
        'box-shadow:0 4px 16px rgba(0,0,0,.4)'
      ].join(';');
      document.documentElement.appendChild(toastEl);
    }
    lastToast = text;
    toastEl.textContent = `Axiom Vim: ${text}`;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, ms);
  }
})();
