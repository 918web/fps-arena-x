import { FONT_STACK, FONT_DISPLAY, FONT_MONO } from '../ui/util.js';

/**
 * Gunsmith board stylesheet.
 *
 * Deliberately NOT a second design system. It reuses the HUD's scaling trick
 * (every dimension is calc(N * var(--k)), --k driven from viewport height) and
 * the FPS Arena menu palette, so the board reads as the same product as the
 * mode-select screen rather than a bolted-on settings dialog.
 *
 * Two rules held here on purpose:
 *  - No CSS transitions on anything the gate measures. Hover states may
 *    transition (they are cosmetic and never captured); every value that
 *    depends on game state is written from update() so capture frames stay
 *    deterministic.
 *  - No blur backdrops. A frosted panel is the default "web app" tell and it
 *    costs a full-screen filter pass; this uses opaque panels with a hairline
 *    and a single grain layer instead.
 */

const CSS = `
.fa-gs, .fa-gs * { margin:0; padding:0; box-sizing:border-box; }

.fa-gs {
  --k: 1;
  --u: calc(4px * var(--k));

  --bg:      #0b0e13;
  --bg-2:    #0f141c;
  --panel:   #131922;
  --panel-2: #0e131b;
  --line:        rgba(150,170,200,.10);
  --line-strong: rgba(160,180,210,.20);
  --ink:   #eef2f7;
  --muted: #93a1b4;
  --faint: #5f6b7d;

  --pick:  #f5a524;
  --warn:  #ff5145;
  --good:  #2dd4bf;

  --ease-out: cubic-bezier(.22,1,.36,1);

  --ff: ${FONT_STACK};
  --fd: ${FONT_DISPLAY};
  --fm: ${FONT_MONO};

  position:fixed; inset:0; z-index:40;
  display:grid;
  grid-template-rows: auto 1fr auto;
  background:
    radial-gradient(120% 90% at 50% 0%, var(--bg-2) 0%, var(--bg) 62%);
  color:var(--ink);
  font-family:var(--ff);
  font-weight:600;
  letter-spacing:.06em;
  text-transform:uppercase;
  font-variant-numeric:tabular-nums;
  -webkit-font-smoothing:antialiased;
  user-select:none;
  cursor:default;
  overflow:hidden;
}

/* 46px grid + grain: the same two texture layers as the mode-select screen. */
.fa-gs::before {
  content:''; position:absolute; inset:0; pointer-events:none;
  background-image:
    linear-gradient(to right, rgba(120,140,170,.035) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(120,140,170,.035) 1px, transparent 1px);
  background-size: calc(46px * var(--k)) calc(46px * var(--k));
}
.fa-gs::after {
  content:''; position:absolute; inset:0; pointer-events:none;
  opacity:.045;
  background-image:var(--fa-grain);
  background-size: calc(180px * var(--k)) calc(180px * var(--k));
}

/* ------------------------------------------------------------------ head */
.fa-gs .head {
  display:flex; align-items:flex-end; justify-content:space-between;
  gap:calc(var(--u) * 6);
  padding:calc(var(--u) * 7) calc(var(--u) * 9) calc(var(--u) * 4);
  border-bottom:1px solid var(--line);
}
.fa-gs .eyebrow {
  font-size:calc(11px * var(--k));
  letter-spacing:.32em;
  color:var(--faint);
}
.fa-gs h2 {
  font-family:var(--fd);
  font-size:calc(34px * var(--k));
  font-weight:800;
  letter-spacing:.05em;
  line-height:1;
  margin-top:calc(var(--u) * 1.5);
}
.fa-gs .head .hint { font-size:calc(11px * var(--k)); color:var(--faint); letter-spacing:.22em; }

/* ------------------------------------------------------------------ body */
.fa-gs .body {
  display:grid;
  grid-template-columns: calc(210px * var(--k)) 1fr calc(300px * var(--k));
  gap:calc(var(--u) * 4);
  padding:calc(var(--u) * 4) calc(var(--u) * 9);
  min-height:0;
}
.fa-gs .col { display:flex; flex-direction:column; min-height:0; gap:calc(var(--u) * 2); }
.fa-gs .col-title {
  font-size:calc(10.5px * var(--k));
  letter-spacing:.26em;
  color:var(--faint);
  padding-bottom:calc(var(--u) * 1.5);
  border-bottom:1px solid var(--line);
}
.fa-gs .scroll { overflow-y:auto; min-height:0; scrollbar-width:thin; }

/* weapon rack ------------------------------------------------------------ */
.fa-gs .rack-item {
  display:flex; align-items:baseline; justify-content:space-between;
  gap:var(--u);
  padding:calc(var(--u) * 2) calc(var(--u) * 2.5);
  border:1px solid transparent;
  border-left:calc(2px * var(--k)) solid var(--line-strong);
  background:var(--panel-2);
  color:var(--muted);
  font-size:calc(12.5px * var(--k));
  text-align:left;
  font-family:inherit; font-weight:600; letter-spacing:.08em;
  text-transform:uppercase;
  cursor:pointer;
}
.fa-gs .rack-item:hover { color:var(--ink); background:var(--panel); }
.fa-gs .rack-item .kl { font-size:calc(9.5px * var(--k)); color:var(--faint); letter-spacing:.2em; }
.fa-gs .rack-item.on {
  color:var(--ink);
  background:var(--panel);
  border-left-color:var(--pick);
}

/* ---- centre: the gun sits in a real 3D viewport, not a sprite ---------- */
.fa-gs .stage { position:relative; border:1px solid var(--line); background:transparent; min-height:0; }
.fa-gs .stage .plate {
  position:absolute; left:calc(var(--u) * 3); bottom:calc(var(--u) * 3);
  display:flex; flex-direction:column; gap:calc(var(--u) * .5);
}
.fa-gs .stage .name { font-family:var(--fd); font-size:calc(26px * var(--k)); letter-spacing:.04em; }
.fa-gs .stage .sub { font-size:calc(10.5px * var(--k)); color:var(--faint); letter-spacing:.22em; }
.fa-gs .stage .spin {
  position:absolute; right:calc(var(--u) * 3); bottom:calc(var(--u) * 3);
  font-size:calc(10px * var(--k)); color:var(--faint); letter-spacing:.2em;
}
.fa-gs .stage .warn {
  position:absolute; left:calc(var(--u) * 3); top:calc(var(--u) * 3);
  max-width:60%;
  font-size:calc(10.5px * var(--k));
  color:var(--warn); letter-spacing:.14em; line-height:1.5;
}

/* slots + attachment list ------------------------------------------------ */
.fa-gs .slot-tabs { display:flex; flex-wrap:wrap; gap:calc(var(--u) * 1); }
.fa-gs .slot-tab {
  flex:1 1 auto;
  padding:calc(var(--u) * 1.5) calc(var(--u) * 1.5);
  border:1px solid var(--line);
  background:var(--panel-2);
  color:var(--muted);
  font-family:inherit; font-weight:700;
  font-size:calc(10px * var(--k)); letter-spacing:.18em;
  text-transform:uppercase; cursor:pointer;
}
.fa-gs .slot-tab.on { color:var(--bg); background:var(--ink); border-color:var(--ink); }
.fa-gs .slot-tab.filled:not(.on) { color:var(--ink); border-color:var(--line-strong); }

.fa-gs .att {
  display:block; width:100%; text-align:left;
  padding:calc(var(--u) * 2) calc(var(--u) * 2.5);
  margin-bottom:calc(var(--u) * 1);
  border:1px solid var(--line);
  background:var(--panel-2);
  color:var(--muted);
  font-family:inherit; font-weight:600;
  font-size:calc(12px * var(--k)); letter-spacing:.08em;
  text-transform:uppercase; cursor:pointer;
}
.fa-gs .att:hover:not(.locked) { color:var(--ink); background:var(--panel); }
.fa-gs .att.on { color:var(--ink); background:var(--panel); border-color:var(--pick); }
.fa-gs .att.locked { cursor:not-allowed; opacity:.4; }
.fa-gs .att .note {
  display:block; margin-top:calc(var(--u) * .75);
  font-size:calc(10px * var(--k)); font-weight:500;
  letter-spacing:.06em; text-transform:none; color:var(--faint); line-height:1.45;
}
.fa-gs .att .why { color:var(--warn); }

/* stat deltas ------------------------------------------------------------ */
.fa-gs .stat { display:grid; grid-template-columns:1fr auto; gap:var(--u); align-items:baseline; padding:calc(var(--u) * 1) 0; }
.fa-gs .stat .sl { font-size:calc(10.5px * var(--k)); color:var(--muted); letter-spacing:.14em; }
.fa-gs .stat .sv { font-family:var(--fm); font-size:calc(11px * var(--k)); letter-spacing:.04em; }
.fa-gs .stat .sv.up { color:var(--good); }
.fa-gs .stat .sv.down { color:var(--warn); }
.fa-gs .bar { grid-column:1 / -1; height:calc(2px * var(--k)); background:var(--line); position:relative; }
.fa-gs .bar i { position:absolute; inset:0 auto 0 0; background:var(--muted); }
.fa-gs .bar i.up { background:var(--good); }
.fa-gs .bar i.down { background:var(--warn); }
.fa-gs .stat-empty { font-size:calc(10.5px * var(--k)); color:var(--faint); letter-spacing:.14em; line-height:1.6; text-transform:none; }

/* ------------------------------------------------------------------ foot */
.fa-gs .foot {
  display:flex; align-items:center; justify-content:space-between;
  gap:calc(var(--u) * 4);
  padding:calc(var(--u) * 3.5) calc(var(--u) * 9) calc(var(--u) * 5);
  border-top:1px solid var(--line);
}
.fa-gs .keys { display:flex; gap:calc(var(--u) * 4); font-size:calc(10px * var(--k)); color:var(--faint); letter-spacing:.2em; }
.fa-gs .keys b { color:var(--muted); font-weight:700; }
.fa-gs .acts { display:flex; gap:calc(var(--u) * 2); }
.fa-gs .btn {
  padding:calc(var(--u) * 2.5) calc(var(--u) * 6);
  border:1px solid var(--line-strong);
  background:transparent; color:var(--ink);
  font-family:inherit; font-weight:700;
  font-size:calc(11.5px * var(--k)); letter-spacing:.2em;
  text-transform:uppercase; cursor:pointer;
}
.fa-gs .btn:hover { border-color:var(--ink); }
.fa-gs .btn.primary { background:var(--pick); border-color:var(--pick); color:#140d00; }
.fa-gs .btn.primary:hover { filter:brightness(1.08); }

@media (prefers-reduced-motion: reduce) {
  .fa-gs * { transition:none !important; }
}
`;

/** One SVG turbulence tile, reused as the grain layer (same tile as the menu). */
const GRAIN =
  "url(\"data:image/svg+xml;utf8," +
  "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='3'/></filter>" +
  "<rect width='180' height='180' filter='url(%23n)' opacity='.6'/></svg>\")";

let styleNode = null;

export function installGunsmithStyles() {
  if (styleNode) return;
  styleNode = document.createElement('style');
  styleNode.id = 'fa-gunsmith-style';
  styleNode.textContent = CSS.replace('var(--fa-grain)', GRAIN);
  document.head.appendChild(styleNode);
}

export function removeGunsmithStyles() {
  styleNode?.remove();
  styleNode = null;
}
