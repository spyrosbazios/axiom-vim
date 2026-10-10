# Axiom Vim

Vim-style keyboard shortcuts for [axiom.trade](https://axiom.trade). Move through Pulse with `hjkl`, open and hide coins, scroll holders, preview X, zoom the chart and go back without touching the mouse.

A Chrome extension (Manifest V3). Unofficial: not made by or affiliated with Axiom.

- **Pulse:** `hjkl` moves between coins in the New Pairs / Final Stretch / Migrated columns, `Enter` opens one, `Shift+X` hides it.
- **Trade page:** `j`/`k` scroll the Holders list, hold `x` for the X preview, `z` zooms the chart out, `Shift+B` blacklists the dev and leaves.
- **Anywhere:** `Shift+H` / `Shift+L` go back / forward, like Vimium.
- **Layout-proof:** keys match the physical key, so they work on any keyboard layout (e.g. Greek).
- **Built-in cheat sheet:** the popup's **Keys** section lists every shortcut.

## Install

1. Clone the repo:

   ```sh
   git clone https://github.com/spyrosbazios/axiom-vim.git
   ```

2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `axiom-vim` folder.
4. Reload any open axiom.trade tabs.

It works in any Chromium browser that loads unpacked extensions (Chrome, Brave, Edge, Helium, …).

To update, `git pull`, click the reload icon on the extension card, then reload the Axiom tab.

## Keys

### Pulse

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous coin in the column |
| `h` / `l` | Previous / next column (lands on the coin at the same height) |
| `Enter` | Open the selected coin |
| `w` | Open the selected (or hovered) coin's website in a new window |
| `x` | Axiom's own X (Twitter) preview, for the selected coin |
| `Shift+X` | Hide the selected coin, or the hovered one if nothing is selected |
| `Esc` | Clear the selection |

- The selected coin counts as hovered, so Axiom's own hover shortcuts (like `x`) act on it.
- When you arrive on Pulse, the first Final Stretch coin is selected for you. Moving the mouse or pressing a key first skips this.
- With nothing selected, the first `hjkl` press starts at the middle column, or at the coin under the mouse if you just moved it there.
- Moving the mouse more than a few pixels clears the selection and hands control back to the mouse.
- After a hide, the selection moves to the next coin in the same column.
- Only coins inside the three Pulse columns count. Menus, sidebars and dropdowns are never touched.

### Trade page

| Key | Action |
| --- | --- |
| `j` / `k` | Scroll the Holders list one row down / up |
| `x` (hold) | Show the token's X preview while held. Release, `Esc` or moving the mouse closes it |
| `w` | Open the token's website in a new window |
| `z` | Zoom the chart out (4 wheel notches per press, set in the popup; hold to keep going) |
| `Shift+Z` | Reset the chart view |
| `Shift+B` | Click Axiom's "Blacklist dev", then its hide button (if taught), then go back |
| `Shift+X` | Click Axiom's hide button, then go back. Needs [Teach](#teach) first |

Going back lands on Pulse when there's no earlier Axiom page.

### Anywhere on axiom.trade

| Key | Action |
| --- | --- |
| `Shift+H` / `Shift+L` | Browser back / forward |

### Good to know

- Shortcuts are ignored while you type in a text field.
- While Space is held, every key goes to Axiom untouched, so Axiom's own Space+key hotkeys (like quick buy) keep working.
- Number keys are left to Axiom.
- The hide key can be rebound in the popup.
- The popup's **Vim keys** switch turns off `hjkl`, `Enter` and `Esc` on Pulse, `j`/`k` on trade pages, and `Shift+H`/`L`.

## Popup

| Setting | What it does |
| --- | --- |
| **Enabled** | Turns every shortcut on or off |
| **Vim keys** | Turns the vim movement keys on or off (see above) |
| **Hide coin** | Click it, then press a new key combo for hide |
| **Zoom out per z** | Wheel notches per `z` press, 1–20 |
| **Teach** rows | Point the extension at the right button when auto-detection misses |
| **Copy debug info** | Copies the page structure for a bug report |
| **Keys** | Cheat sheet of every shortcut |

## Teach

Axiom has no public API for its page layout, so the extension finds buttons and lists by looking at the page. When it misses, teach it once: open the popup, click **Teach** on a row, then click that thing on the page. The click is captured, not executed. **Reset** goes back to auto-detection.

| Row | Where | What to click |
| --- | --- | --- |
| Pulse hide button | Pulse | The hide (eye) icon on any coin |
| Trade hide button | Trade page | The token's hide button. Until taught, `Shift+X` does nothing on trade pages |
| Blacklist dev button | Trade page | The "Blacklist dev" button |
| Tab bar | Trade page | Any of the bottom tabs. Helps find the Holders list |
| Holders list | Trade page | Anywhere inside the Holders list |
| X (Twitter) link | Trade page | The token's X link |
| Website link | Trade page | The token's website link |

Teach refuses anything it can't recognize safely:

- On Pulse, the hide icon must appear once per coin and never be a Buy/Sell button.
- On trade pages, the item must be the only match on the page, so a look-alike (like another eye icon) can't be hit by mistake.

## Privacy

- Runs only on `https://*.axiom.trade/*`.
- The only permission is `storage`, for your settings (synced by your browser).
- No network requests, no analytics, no wallet access. It never reads keys or signs anything.
- **Copy debug info** holds page structure only (element types, class names, sizes, tab names, link hosts), with token addresses masked. It goes to your clipboard, nowhere else.

## Development

```
manifest.json    extension manifest
shared.js        defaults and key tables, shared by the page script and the popup
content.js       everything on the page: keys, detection, Teach, debug info
background.js    opens website links in a new window (page scripts can't)
popup.*          settings, Teach rows and the Keys cheat sheet
test/            headless tests against mock Axiom pages
```

After editing, click the reload icon on the extension card, then reload the Axiom tab.

### Tests

The tests load the extension in headless Chromium and drive it against mock pages: Pulse (`test/mock-pulse.html`), trade page (`test/mock-trade.html`) and chart (`test/mock-chart.html`).

```sh
cd test
npm install
CHROME=/path/to/chrome npm test
```

- `STOP_AT=<section text>` stops at a section.
- `DEBUG_NAV=1` logs page navigations.

The mocks are approximations of Axiom's real pages. If Axiom changes its layout, detection can break before the tests notice; Teach is the fallback.
