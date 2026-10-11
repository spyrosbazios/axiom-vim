const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EXT = process.argv[2] || path.join(__dirname, '..');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-pulse.html'), 'utf8');
const TRADE = fs.readFileSync(path.join(__dirname, 'mock-trade.html'), 'utf8');
const CHART = fs.readFileSync(path.join(__dirname, 'mock-chart.html'), 'utf8');
const mockFor = pathname => pathname.startsWith('/charting_library/') ? CHART : pathname.startsWith('/meme/') ? TRADE : MOCK;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Section header; STOP_AT=<text> ends the run there (for quick debugging).
const section = name => {
  console.log(name);
  if (process.env.STOP_AT && name.includes(process.env.STOP_AT)) throw new Error('STOP_AT reached');
};
setTimeout(() => { console.log('TIMEOUT'); process.exit(3); }, 100000).unref();
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/opt/helium/chrome', headless: true, pipe: true, enableExtensions: true,
    args: ['--no-first-run'], defaultViewport: { width: 1200, height: 900 },
  });
  try {
    const extId = await browser.installExtension(EXT);
    const ext = await browser.newPage();
    await ext.goto(`chrome-extension://${extId}/popup.html`);
    const store = obj => ext.evaluate(o => chrome.storage.sync.set(o), obj);
    const debugInfo = () => ext.evaluate(async () => {
      for (const t of await chrome.tabs.query({})) {
        try { const r = await chrome.tabs.sendMessage(t.id, { type: 'axs:debug' }); if (r?.text) return JSON.parse(r.text); } catch {}
      }
      return null;
    });
    // Waits for a page on `host` to open; resolves to its URL, or null. Also records whether it
    // opened in a different browser window than the current page, in `openedInOwnWindow`.
    let openedInOwnWindow = null;
    const windowOf = async target => {
      const cdp = await target.createCDPSession();
      try { return (await cdp.send('Browser.getWindowForTarget')).windowId; } finally { await cdp.detach(); }
    };
    const opened = host => browser.waitForTarget(tg => tg.url().includes(host), { timeout: 3000 }).then(async tg => {
      openedInOwnWindow = (await windowOf(tg)) !== (await windowOf(page.target()));
      (await tg.page())?.close();
      return tg.url();
    }).catch(() => null);
    let reply;
    const teach = what => ext.evaluate(async what => {
      const replies = [];
      for (const t of await chrome.tabs.query({})) {
        try { replies.push(await chrome.tabs.sendMessage(t.id, { type: 'axs:teach', what })); } catch {}
      }
      return replies[0];
    }, what);
    const storeGet = key => ext.evaluate(k => chrome.storage.sync.get(k).then(s => s[k]), key);

    // Each load() gets a fresh tab: re-navigating one tab between mock Pulse URLs sometimes aborts
    // and reloads the old page (also without the extension, so it's a test-setup quirk).
    let page;
    const openPage = async () => {
      if (page) await page.close();
      page = await browser.newPage();
      if (process.env.DEBUG_NAV) {
        page.on('framenavigated', f => f === page.mainFrame() && console.log('      [nav]', f.url()));
        page.on('console', m => /^\[page\]/.test(m.text()) && console.log('     ', m.text()));
      }
      await page.setRequestInterception(true);
      page.on('request', r => r.url().startsWith('https://axiom.trade/')
        ? r.respond({ status: 200, contentType: 'text/html', body: mockFor(new URL(r.url()).pathname) })
        : r.abort());
    };
    let loads = 0;
    // Arriving on Pulse preselects the first Final Stretch coin. Most tests start from "nothing
    // selected", so load() clears it with Esc unless keepPreselect is set.
    const load = async ({ keepPreselect = false } = {}) => {
      await openPage();
      const url = 'https://axiom.trade/pulse?r=' + (++loads);
      for (let attempt = 0; attempt < 4; attempt++) {
        const ok = await page.goto(url, { waitUntil: 'domcontentloaded' }).then(() => true, () => false);
        await sleep(ok ? 600 : 1000);
        if (await page.evaluate(() => /^\/pulse/.test(location.pathname) && Array.isArray(window.log)).catch(() => false)) {
          if (!keepPreselect) { await page.keyboard.press('Escape'); await sleep(50); }
          return;
        }
      }
      throw new Error('could not load ' + url);
    };
    await load();

    const log = () => page.evaluate(() => window.log.slice());
    const clearLog = () => page.evaluate(() => { window.log.length = 0; });
    const hides = async () => (await log()).filter(x => x.startsWith('hide'));
    let lastMouse = null;
    const moveTo = async (x, y) => { lastMouse = { x, y }; await page.mouse.move(x, y); await sleep(50); };
    const combo = async (mod, code) => { await page.keyboard.down(mod); await page.keyboard.press(code); await page.keyboard.up(mod); await sleep(80); };
    const hideKey = () => combo('Shift', 'KeyX');
    const underMouse = () => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.card')?.dataset.id ?? null, lastMouse);
    const hover = async sel => {
      await page.$eval(sel, el => el.scrollIntoView({ block: 'center' }));
      const b = await (await page.$(sel)).boundingBox();
      await moveTo(b.x + b.width / 2, b.y + b.height / 2);
    };
    const key = async (k, n = 1) => { for (let i = 0; i < n; i++) await page.keyboard.press(k); await sleep(80); };
    const toast = () => page.evaluate(() => {
      const t = document.querySelector('[data-axs=toast]');
      return t && t.style.display !== 'none' ? t.textContent : '';
    });
    // Which card the highlight ring is drawn on (null if hidden).
    const selected = () => page.evaluate(() => {
      const ring = document.querySelector('[data-axs=ring]');
      if (!ring || ring.style.display === 'none') return null;
      const r = ring.getBoundingClientRect();
      const card = [...document.querySelectorAll('.card')].find(c => {
        const b = c.getBoundingClientRect();
        return Math.abs(b.left - r.left) < 3 && Math.abs(b.width - r.width) < 3 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
      });
      return card ? card.dataset.id : 'ring-on-nothing';
    });
    const neutral = () => moveTo(600, 12); // over the search bar row, not on a coin
    const atUrl = async (pathname, search) => {
      for (let i = 0; i < 30; i++) {
        try { if (await page.evaluate((p, q) => location.pathname === p && location.search === q, pathname, search)) return true; } catch {}
        await sleep(100);
      }
      return false;
    };

    section('— hover + hide');
    await hover('[data-id=A2] .name');
    await hideKey();
    let l = await log();
    check('hover A2 + Shift+X hides A2', (await hides()).join() === 'hide:A2', JSON.stringify(l));
    check('card not opened, key not leaked', !l.some(x => /^(open|pagekey:X)/.test(x)), JSON.stringify(l));

    await clearLog();
    await hover('#hdrA');
    await moveTo(60, 50);
    await hideKey();
    l = await log();
    check('column header + Shift+X does nothing', !l.some(x => x.startsWith('hide') || x === 'header'), JSON.stringify(l));
    check('toast explains', /No coin found/.test(await toast()), await toast());

    await clearLog();
    await page.click('#search');
    await hover('[data-id=A1] .name');
    await hideKey();
    check('typing in input does not hide', !(await hides()).length);
    check('input received the X', (await page.$eval('#search', i => i.value)) === 'X');
    await page.$eval('#search', i => i.blur());

    await clearLog();
    await hover('[data-id=A3] .name');
    const cdp = await page.createCDPSession();
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 8, key: 'Χ', code: 'KeyX', text: 'Χ', windowsVirtualKeyCode: 88 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 8, key: 'Χ', code: 'KeyX', windowsVirtualKeyCode: 88 });
    await sleep(80);
    check('Greek layout (Shift+Χ on X key) hides A3', (await hides()).join() === 'hide:A3', JSON.stringify(await log()));

    await clearLog();
    await hover('[data-id=A1] .name');
    await page.keyboard.down('Shift');
    await page.keyboard.down('KeyX'); await sleep(30);
    await page.keyboard.down('KeyX'); await sleep(30);
    await page.keyboard.down('KeyX'); await sleep(30);
    await page.keyboard.up('KeyX'); await page.keyboard.up('Shift'); await sleep(80);
    l = await log();
    check('holding Shift+X hides exactly one coin, repeats swallowed', (await hides()).length === 1 && !l.some(x => x === 'pagekey:X'), JSON.stringify(l));

    section('— vim navigation');
    await load();
    await clearLog();
    await neutral();
    await key('j');
    check('first j starts at the first coin of the middle column (B1)', (await selected()) === 'B1', await selected());
    await key('h');
    check('h → A1', (await selected()) === 'A1', await selected());
    await key('j');
    check('j → A2', (await selected()) === 'A2', await selected());
    await key('j', 4);
    check('j clamps at bottom (A4)', (await selected()) === 'A4', await selected());
    await key('k');
    check('k → A3', (await selected()) === 'A3', await selected());
    await key('l');
    check('l → B3 (same height)', (await selected()) === 'B3', await selected());
    await key('h');
    check('h → back to A3', (await selected()) === 'A3', await selected());
    await key('h');
    check('h at first column stays', (await selected()) === 'A3', await selected());
    await key('l');
    await key('j', 7);
    check('j through scrolling list → B10', (await selected()) === 'B10', await selected());
    const inView = await page.evaluate(() => {
      const c = document.querySelector('[data-id=B10]').getBoundingClientRect();
      const lst = document.getElementById('B').getBoundingClientRect();
      return c.top >= lst.top - 1 && c.bottom <= lst.bottom + 1;
    });
    check('list scrolled so B10 is visible', inView);
    check('nav keys not leaked to page', !(await log()).some(x => x.startsWith('pagekey')), JSON.stringify(await log()));

    await clearLog();
    await hideKey(); await sleep(100);
    check('Shift+X hides the selected coin (B10)', (await hides()).join() === 'hide:B10', JSON.stringify(await log()));
    check('cursor moves to B9 (last one left)', (await selected()) === 'B9', await selected());
    await key('k', 1);
    await clearLog();
    await hideKey(); await sleep(100);
    check('k then Shift+X hides B8', (await hides()).join() === 'hide:B8', JSON.stringify(await log()));
    check('cursor stays in place → B9 slid up into it', (await selected()) === 'B9', await selected());
    await key('l');
    check('l with no column to the right stays (C needs Teach)', (await selected()) === 'B9', await selected());

    await key('l');
    check('l never enters the watchlist sidebar', (await selected()) === 'B9', await selected());
    await clearLog();
    await hover('[data-id=W2] .name');
    await hideKey();
    check('hover a watchlist item + Shift+X does nothing', !(await hides()).length, JSON.stringify(await log()));
    await hover('[data-id=B9] .name');
    await moveTo(600, 12);
    await key('j'); await key('Escape');

    await key('Escape');
    check('Esc clears the cursor', (await selected()) === null, await selected());
    await key('j');
    check('j after Esc starts again at the middle column (B1)', (await selected()) === 'B1', await selected());
    await moveTo(650, 300);
    check('moving the mouse clears the cursor', (await selected()) === null, await selected());
    await hover('[data-id=B2] .name');
    await key('j');
    check('j with mouse on B2 starts at B2', (await selected()) === 'B2', await selected());

    await neutral(); await key('Escape'); await key('j');
    await page.keyboard.down('j'); await sleep(30);
    await page.keyboard.down('j'); await sleep(30);
    await page.keyboard.down('j'); await sleep(30);
    await page.keyboard.up('j'); await sleep(80);
    check('holding j repeats (B1 → B4)', (await selected()) === 'B4', await selected());

    await store({ vimNav: false }); await sleep(100);
    check('disabling vim nav clears cursor', (await selected()) === null);
    await clearLog();
    await key('j');
    check('j passes through to the page when vim nav is off', (await log()).includes('pagekey:j') && (await selected()) === null);
    await store({ vimNav: true }); await sleep(100);

    section('— keyboard hover (Axiom x = Twitter preview)');
    await load(); await clearLog();
    await neutral(); await key('Escape'); await key('j');
    await key('x');
    l = await log();
    check('x on selected B1 shows its Twitter preview', l.includes('twitter:B1/B1'), JSON.stringify(l));
    check('plain x no longer hides anything', !(await hides()).length);
    await key('j'); await clearLog(); await key('x');
    check('hover follows the cursor (B2)', (await log()).includes('twitter:B2/B2'), JSON.stringify(await log()));
    await hover('[data-id=B5] .name');
    await key('j'); await key('j');
    check('setup: mouse resting on B5, cursor on B6', (await selected()) === 'B6', await selected());
    await clearLog(); await key('x');
    check('keyboard selection beats the resting mouse (B6)', (await log()).includes('twitter:B6/B6'), JSON.stringify(await log()));
    await key('j', 4);
    await clearLog(); await key('x');
    check('list scrolling under the mouse doesn\'t steal hover (B10)', (await log()).includes('twitter:B10/B10'), JSON.stringify(await log()));
    await key('Escape');
    const real = await underMouse();
    await clearLog(); await key('x');
    check(`Esc hands hover back to the mouse (${real})`, (await log()).includes(`twitter:${real}/${real}`), JSON.stringify(await log()));
    await key('j'); await key('k');
    await hover('[data-id=A2] .name');
    check('moving the mouse clears the cursor', (await selected()) === null, await selected());
    await clearLog(); await key('x');
    check('...and the real hover takes over (A2)', (await log()).includes('twitter:A2/A2'), JSON.stringify(await log()));

    section('— returning to Pulse');
    await hover('[data-id=A3] .name'); // leave the mouse resting where A3 will be
    await load({ keepPreselect: true });
    check('fresh Pulse: first Final Stretch coin (B1) is preselected, resting mouse ignored', (await selected()) === 'B1', await selected());
    await key('j');
    check('...and j moves on from it (B2)', (await selected()) === 'B2', await selected());
    await moveTo(600, 12); await hover('[data-id=A3] .name'); // a real move onto A3
    await key('Escape'); await key('j');
    check('setup: mouse moved onto A3 → j starts there', (await selected()) === 'A3', await selected());
    await page.evaluate(() => history.pushState({}, '', '/meme/X')); await sleep(400);
    check('leaving Pulse (in-app navigation) clears the selection', (await selected()) === null, await selected());
    await page.evaluate(() => history.pushState({}, '', '/pulse?back=1')); await sleep(800);
    check('back on Pulse (in-app): B1 is preselected again, not the coin under the resting mouse (A3)', (await selected()) === 'B1', await selected());
    await hover('[data-id=A2] .name');
    await key('Escape'); await key('j');
    check('...but after moving the mouse onto A2, j starts there', (await selected()) === 'A2', await selected());

    await page.evaluate(() => history.pushState({}, '', '/meme/Y')); await sleep(400);
    await page.mouse.move(700, 400); await sleep(50); await page.mouse.move(760, 460); // using the mouse right away
    await page.evaluate(() => history.pushState({}, '', '/pulse?back=2')); await sleep(100);
    await page.mouse.move(700, 400); await sleep(50); await page.mouse.move(640, 300); await sleep(800);
    check('...but not if the mouse is moving when you arrive', (await selected()) === null, await selected());
    await page.evaluate(() => { for (const c of document.querySelectorAll('#B .row-wrap')) c.remove(); history.pushState({}, '', '/meme/Z'); });
    await sleep(400);
    await page.evaluate(() => history.pushState({}, '', '/pulse?back=3')); await sleep(800);
    check('Final Stretch empty: nothing preselected', (await selected()) === null, await selected());

    section('— Pulse: one coin per key while the list changes');
    await load(); await neutral(); await key('Escape');
    await key('j', 2);
    check('setup: B2', (await selected()) === 'B2', await selected());
    await page.evaluate(() => remountB('N1')); await sleep(150);
    check('list re-rendered + new coin on top: ring stays on B2', (await selected()) === 'B2', await selected());
    const steps = [];
    for (const k of ['j', 'k', 'k', 'k']) { await key(k); steps.push(await selected()); }
    check('...then j, k, k, k = B3, B2, B1, N1 (one coin each)', steps.join() === 'B3,B2,B1,N1', steps.join());
    await key('j', 2);
    await page.evaluate(() => shiftB('N2')); await sleep(150);
    check('rows reused, contents shifted down: ring follows B2', (await selected()) === 'B2', await selected());
    await key('j');
    check('...then j = B3', (await selected()) === 'B3', await selected());
    await key('h');
    const aStart = await selected();
    check('hovered A coin shows its extra eye-icon toolbar (scenario active)', await page.evaluate(() => !!document.querySelector('.hovertools')));
    const aSteps = [aStart];
    for (const k of ['k', 'k', 'j', 'j']) { await key(k); aSteps.push(await selected()); }
    const aIdx = aSteps.map(id => Number(id.slice(1)));
    check('column with hover toolbars: every key moves exactly one coin', aIdx.every((n, i) => i === 0 || Math.abs(n - aIdx[i - 1]) === 1) && aIdx[1] === aIdx[0] - 1, aSteps.join());

    section('— Pulse: w opens the coin website');
    await load(); await neutral(); await key('Escape');
    await key('j'); await key('h'); // A1
    let site = opened('sitea1.invalid');
    await clearLog(); await key('w');
    check('w opens the selected coin\'s website (not its X link)', (await site) === 'https://sitea1.invalid/', String(await site));
    check('...in a new window, not a tab', openedInOwnWindow === true, String(openedInOwnWindow));
    check('...and Pulse stays put', /^\/pulse/.test(await page.evaluate(() => location.pathname)) && !(await log()).some(x => x.startsWith('open:')));
    await key('Escape');
    await hover('[data-id=A3] .name');
    site = opened('sitea3.invalid');
    await key('w');
    check('no selection: w opens the hovered coin\'s website', (await site) === 'https://sitea3.invalid/', String(await site));
    await hover('[data-id=B2] .name');
    await key('w');
    check('coin without a website says so', /No website link/.test(await toast()), await toast());

    section('— history');
    const at = async search => {
      for (let i = 0; i < 30; i++) {
        try { if ((await page.evaluate(() => location.search)) === search) return true; } catch {}
        await sleep(100);
      }
      return false;
    };
    const shift = async code => { await page.keyboard.down('Shift'); await page.keyboard.press(code); await page.keyboard.up('Shift'); };
    await page.click('#next');
    check('setup: on ?page=2', await at('?page=2'));
    await sleep(400);
    await page.evaluate(() => history.back());
    await sleep(1200);
    const nativeBack = await page.evaluate(() => location.search);
    await page.evaluate(() => history.forward());
    check('setup: native forward returns to ?page=2', await at('?page=2'));
    await sleep(400);
    await shift('KeyH');
    check(`Shift+H = browser back (→ ${nativeBack})`, await at(nativeBack), await page.evaluate(() => location.search).catch(() => '?'));
    await sleep(400);
    await shift('KeyL');
    check('Shift+L = browser forward (→ ?page=2)', await at('?page=2'), await page.evaluate(() => location.search).catch(() => '?'));
    await load();

    section('— teach');
    await ext.evaluate(async () => {
      for (const t of await chrome.tabs.query({})) {
        try { await chrome.tabs.sendMessage(t.id, { type: 'axs:teach' }); } catch {}
      }
    });
    await page.bringToFront(); await sleep(100);
    check('teach toast shown', /Click the hide/.test(await toast()));
    await clearLog();
    await hover('[data-id=C1] .name');
    await page.click('[data-id=C1] .hide svg'); await sleep(200);
    check('teach click swallowed (C1 not hidden)', !(await log()).length, JSON.stringify(await log()));
    const learned = await storeGet('hideSelector');
    check('selector learned', /^path\[d=/.test(learned || ''), learned);
    console.log('      toast:', await toast());
    await hover('[data-id=C2] .name');
    await hideKey();
    check('after teach, hover C2 + Shift+X hides C2', (await hides()).join() === 'hide:C2', JSON.stringify(await log()));
    await neutral(); await key('j');
    check('nav now runs on the taught coins (C1)', (await selected()) === 'C1', await selected());
    await key('j', 2);
    check('"Migrated" badges on coins don\'t break the column (C1 → C4, C2 is gone)', (await selected()) === 'C4', await selected());
    await key('l');
    check('l from Migrated stays (watchlist ignored)', (await selected()) === 'C4', await selected());

    section('— popup');
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`); await sleep(200);
    const keyLabel = id => popup.$eval(`[data-id=${id}] .key`, b => b.textContent);
    const ui = await popup.evaluate(() => ({ key: document.querySelector('[data-id=hide] .key').textContent, vim: vimNav.checked, sel: document.querySelector('[data-what=pulseHide] code').textContent }));
    check('popup shows Shift + X, vim on, learned selector', ui.key === 'Shift + X' && ui.vim && ui.sel === learned, JSON.stringify(ui));
    check('popup shows trade-page hide button as not taught', /^not taught/.test(await popup.$eval('[data-what=pairHide] code', c => c.textContent)));
    check('popup shows zoom step 4', (await popup.$eval('#zoomSteps', i => i.value)) === '4');
    await popup.$eval('#zoomSteps', i => { i.value = '50'; i.dispatchEvent(new Event('change')); });
    await sleep(150);
    check('popup clamps zoom step to 20', (await storeGet('zoomSteps')) === 20, String(await storeGet('zoomSteps')));
    await store({ zoomSteps: 4 });
    check('popup has Teach rows for tab bar, holders, X link and website', (await popup.$$eval('.teach', rows => rows.map(r => r.dataset.what).join())) === 'pulseHide,pairHide,blacklist,tabBar,holders,twitter,website');
    const kh = await popup.evaluate(() => ({
      open: document.getElementById('help').open, vimDim: document.body.classList.contains('vim-off'),
      keys: Object.fromEntries([...document.querySelectorAll('#keyTables tr[data-id]')].map(r => [r.dataset.id, r.querySelector('.key').textContent])),
      resetsOff: [...document.querySelectorAll('#keyTables .reset')].every(b => b.disabled), resetAllOff: resetKeys.disabled
    }));
    const defaults = { down: 'j', up: 'k', left: 'h', right: 'l', open: 'Enter', clear: 'Esc', hide: 'Shift + X', website: 'w', holdersDown: 'j', holdersUp: 'k', xPreview: 'x', closePreview: 'Esc', zoomOut: 'z', zoomReset: 'Shift + Z', blacklist: 'Shift + B', back: 'Shift + H', forward: 'Shift + L' };
    check('Keys section starts closed and lists every action with its default key', !kh.open && !kh.vimDim && JSON.stringify(kh.keys) === JSON.stringify(defaults) && kh.resetsOff && kh.resetAllOff, JSON.stringify(kh));
    await popup.click('#help summary'); await store({ vimNav: false }); await sleep(150);
    check('Vim keys off dims the vim rows in the Keys help', await popup.evaluate(() => getComputedStyle(document.querySelector('#help tr.vim')).opacity === '0.4'));
    await store({ vimNav: true });
    await popup.reload(); await sleep(200);
    check('Keys help stays open after reopening the popup', await popup.$eval('#help', d => d.open));
    check('popup has no tab-order field (1–9 keys removed)', !(await popup.$('#tabKeys')) && !(await popup.$('#tabHint')));
    await popup.click('[data-what=holders] .t'); await sleep(200); // the active tab is the popup itself: Teach can't start
    check('a Teach error shows in the status line', /Open \(or reload\)/.test(await popup.$eval('#status', s => s.textContent)));
    await store({ twitterSelector: 'a.taught' }); await sleep(150);
    check('...and the rows still refresh afterwards', (await popup.$eval('[data-what=twitter] code', c => c.textContent)) === 'a.taught' && (await keyLabel('hide')) === 'Shift + X');
    await store({ twitterSelector: '' });
    await popup.click('[data-id=hide] .key'); await sleep(100);
    const recState = await popup.$eval('[data-id=hide]', r => ({ rec: r.classList.contains('recording'), key: r.querySelector('.key').textContent, label: r.cells[1].textContent }));
    check('clicking a key starts recording (empty keycap with a cursor, label says what to do)', recState.rec && recState.key === '' && /^Press the new key/.test(recState.label), JSON.stringify(recState));
    await popup.click('#zoomSteps', { count: 3 }); await popup.keyboard.type('7'); await sleep(150);
    const rec = { keys: await storeGet('keys'), field: await popup.$eval('#zoomSteps', i => i.value), label: await keyLabel('hide') };
    check('key recorder cancels when you click elsewhere (typing goes to that field)', !Object.keys(rec.keys || {}).length && rec.field === '7' && rec.label === 'Shift + X', JSON.stringify(rec));
    await popup.click('[data-id=hide] .key');
    await popup.keyboard.down('Shift'); await popup.keyboard.press('KeyD'); await popup.keyboard.up('Shift');
    await sleep(200);
    check('rebind hide to Shift + D', (await keyLabel('hide')) === 'Shift + D' && (await storeGet('keys')).hide?.code === 'KeyD', await keyLabel('hide'));
    check('...its reset button and Reset all light up', !(await popup.$eval('[data-id=hide] .reset', b => b.disabled)) && !(await popup.$eval('#resetKeys', b => b.disabled)));
    await store({ zoomSteps: 4 });
    await popup.click('[data-what=pulseHide] .r'); await sleep(150);
    check('Auto button clears learned selector', (await storeGet('hideSelector')) === '');

    await page.bringToFront();
    await load(); await clearLog();
    await hover('[data-id=A2] .name');
    await hideKey();
    await page.keyboard.down('Shift'); await page.keyboard.press('KeyD'); await page.keyboard.up('Shift'); await sleep(80);
    check('old Shift+X ignored, Shift+D hides A2', (await hides()).join() === 'hide:A2', JSON.stringify(await log()));

    section('— remapping keys');
    const record = async (id, press) => {
      await popup.bringToFront();
      await popup.click(`[data-id=${id}] .key`);
      await press();
      await sleep(200);
    };
    await record('down', () => popup.keyboard.press('ArrowDown'));
    check('rebind "Next coin" to ↓', (await keyLabel('down')) === '↓', await keyLabel('down'));
    await page.bringToFront();
    await load(); await neutral();
    await key('ArrowDown'); await key('ArrowDown');
    const afterArrows = await selected();
    await clearLog(); await key('j');
    check('↓ moves down the column, and j now goes to the page', afterArrows === 'B2' && (await selected()) === 'B2' && (await log()).includes('pagekey:j'), `${afterArrows} → ${await selected()} ${JSON.stringify(await log())}`);
    await record('website', () => popup.keyboard.press('KeyK'));
    const clash = await popup.evaluate(() => ({
      website: document.querySelector('[data-id=website]').classList.contains('conflict'),
      up: document.querySelector('[data-id=up]').classList.contains('conflict'), status: document.getElementById('status').textContent
    }));
    check('a key used twice is flagged on both rows, and the status says which', clash.website && clash.up && /^k is also “Previous coin”/.test(clash.status), JSON.stringify(clash));
    await popup.click('[data-id=website] .reset'); await sleep(200);
    check('...its reset button puts it back to w and clears the warning', (await keyLabel('website')) === 'w' && !(await popup.$('#keyTables .conflict')));
    await record('open', () => popup.keyboard.press('Space'));
    check('Space can\'t be used (it stays with Axiom)', (await keyLabel('open')) === 'Enter' && /Space is left to Axiom/.test(await popup.$eval('#status', s => s.textContent)), await popup.$eval('#status', s => s.textContent));
    await record('open', () => popup.keyboard.press('Escape'));
    check('Esc cancels recording', (await keyLabel('open')) === 'Enter' && !(await storeGet('keys')).open);
    await record('xPreview', () => popup.keyboard.press('KeyV'));
    await page.bringToFront();
    await page.goto('https://axiom.trade/meme/TEST', { waitUntil: 'domcontentloaded' }); await sleep(600);
    await moveTo(300, 250); // over the chart
    await clearLog(); await page.keyboard.down('v'); await sleep(300);
    const heldV = await log();
    await page.keyboard.up('v'); await sleep(100);
    check('X preview rebound to v: holding v opens it, letting go closes it', heldV.includes('preview:open:token') && (await log()).includes('preview:close'), JSON.stringify(await log()));
    await clearLog(); await key('x'); await sleep(300);
    check('...and x now goes to the page', !(await log()).some(x => x.startsWith('preview:open')) && (await log()).includes('pagekey:x'), JSON.stringify(await log()));
    await popup.bringToFront();
    await popup.click('#resetKeys'); await sleep(200);
    check('Reset all keys puts every key back', JSON.stringify(await storeGet('keys')) === '{}' && (await keyLabel('down')) === 'j' && (await keyLabel('hide')) === 'Shift + X' && await popup.$eval('#resetKeys', b => b.disabled));
    await store({ hideKey: { code: 'KeyQ', ctrl: false, alt: false, shift: true, meta: false } });
    await popup.reload(); await sleep(300);
    const migrated = { keys: await storeGet('keys'), old: await storeGet('hideKey'), label: await keyLabel('hide') };
    check('a hide key saved by an older version moves into the new key settings', migrated.keys?.hide?.code === 'KeyQ' && migrated.old === undefined && migrated.label === 'Shift + Q', JSON.stringify(migrated));
    await store({ keys: {} });
    await page.bringToFront();

    section('— open');
    await load(); await clearLog();
    await neutral(); await key('Escape'); await key('Enter');
    l = await log();
    check('Enter with nothing selected passes through', l.includes('pagekey:Enter') && !l.some(x => /^(open|buy|social|hide)/.test(x)), JSON.stringify(l));
    await clearLog();
    await key('j'); await key('h'); await key('j'); // B1 → A1 → A2
    l = await log();
    check('selecting coins never hovers the dev-migrations widget', !l.some(x => x.startsWith('devpanel')), JSON.stringify(l));
    await clearLog();
    await key('Enter');
    l = await log();
    check('Enter opens the selected coin (A2), no Solscan / dev panel', l.join() === 'open:A2', JSON.stringify(l));
    await key('j');
    await clearLog();
    await key('Enter');
    l = await log();
    check('Buy button across the middle is avoided (A3 opens, no buy)', l.join() === 'open:A3', JSON.stringify(l));
    await key('l');
    check('setup: l → B3', (await selected()) === 'B3', await selected());
    await key('Enter');
    const atPath = async want => {
      for (let i = 0; i < 30; i++) {
        try { if ((await page.evaluate(() => location.pathname)) === want) return true; } catch {}
        await sleep(100);
      }
      return false;
    };
    check('Enter follows the token link (/meme/B3)', await atPath('/meme/B3'), await page.evaluate(() => location.pathname).catch(() => '?'));
    await sleep(400);

    section('— trade page: j/k scroll holders');
    await page.goto('https://axiom.trade/meme/TEST', { waitUntil: 'domcontentloaded' }); await sleep(600);
    await clearLog();
    const tops = () => page.evaluate(() => ({ h: holders.scrollTop, panel: panel.scrollTop, wallets: wallets.scrollTop, feed: feed.scrollTop, stats: stats.scrollTop, win: scrollY }));
    const others0 = t => t.wallets === 0 && t.feed === 0 && t.stats === 0 && t.win === 0;
    await key('j');
    let tp = await tops();
    check('j scrolls holders one row (32px)', tp.h === 32 && others0(tp), JSON.stringify(tp));
    await key('j', 3);
    check('j ×3 more → 128px', (await tops()).h === 128, JSON.stringify(await tops()));
    await key('k');
    check('k scrolls back one row → 96px', (await tops()).h === 96, JSON.stringify(await tops()));
    await page.keyboard.down('j'); await sleep(30);
    await page.keyboard.down('j'); await sleep(30);
    await page.keyboard.down('j'); await sleep(30);
    await page.keyboard.up('j'); await sleep(80);
    tp = await tops();
    check('holding j keeps scrolling → 192px', tp.h === 192 && others0(tp), JSON.stringify(tp));
    check('j/k not leaked to page', !(await log()).some(x => /^pagekey:[jk]$/.test(x)), JSON.stringify(await log()));
    await page.click('#amount');
    await key('j');
    check('typing in the amount box types, no scroll', (await page.$eval('#amount', i => i.value)) === 'j' && (await tops()).h === 192);
    await page.$eval('#amount', i => i.blur());
    await store({ vimNav: false }); await sleep(100);
    await clearLog(); await key('j');
    check('vim nav off → j passes through', (await log()).includes('pagekey:j') && (await tops()).h === 192);
    await store({ vimNav: true }); await sleep(100);

    section('— trade page: tab bar inside the scrolling panel (sticky tabs)');
    await page.goto('https://axiom.trade/meme/sticky', { waitUntil: 'domcontentloaded' }); await sleep(600);
    await clearLog(); await key('j', 2);
    tp = await tops();
    check('j scrolls the Holders panel, not tracked wallets (2 rows = 64px)', tp.panel === 64 && others0(tp), JSON.stringify(tp));
    await page.evaluate(() => { holdersTab.setAttribute('aria-selected', 'false'); tradesTab.setAttribute('aria-selected', 'true'); });
    await clearLog(); await key('j');
    tp = await tops();
    check('Holders tab not open → no scroll, j passes through', tp.panel === 64 && (await log()).includes('pagekey:j'), JSON.stringify(tp));
    check('...and says so', /Open the Holders tab/.test(await toast()), await toast());
    await page.goto('https://axiom.trade/meme/TEST', { waitUntil: 'domcontentloaded' }); await sleep(600);

    section('— trade page: x = Twitter preview');
    await moveTo(300, 250); // over the chart
    const holdX = async () => { await page.keyboard.down('x'); await sleep(300); };
    const releaseX = async () => { await page.keyboard.up('x'); await sleep(100); };
    await clearLog(); await holdX();
    l = await log();
    check("holding x opens the token's own X preview (not search / feed links)", l.includes('preview:open:token') && !l.some(x => /:(search|feed)$/.test(x)), JSON.stringify(l));
    check('x not passed to the page', !l.includes('pagekey:x'));
    await page.keyboard.down('x'); await sleep(300); // auto-repeat while held
    check('...it stays open while x is held (repeats)', !(await log()).includes('preview:close'), JSON.stringify(await log()));
    await releaseX();
    check('releasing x closes it', (await log()).includes('preview:close'), JSON.stringify(await log()));
    await clearLog(); await key('x'); await sleep(300);
    check('a quick tap opens and closes (no toggle left on)', !(await log()).includes('preview:open:token') || (await log()).includes('preview:close'), JSON.stringify(await log()));
    await clearLog(); await holdX(); await key('Escape'); await sleep(100);
    l = await log();
    check('Esc closes it while held', l.includes('preview:open:token') && l.includes('preview:close') && !l.includes('pagekey:Escape'), JSON.stringify(l));
    await releaseX();
    await clearLog(); await holdX(); await moveTo(420, 320); await sleep(100);
    check('moving the mouse closes it', (await log()).includes('preview:close'), JSON.stringify(await log()));
    await releaseX();
    await clearLog(); await key('j');
    check('j still scrolls holders afterwards', !(await log()).includes('pagekey:j'));

    section('— trade page: z / Z chart zoom');
    await page.goto('https://axiom.trade/meme/TEST', { waitUntil: 'domcontentloaded' }); await sleep(1200);
    await moveTo(300, 600); // over the holders list, not the chart
    await clearLog(); await key('z');
    l = await log();
    const wheels = list => list.filter(x => x === 'chart:wheel:100:right').length;
    check('z = 4 wheel notches over the chart (zoom out, near the right edge)', wheels(l) === 4 && l.length === 4, JSON.stringify(l));
    await clearLog();
    await page.keyboard.down('z'); await sleep(30);
    await page.keyboard.down('z'); await sleep(30);
    await page.keyboard.down('z'); await sleep(30);
    await page.keyboard.up('z'); await sleep(80);
    check('holding z keeps zooming (3 presses × 4 = 12 notches)', wheels(await log()) === 12, JSON.stringify(await log()));
    await store({ zoomSteps: 7 }); await sleep(100);
    await clearLog(); await key('z');
    check('zoom step setting is used (7 notches)', wheels(await log()) === 7, JSON.stringify(await log()));
    await store({ zoomSteps: 4 }); await sleep(100);
    await clearLog(); await combo('Shift', 'KeyZ');
    l = await log();
    check("Shift+Z sends the chart's own Alt+R reset (no Reset button shown)", l.includes('chart:reset-key') && !l.includes('pagekey:Z'), JSON.stringify(l));

    const frame = await (await page.$('#chartFrame')).contentFrame();
    await frame.click('#pane'); await sleep(100);
    await clearLog(); await key('z');
    l = await log();
    check('with focus inside the chart, z still zooms (and the chart never sees z)', wheels(l) === 4 && l.length === 4, JSON.stringify(l));
    const h0 = await page.evaluate(() => holders.scrollTop);
    await key('j');
    check('...and j still scrolls holders', (await page.evaluate(() => holders.scrollTop)) === h0 + 32);
    await frame.click('#symbolSearch');
    await clearLog(); await key('z');
    check('typing in a chart input types z, no zoom', (await frame.$eval('#symbolSearch', i => i.value)) === 'z' && !(await log()).some(x => x.startsWith('chart:wheel')), JSON.stringify(await log()));
    await frame.$eval('#symbolSearch', i => i.blur());

    await page.goto('https://axiom.trade/meme/TEST-controls', { waitUntil: 'domcontentloaded' }); await sleep(1200);
    await clearLog(); await combo('Shift', 'KeyZ');
    l = await log();
    check("Shift+Z clicks the chart's Reset button when it's there", l.includes('chart:reset-button') && !l.includes('chart:reset-key'), JSON.stringify(l));

    section('— trade page: number keys go to Axiom');
    await page.goto('https://axiom.trade/meme/TEST', { waitUntil: 'domcontentloaded' }); await sleep(800);
    const selectedTab = () => page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]').textContent);
    await clearLog(); await key('2');
    check('2 passes through to Axiom (no tab switch)', (await log()).includes('pagekey:2') && !(await log()).some(x => x.startsWith('tab:')) && (await selectedTab()) === 'Holders (250)', JSON.stringify(await log()));

    section('— trade page: Shift+B blacklists, hides and goes back');
    await load();
    let fromSearch = await page.evaluate(() => location.search);
    await page.goto('https://axiom.trade/meme/TEST', { waitUntil: 'domcontentloaded' }); await sleep(800);
    await clearLog(); await combo('Shift', 'KeyB');
    l = await log();
    check('hide button not taught: Shift+B blacklists, says the token wasn\'t hidden', l.includes('blacklist') && !l.includes('trade-hide') && /Teach the trade-page hide button/.test(await toast()), JSON.stringify(l));
    check('...and still goes back', await atUrl('/pulse', fromSearch), await page.evaluate(() => location.href).catch(() => '?'));
    await page.goto('https://axiom.trade/meme/TEST', { waitUntil: 'domcontentloaded' }); await sleep(800);
    await teach('pairHide'); await page.bringToFront(); await sleep(100);
    await page.click('#tradeHide i'); await sleep(200);
    await clearLog(); await combo('Shift', 'KeyB'); await combo('Shift', 'KeyB');
    l = await log();
    check('Shift+B clicks Blacklist dev and the hide button, once each (repeat ignored)', l.filter(x => x === 'blacklist').length === 1 && l.filter(x => x === 'trade-hide').length === 1 && !l.includes('balance'), JSON.stringify(l));
    check('...and goes back exactly one page', await atUrl('/pulse', fromSearch), await page.evaluate(() => location.href).catch(() => '?'));
    await page.goto('https://axiom.trade/meme/blicon', { waitUntil: 'domcontentloaded' }); await sleep(800);
    await clearLog(); await combo('Shift', 'KeyB'); await sleep(400);
    l = await log();
    check('icon-only Blacklist button: nothing happens at all (no hide, no going back)', !l.includes('blacklist') && !l.includes('trade-hide') && /Blacklist dev button not found/.test(await toast()) && (await page.evaluate(() => location.pathname)) === '/meme/blicon', JSON.stringify(l));
    reply = await teach('blacklist');
    await page.bringToFront(); await sleep(100);
    await page.click('#blacklist'); await sleep(200);
    const blSel = await storeGet('blacklistSelector');
    check('Teach learns the Blacklist dev button (click swallowed)', !!blSel && !(await log()).includes('blacklist'), blSel);
    await combo('Shift', 'KeyB');
    l = await log();
    check('...then Shift+B blacklists and hides', l.includes('blacklist') && l.includes('trade-hide'), JSON.stringify(l));
    await store({ blacklistSelector: '', pairHideSelector: '' });
    await sleep(400);
    await page.goto('https://axiom.trade/meme/TEST', { waitUntil: 'domcontentloaded' }); await sleep(800);

    section('— trade page: deep tab labels, Teach tab bar, debug info');
    await page.goto('https://axiom.trade/meme/deep6', { waitUntil: 'domcontentloaded' }); await sleep(800);
    const h6 = await page.evaluate(() => holders.scrollTop);
    await key('j');
    check('labels 6 levels deep: j scrolls holders', (await page.evaluate(() => holders.scrollTop)) === h6 + 32);
    await page.goto('https://axiom.trade/meme/deep10', { waitUntil: 'domcontentloaded' }); await sleep(800);
    await key('j');
    check('labels 10 levels deep: auto-detect gives up ("not found")', /Holders list not found/.test(await toast()), await toast());
    let dbg = await debugInfo();
    check('debug info shows no Holders list, with the label\'s element chain', dbg && !dbg.holdersList && dbg.holdersText.some(h => h.chain.length > 8), JSON.stringify(dbg?.holdersText));
    reply = await teach('tabBar');
    await page.bringToFront(); await sleep(100);
    check('Teach tab bar starts', reply?.ok && /bottom tabs/.test(await toast()), JSON.stringify(reply));
    await page.click('#holdersTab'); await sleep(200);
    const barSel = await storeGet('tabBarSelector');
    check('learned the tab bar (click swallowed)', /tabs/.test(barSel || '') && (await selectedTab()) === 'Holders (250)', barSel);
    const h10 = await page.evaluate(() => holders.scrollTop);
    await key('j');
    check('taught bar: j scrolls holders', (await page.evaluate(() => holders.scrollTop)) === h10 + 32);
    dbg = await debugInfo();
    check('debug info now shows the taught bar and the Holders list', dbg.tabBar !== 'not taught' && !!dbg.holdersList, JSON.stringify({ tabBar: dbg.tabBar, holdersList: dbg.holdersList }));
    await store({ tabBarSelector: '' });
    await page.goto('https://axiom.trade/meme/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', { waitUntil: 'domcontentloaded' }); await sleep(800);
    dbg = await debugInfo();
    check('debug info masks token addresses', dbg.page === '/meme/<addr>' && !JSON.stringify(dbg).includes('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'), dbg.page);
    check('debug info covers chart and links', dbg.chart.paneFound && dbg.chart.iframes[0].sameOrigin && dbg.linkHostsOnScreen.includes('x.com'), JSON.stringify(dbg.chart));
    await page.goto('https://axiom.trade/meme/TEST', { waitUntil: 'domcontentloaded' }); await sleep(800);

    section('— trade page: w opens the website');
    let tab = opened('tokenproject.invalid');
    await clearLog(); await key('w');
    let url = await tab;
    check('w opens the token website (not pump.fun / Solscan / X)', url === 'https://tokenproject.invalid/', url);
    check('...in a new window, not a tab', openedInOwnWindow === true, String(openedInOwnWindow));
    check('...and the trade page stays put', (await page.evaluate(() => location.pathname)) === '/meme/TEST');
    const siteTabs = () => browser.targets().filter(tg => tg.url().includes('tokenproject.invalid')).length;
    for (let i = 0; i < 30 && siteTabs(); i++) await sleep(100); // the tab above is still closing
    await clearLog();
    await page.keyboard.down('Space'); await key('w'); await page.keyboard.up('Space'); await sleep(500);
    check('Space+W (Axiom quick buy) reaches the page and opens nothing', siteTabs() === 0 && (await log()).includes('pagekey:w'), JSON.stringify(await log()));
    tab = opened('tokenproject.invalid');
    await key('w');
    check('...and w works again once Space is released', (await tab) === 'https://tokenproject.invalid/', String(await tab));
    reply = await teach('website');
    await page.bringToFront(); await sleep(100);
    await page.click('#docs'); await sleep(200);
    const siteSel = await storeGet('websiteSelector');
    check('Teach website learns the clicked link (and the click is swallowed)', !!siteSel && (await page.evaluate(() => location.pathname)) === '/meme/TEST', siteSel);
    tab = opened('docs.tokenproject.invalid');
    await key('w');
    url = await tab;
    check('w now opens the taught link', url === 'https://docs.tokenproject.invalid/', url);
    await store({ websiteSelector: '' });

    section('— trade page: Teach holders list and X link');
    await load();
    reply = await teach('holders');
    check('Teach holders on Pulse is refused', reply && !reply.ok && /trade page/.test(reply.message), JSON.stringify(reply));
    await page.goto('https://axiom.trade/meme/hodl', { waitUntil: 'domcontentloaded' }); await sleep(800);
    const hx = () => page.evaluate(() => document.querySelector('.holders-x').scrollTop);
    await clearLog(); await key('j');
    check('auto-detect misses this layout (toast suggests Teach)', (await hx()) === 0 && /try Teach/.test(await toast()), await toast());
    reply = await teach('holders');
    await page.bringToFront(); await sleep(100);
    check('Teach holders starts on a trade page', reply?.ok && /inside the Holders list/.test(await toast()), JSON.stringify(reply));
    await page.click('.holders-x .row:nth-child(3)'); await sleep(200);
    const hSel = await storeGet('holdersSelector');
    check('learned the Holders list', /holders-x/.test(hSel || ''), hSel);
    await key('j', 2);
    check('j now scrolls the taught list (64px)', (await hx()) === 64, String(await hx()));
    check('wallets and feed untouched', await page.evaluate(() => wallets.scrollTop === 0 && feed.scrollTop === 0));
    await store({ holdersSelector: '' });

    await page.goto('https://axiom.trade/meme/TEST', { waitUntil: 'domcontentloaded' }); await sleep(800);
    await moveTo(300, 250);
    reply = await teach('twitter');
    await page.bringToFront(); await sleep(100);
    await clearLog();
    await page.click('[data-tw=feed]'); await sleep(200);
    check('teach click on the X link is swallowed', (await page.evaluate(() => location.pathname)) === '/meme/TEST');
    const twSel = await storeGet('twitterSelector');
    check('learned a selector for that X link', !!twSel, twSel);
    await moveTo(300, 250);
    await clearLog(); await page.keyboard.down('x'); await sleep(300);
    check('x now previews the taught link', (await log()).includes('preview:open:feed'), JSON.stringify(await log()));
    await page.keyboard.up('x'); await sleep(100);
    await store({ twitterSelector: '' }); await sleep(100);
    await clearLog(); await page.keyboard.down('x'); await sleep(300);
    check('after Reset, x is back to the token link', (await log()).includes('preview:open:token'), JSON.stringify(await log()));
    await page.keyboard.up('x'); await sleep(100);

    section('— trade page: Shift+X hides and goes back');
    await store({ keys: {} }); // the remapping tests changed keys
    await load();
    const pulseSearch = await page.evaluate(() => location.search);
    await page.goto('https://axiom.trade/meme/TEST2', { waitUntil: 'domcontentloaded' }); await sleep(600);
    await clearLog(); await hideKey(); await sleep(400);
    l = await log();
    check('before Teach: Shift+X does nothing', !l.some(x => /^(trade-hide|balance)/.test(x)) && (await page.evaluate(() => location.pathname)) === '/meme/TEST2', JSON.stringify(l));
    check('...and says to Teach', /Teach the trade-page/.test(await toast()), await toast());
    await ext.evaluate(async () => {
      for (const t of await chrome.tabs.query({})) {
        try { await chrome.tabs.sendMessage(t.id, { type: 'axs:teach' }); } catch {}
      }
    });
    await page.bringToFront(); await sleep(100);
    await clearLog();
    await page.click('#tradeHide i'); await sleep(200);
    check('teach click swallowed (nothing hidden)', !(await log()).includes('trade-hide'), JSON.stringify(await log()));
    const pairSel = await storeGet('pairHideSelector');
    check('learned a selector unique on the page (not the shared eye icon)', /aria-label/.test(pairSel || ''), pairSel);
    check('Pulse hide selector untouched', (await storeGet('hideSelector')) === '');
    await clearLog(); await hideKey(); await hideKey(); await sleep(20);
    l = await log();
    check('Shift+X clicks the trade-page hide button, not the balance eye', l.includes('trade-hide') && !l.includes('balance'), JSON.stringify(l));
    check('...a quick second Shift+X doesn\'t click again', l.filter(x => x === 'trade-hide').length === 1, JSON.stringify(l));
    check('...then goes back to Pulse', await atUrl('/pulse', pulseSearch), await page.evaluate(() => location.href).catch(() => '?'));
    await sleep(300);
    check('...exactly one page back', (await page.evaluate(() => location.search)) === pulseSearch);
    await openPage();
    await page.goto('https://axiom.trade/meme/TEST3', { waitUntil: 'domcontentloaded' }); await sleep(800);
    await hideKey();
    check('opened directly (no earlier Axiom page): goes to Pulse instead of leaving', await atUrl('/pulse', ''), await page.evaluate(() => location.href).catch(() => '?'));
    await store({ pairHideSelector: '' });

    section('— trade page: hide button repeated in a floating panel');
    await openPage();
    await page.goto('https://axiom.trade/meme/TEST4', { waitUntil: 'domcontentloaded' }); await sleep(600);
    await teach('pairHide'); await page.bringToFront(); await sleep(100);
    await page.click('#tradeHide i'); await sleep(200);
    const plainSel = await storeGet('pairHideSelector');
    await page.goto('https://axiom.trade/meme/float1', { waitUntil: 'domcontentloaded' }); await sleep(600);
    await clearLog(); await hideKey(); await sleep(400);
    l = await log();
    check('taught without the panel: once it shows, Shift+X clicks nothing and says to teach with it open', !l.some(x => /hide/.test(x)) && /Teach it again while the panel is open/.test(await toast()), `${JSON.stringify(l)} ${await toast()}`);
    await teach('pairHide'); await page.bringToFront(); await sleep(100);
    await clearLog(); await page.click('#tradeHide i'); await sleep(200);
    const floatSel = await storeGet('pairHideSelector');
    check('Teach with the panel open learns the token\'s own button (click swallowed)', !!floatSel && floatSel !== plainSel && /Learned/.test(await toast()) && !(await log()).length, `${floatSel} | ${await toast()}`);
    await clearLog(); await hideKey(); await sleep(20);
    l = await log();
    check('...then Shift+X clicks the token\'s hide button, not a panel coin\'s', l.includes('trade-hide') && !l.some(x => x.startsWith('panel-hide')), JSON.stringify(l));
    check('...and goes back', await atUrl('/meme/TEST4', ''), await page.evaluate(() => location.href).catch(() => '?'));
    await page.goto('https://axiom.trade/meme/TEST5', { waitUntil: 'domcontentloaded' }); await sleep(600);
    await clearLog(); await hideKey(); await sleep(20);
    check('...and still works on a trade page without the panel', (await log()).includes('trade-hide'), JSON.stringify(await log()));
    await page.goto('https://axiom.trade/meme/floatclone', { waitUntil: 'domcontentloaded' }); await sleep(600);
    await teach('pairHide'); await page.bringToFront(); await sleep(100);
    await page.click('#tradeHide i'); await sleep(200);
    const cloneSel = await storeGet('pairHideSelector');
    check('panel rows reuse the header markup: Teach still singles out the token\'s button', /Learned/.test(await toast()) && cloneSel !== floatSel, `${cloneSel} | ${await toast()}`);
    await clearLog(); await hideKey(); await sleep(20);
    l = await log();
    check('...and Shift+X clicks it, not a panel coin\'s', l.includes('trade-hide') && !l.some(x => x.startsWith('panel-hide')), JSON.stringify(l));
    await page.goto('https://axiom.trade/meme/floatclone2', { waitUntil: 'domcontentloaded' }); await sleep(600);
    // A box around the button changes after Teach (e.g. a hover class): the taught selector finds nothing.
    await page.evaluate(() => document.querySelector('main > header.token').classList.replace('token', 'token-x'));
    await hideKey(); await sleep(100);
    dbg = await debugInfo();
    const chains = dbg.pairHideChains || [];
    check('debug info: taught selector finds nothing, shows the last message and its last part\'s full chains', dbg.pairHideMatches === 0 && /isn't on this page/.test(dbg.lastMessage) && dbg.pairHideShowing === 'its last part: i.ri-eye-off-line' && chains.some(m => m.chain.some(c => /header\.token-x/.test(c))), JSON.stringify({ last: dbg.lastMessage, showing: dbg.pairHideShowing, chains }));
    await store({ pairHideSelector: '[aria-label="Hide token"]' }); await sleep(100);
    dbg = await debugInfo();
    check('debug info shows where the hide button copies meet, flagging the floating panel', dbg.pairHideMatches === 4 && /^body/.test(dbg.pairHideMeet) && dbg.pairHideChains.some(m => m.chain.some(c => /pos=fixed/.test(c))), JSON.stringify({ meet: dbg.pairHideMeet, chains: dbg.pairHideChains }));
    await store({ pairHideSelector: '' });

    section('— trade page: real Axiom markup (pill bar, hover-only classes on the avatar)');
    await openPage();
    await page.goto('https://axiom.trade/meme/TEST6', { waitUntil: 'domcontentloaded' }); await sleep(400);
    await page.goto('https://axiom.trade/meme/real1', { waitUntil: 'domcontentloaded' }); await sleep(600);
    await teach('pairHide'); await page.bringToFront(); await sleep(100);
    await clearLog(); await page.click('#tradeHide i'); await sleep(200);
    const realSel = await storeGet('pairHideSelector');
    check('Teach learns the avatar\'s hide button, leaving out its hover-only classes', /Learned/.test(await toast()) && !!realSel && !/[!&]/.test(realSel) && !(await log()).length, `${realSel} | ${await toast()}`);
    await page.mouse.move(700, 700); await sleep(100);
    check('...(those classes are gone once the mouse leaves)', await page.evaluate(() => !document.getElementById('tradeHide').closest('div.group').className.includes('!')));
    await clearLog(); await hideKey(); await sleep(20);
    l = await log();
    check('...and with the mouse elsewhere, Shift+X clicks it, not a pill\'s', l.includes('trade-hide') && !l.some(x => x.startsWith('panel-hide')), JSON.stringify(l));
    check('...and goes back', await atUrl('/meme/TEST6', ''), await page.evaluate(() => location.href).catch(() => '?'));
    await page.goto('https://axiom.trade/meme/real2', { waitUntil: 'domcontentloaded' }); await sleep(600);
    await store({ pairHideSelector: 'div.gone i.ri-eye-off-line' }); await sleep(100);
    dbg = await debugInfo();
    check('debug info lists look-alike buttons once, with a count (the pills), and the avatar\'s separately', dbg.pairHideMatches === 0 && dbg.pairHideChains.some(g => g.count === 6) && dbg.pairHideChains.some(g => g.count === 1 && g.chain.some(c => c.includes('h-[36px]'))), JSON.stringify(dbg.pairHideChains.map(g => ({ count: g.count, chain: g.chain.slice(0, 5) }))));
    await store({ pairHideSelector: '' });

    section('— no Pulse columns');
    await load();
    await page.evaluate(() => {
      document.querySelectorAll('.col header').forEach(h => { h.firstChild.nodeValue = 'Something else '; });
      document.querySelectorAll('.badge').forEach(b => b.remove());
    });
    await neutral(); await key('Escape'); await key('j');
    check('without column titles, j selects nothing', (await selected()) === null, await selected());
    check('...and says why', /Pulse columns not found/.test(await toast()), await toast());
    await clearLog();
    await hover('[data-id=W2] .name'); await hideKey();
    await hover('[data-id=A2] .name'); await hideKey();
    check('without column titles, the hide key hides nothing (not even the hovered coin)', !(await hides()).length && /Pulse columns not found/.test(await toast()), JSON.stringify(await log()));

    section('— Pulse: hiding the last coin of a column');
    await load(); await neutral(); await key('Escape');
    await key('j'); await key('h'); // A1
    for (let i = 0; i < 4; i++) { await hideKey(); await sleep(150); }
    check('hid all four A coins one after another', (await hides()).join() === 'hide:A1,hide:A2,hide:A3,hide:A4', (await hides()).join());
    check('...then the selection clears instead of jumping to another column', (await selected()) === null, await selected());
    await hideKey();
    check('...so another Shift+X hides nothing', (await hides()).length === 4, (await hides()).join());

    section('— Pulse: Teach refuses a Buy button');
    await load();
    reply = await teach('pulseHide');
    await page.bringToFront(); await sleep(100);
    await page.click('[data-id=A1] .buy'); await sleep(200);
    check('teaching the Buy button as the hide icon is refused', (await storeGet('hideSelector')) === '' && /Couldn't single out/.test(await toast()), await toast());
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
