/**
 * Boot.
 *
 * The order matters and it is not the obvious one: the menu is painted FIRST,
 * before three or the engine are touched, and the heavy work only starts once
 * the player has committed to a mode. Two reasons. A cold free-tier dyno takes
 * the better part of a minute to answer, and the first thing a visitor should
 * see is the game's face, not a black canvas. And the mode decides how the
 * engine is built: quality, whether a relay connection is opened at all, how
 * many bots the garrison holds.
 *
 * Registration order below is irrelevant — Registry topologically sorts on
 * static deps. It is written in dependency order anyway, because a human
 * reading it should not have to run the sorter in their head.
 */

import { Engine } from './core/engine.js';
import { createConfig } from './core/config.js';

import { RenderSystem } from './render/index.js';
import { MaterialSystem } from './materials/index.js';
import { SkySystem } from './sky/index.js';
import { WorldSystem } from './world/index.js';
import { PhysicsSystem } from './physics/index.js';
import { PlayerSystem } from './player/index.js';
import { WeaponSystem } from './weapons/index.js';
import { FxSystem } from './fx/index.js';
import { AiSystem } from './ai/index.js';
import { UiSystem } from './ui/index.js';
import { AudioSystem } from './audio/index.js';

import { ModesSystem } from './modes/index.js';
import { NetSystem, defaultSocketUrl } from './net/index.js';
import { ShellSystem } from './shell/index.js';
import { ModeMenu, MatchResults } from './shell/menu.js';

import { installShotApi } from './dev/shots.js';
import { prewarm } from './core/prewarm.js';

const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
// Deterministic shutter for the pixel gate: the engine does not schedule its own
// frames, the driver advances exactly N of them through window.__PUMP__.
const lockstep = capture && params.get('lockstep') === '1';

/**
 * The pixel gate must never sit in front of a menu waiting for a click, so a
 * capture run answers the menu itself from the query string.
 */
async function askPlayer() {
  if (capture) {
    return {
      mode: params.get('mode') ?? 'bots',
      submode: params.get('submode') ?? 'ctf',
      difficulty: params.get('difficulty') ?? 'normal',
      quality: params.get('q') ?? 'ultra',
      nickname: '',
      menu: null,
    };
  }
  const menu = new ModeMenu({ quality: params.get('q') ?? 'auto' });
  const choice = await menu.choose();
  return { ...choice, menu };
}

/** 'auto' is a menu word, not an engine word: pick a tier from the hardware. */
function resolveQuality(name) {
  if (name !== 'auto') return name;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  if (coarse || cores <= 4) return 'low';
  return cores >= 8 ? 'ultra' : 'medium';
}

const choice = await askPlayer();

const config = createConfig({
  quality: resolveQuality(choice.quality),
  deterministic: capture,
});

const canvas = document.getElementById('game');
const engine = new Engine({ canvas, config });

engine
  .add(RenderSystem)
  .add(MaterialSystem)
  .add(SkySystem)
  .add(WorldSystem)
  .add(PhysicsSystem)
  .add(PlayerSystem)
  .add(WeaponSystem)
  .add(FxSystem)
  .add(AiSystem)
  .add(UiSystem)
  .add(ModesSystem)
  .add(NetSystem)
  .add(ShellSystem)
  .add(AudioSystem);

// Both of these must be told what kind of match this is BEFORE init(): modes
// sizes the garrison during init, and net decides there whether to open a socket.
engine.registry.get(ModesSystem.id).configure({
  mode: choice.mode,
  submode: choice.submode,
  difficulty: choice.difficulty,
});
engine.registry.get(NetSystem.id).configure({
  url: params.get('relay') ?? defaultSocketUrl(),
  nickname: choice.nickname,
  mode: choice.mode,
});

try {
  await engine.init();
} catch (err) {
  console.error('[boot] init failed', err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;inset:0;padding:2rem;color:#f66;background:#000;
       font:12px/1.5 ui-monospace,monospace;overflow:auto;z-index:9999;white-space:pre-wrap">
BOOT FAILURE\n\n${err.stack ?? err.message}</pre>`
  );
  throw err;
}

const shotApi = installShotApi(engine, { capture, lockstep });

// Compile every shader permutation before the frame loop starts. Without this,
// 86 programs compile lazily during play, up to 30 on one frame, producing
// 3.1-3.9 SECOND stalls. Opt out with `?prewarm=0`. Proven pixel-neutral.
const warmup = params.get('prewarm') === '0' ? { ok: false, reason: 'disabled by ?prewarm=0' } : await prewarm(engine);
console.info('[boot] prewarm', warmup);
window.__PREWARM__ = warmup;

engine.start();

// The results card is driven by the match snapshot, so one handler covers all
// three modes. Restarting means reloading with the same choice in the query
// string: tearing a live match down in place leaves stale agents in the scene.
const results = new MatchResults(() => {
  const q = new URLSearchParams({ mode: choice.mode, submode: choice.submode, difficulty: choice.difficulty, q: choice.quality });
  location.search = `?${q}`;
});
engine.events.on('modes:over', (snapshot) => results.show(snapshot));

// Capture harness handshake: only flag ready once a frame has actually landed.
const BOOT_FRAMES = 3;
if (lockstep) {
  await shotApi.pump(BOOT_FRAMES);
  window.__READY__ = true;
} else {
  let warm = 0;
  const readyProbe = () => {
    if (++warm >= BOOT_FRAMES) {
      window.__READY__ = true;
      choice.menu?.dismiss();
      return;
    }
    requestAnimationFrame(readyProbe);
  };
  requestAnimationFrame(readyProbe);
}

window.__ENGINE__ = engine;

if (import.meta.hot) {
  import.meta.hot.dispose(() => engine.dispose());
}
