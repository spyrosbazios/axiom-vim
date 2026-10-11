# Axiom Vim

Vim-style keyboard shortcuts for [axiom.trade](https://axiom.trade). Move through Pulse with `hjkl`, open and hide coins, scroll holders, preview X, zoom the chart and go back without touching the mouse.

A Chrome extension (Manifest V3). Unofficial: not made by or affiliated with Axiom.

- **Pulse:** `hjkl` moves between coins in the New Pairs / Final Stretch / Migrated columns and the side panels next to them, `Enter` opens one, `Shift+X` hides it.
- **Trade page:** `j`/`k` scroll the Holders list, hold `x` for the X preview, `z` zooms the chart out, `Shift+B` blacklists the dev and leaves.
- **Anywhere:** `Shift+H` / `Shift+L` go back / forward, like Vimium.
- **Layout-proof:** keys match the physical key, so they work on any keyboard layout (e.g. Greek).
- **Remappable:** every shortcut can be moved to any key in the popup's **Keys** section. The keys below are the defaults.

## Install

Axiom Vim isn't on the Chrome Web Store. You load it into your browser yourself, which takes about a minute.

It works in Chromium browsers: Chrome, Brave, Edge, Opera, Arc, Helium and others. It hasn't been tested in Firefox or Safari.

### 1. Get the code

**Option A: download a ZIP** (no git needed)

1. Download [axiom-vim-main.zip](https://github.com/spyrosbazios/axiom-vim/archive/refs/heads/main.zip). You can also click **Code → Download ZIP** at the top of this page.
2. Unzip it. You get a folder called `axiom-vim-main`.
3. Move that folder somewhere permanent, like your Documents folder. The browser loads the extension from this folder every time it starts, so don't delete it.

**Option B: clone with git**

```sh
git clone https://github.com/spyrosbazios/axiom-vim.git
```

### 2. Load it into your browser

1. Open your browser's extensions page by typing its address into the address bar:

   | Browser | Address |
   | --- | --- |
   | Chrome, Helium | `chrome://extensions` |
   | Brave | `brave://extensions` |
   | Edge | `edge://extensions` |
   | Opera | `opera://extensions` |

2. Turn on **Developer mode**. In Chrome it's a toggle at the top right; in Edge it's in the left sidebar.
3. Click **Load unpacked**.
4. Pick the folder from step 1: the one that contains `manifest.json`. That's `axiom-vim-main` for the ZIP or `axiom-vim` for git.
5. **Axiom Vim** appears in the list of extensions. Make sure its switch is on.

### 3. Pin it and check it works

1. Click the puzzle-piece icon in the toolbar, then the pin next to **Axiom Vim**. This keeps its popup one click away.
2. Reload any axiom.trade tabs you already had open. Tabs opened before the install don't get the shortcuts.
3. Open [Pulse](https://axiom.trade/pulse) and press `j`. A coin in Final Stretch gets a highlighted ring.
4. Click the extension icon and expand **Keys** to see every shortcut, or change one.

### Updating

- **ZIP:** download the new ZIP and replace the old folder's contents with the new ones, keeping the same folder.
- **git:** run `git pull` inside the folder.

Then open the extensions page, click the reload icon on the **Axiom Vim** card, and reload your Axiom tabs. Your settings and Teach rows are kept.

### Uninstalling

Click **Remove** on the **Axiom Vim** card on the extensions page, then delete the folder.

### If the keys do nothing

- **Reload the Axiom tab.** The page needs a reload after installing, updating or turning the extension back on.
- **Check the switches.** The extension must be on in the extensions page, and the block at the top left of its popup must say **NORMAL** (click it if it says **OFF**).
- **Click on the page first.** Keys go to whatever has focus. If you just clicked the address bar or a text box, click an empty part of the page.
- **"Pulse columns not found"** means Axiom renamed or moved its columns. Open an issue with the output of **Copy debug info** from the popup.
- **`h`/`l` skip a side panel?** Open an issue with **Copy debug info**. Its `sidePanels` part shows which panels and how many items were found.

## Keys

These are the defaults. Every one can be changed in the popup (see [Changing keys](#changing-keys)).

### Pulse

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous coin in the column |
| `h` / `l` | Previous / next column or side panel (lands on the item at the same height) |
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
- Side panels docked next to the columns (like the wallet tracker or Discover) are extra columns: `h` from New Pairs enters the left one, `l` from Migrated the right one. In a panel with two lists, `j` runs through both.
- `Enter` on a panel item clicks it like a mouse would. `Shift+X` works only on items with their own hide (eye) button.
- Floating panels, menus and dropdowns are never touched.

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
- The popup's **Vim keys** switch turns off moving, open and clear on Pulse, Holders scrolling, and back / forward, whatever keys they're on.

### Changing keys

1. Open the popup and expand **Keys**.
2. Click the key next to an action, then press the new key or combo (`Shift`, `Ctrl`, `Alt` work). `Esc` cancels.
3. The **↺** next to a row puts that one back; **Reset all keys** puts them all back.

- If two actions end up on the same key on the same page, both are marked in orange. The one listed first wins.
- `Space` can't be used: while it's held, keys go to Axiom for its own Space+key hotkeys.
- Keys are stored by physical position, like the defaults, so they keep working when you switch keyboard layout.

## Popup

| Setting | What it does |
| --- | --- |
| **NORMAL / OFF** (top left) | Click to turn every shortcut on or off |
| **Vim keys** | Turns the vim movement keys on or off (see above) |
| **Zoom out per press** | Wheel notches per zoom-out press, 1–20 |
| **Teach** rows | Point the extension at the right button when auto-detection misses |
| **Copy debug info** | Copies the page structure for a bug report |
| **Keys** | Every shortcut; click one to change it |

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
shared.js        defaults and the list of actions with their default keys, shared by the page script and the popup
content.js       everything on the page: keys, detection, Teach, debug info
background.js    opens website links in a new window (page scripts can't)
popup.*          settings, Teach rows and the Keys editor
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
