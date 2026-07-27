/**
 * ARSENAL — attachments.
 *
 * Pure data + pure functions, deliberately free of any three.js import so the
 * whole attachment layer can be unit-tested in node without a GPU or a DOM.
 * The geometry that realises these entries lives in `models/hardware.js`; this
 * file only answers three questions:
 *
 *   1. can this attachment go on this weapon?              -> canMount()
 *   2. what does the weapon feel like once it is on?       -> resolveStats()
 *   3. what does the gunsmith board need to draw?          -> SLOT_ORDER/CATALOG
 *
 * Modifier convention: `mul.<stat>` multiplies, `add.<stat>` adds. Anything not
 * mentioned is untouched. Modifiers compose in SLOT_ORDER so the result is
 * deterministic regardless of the order the player clicked things.
 */

/** Physical mounting points, resolved in this order. */
export const SLOT_ORDER = ['optic', 'muzzle', 'tactical', 'underbarrel', 'magazine'];

export const SLOT_LABELS = {
  optic: 'Прицел',
  muzzle: 'Дульное',
  tactical: 'Тактическое',
  underbarrel: 'Под стволом',
  magazine: 'Магазин',
};

/**
 * `fits` is a predicate over the weapon def; `null` means "anything with the
 * slot". `zoom` is the ADS FOV scale the optic forces (overrides the weapon's
 * own `adsFov`), `relief` shifts the eye-relief so the glass lands right.
 */
export const ATTACHMENTS = {
  /* ------------------------------------------------------------- optics */
  iron: {
    id: 'iron',
    slot: 'optic',
    label: 'Открытые',
    labelLatin: 'Iron sights',
    note: 'Штатные механические. Самый быстрый выход в прицеливание.',
    detachable: false,
    kind: 'irons',
    mass: 0,
    mul: {},
    add: {},
  },
  reddot: {
    id: 'reddot',
    slot: 'optic',
    label: 'Коллиматор',
    labelLatin: 'Red dot',
    note: 'Точка 1×. Ставит чистый обзор в ближнем бою.',
    detachable: true,
    kind: 'reflex',
    zoom: 0.78,
    relief: 0.006,
    mass: 0.14,
    mul: { adsTime: 1.04, spreadAds: 0.9 },
    add: {},
  },
  holo: {
    id: 'holo',
    slot: 'optic',
    label: 'Голографический',
    labelLatin: 'Holographic',
    note: 'Открытое окно, кольцо с точкой. Шире обзор, чем у коллиматора.',
    detachable: true,
    kind: 'holo',
    zoom: 0.74,
    relief: 0.01,
    mass: 0.2,
    mul: { adsTime: 1.07, spreadAds: 0.86 },
    add: {},
  },
  scope3x: {
    id: 'scope3x',
    slot: 'optic',
    label: 'Прицел 3×',
    labelLatin: '3x scope',
    note: 'Призматический. Средняя дистанция, виньетка по краю.',
    detachable: true,
    kind: 'scope',
    zoom: 0.42,
    relief: -0.012,
    mass: 0.42,
    mul: { adsTime: 1.22, spreadAds: 0.62, swayScale: 1.12 },
    add: {},
  },
  pso4x: {
    id: 'pso4x',
    slot: 'optic',
    label: 'ПСО-1 4×',
    labelLatin: 'PSO-1 4x',
    note: 'Шевронная сетка с дальномером. Только для бокового кронштейна.',
    detachable: true,
    kind: 'scope',
    zoom: 0.3,
    relief: -0.02,
    mass: 0.58,
    fits: (def) => def.family === 'ak' || def.family === 'svd',
    mul: { adsTime: 1.32, spreadAds: 0.5, swayScale: 1.2 },
    add: {},
  },

  /* ------------------------------------------------------------- muzzle */
  brake: {
    id: 'brake',
    slot: 'muzzle',
    label: 'ДТК',
    labelLatin: 'Muzzle brake',
    note: 'Гасит подброс, но громче и ярче вспышка.',
    detachable: true,
    kind: 'brake',
    mass: 0.11,
    mul: { recoilPitch: 0.82, recoilYaw: 0.88, flashScale: 1.35, loudness: 1.15 },
    add: {},
  },
  comp: {
    id: 'comp',
    slot: 'muzzle',
    label: 'Компенсатор',
    labelLatin: 'Compensator',
    note: 'Ровный горизонт при автоматическом огне.',
    detachable: true,
    kind: 'comp',
    mass: 0.1,
    mul: { recoilYaw: 0.72, spreadPerShot: 0.9, flashScale: 1.15 },
    add: {},
  },
  suppressor: {
    id: 'suppressor',
    slot: 'muzzle',
    label: 'Глушитель',
    labelLatin: 'Suppressor',
    note: 'Снимает вспышку и убирает выстрел с радара врага. Минус скорость пули.',
    detachable: true,
    kind: 'suppressor',
    mass: 0.45,
    /** Suppressed shots do not put the shooter on the enemy minimap. */
    silent: true,
    mul: {
      recoilPitch: 0.9,
      muzzleVelocity: 0.96,
      damage: 0.96,
      flashScale: 0.12,
      loudness: 0.35,
      adsTime: 1.06,
    },
    add: {},
  },

  /* ---------------------------------------------------------- tactical */
  laser: {
    id: 'laser',
    slot: 'tactical',
    label: 'Лазер',
    labelLatin: 'Laser',
    note: 'Луч и точка на цели. Сужает разброс без прицеливания — и выдаёт вас.',
    detachable: true,
    kind: 'laser',
    mass: 0.08,
    toggleKey: 'KeyL',
    /** FPS Arena: hip spread ×0.72 with the laser lit. */
    mul: { spreadHip: 0.72 },
    add: {},
  },
  flashlight: {
    id: 'flashlight',
    slot: 'tactical',
    label: 'Фонарь',
    labelLatin: 'Flashlight',
    note: 'Узкий конус света по стволу. Видно всем.',
    detachable: true,
    kind: 'light',
    mass: 0.13,
    toggleKey: 'KeyF',
    light: { intensity: 6.5, distance: 42, angle: 0.34, penumbra: 0.45, colour: 0xfff2d8 },
    mul: {},
    add: {},
  },
  lasertac: {
    id: 'lasertac',
    slot: 'tactical',
    label: 'Блок лазер+свет',
    labelLatin: 'Laser/light box',
    note: 'Два в одном, тяжелее каждого по отдельности.',
    detachable: true,
    kind: 'combo',
    mass: 0.19,
    light: { intensity: 5.6, distance: 36, angle: 0.31, penumbra: 0.5, colour: 0xffeccd },
    mul: { spreadHip: 0.76, adsTime: 1.03 },
    add: {},
  },

  /* ------------------------------------------------------- underbarrel */
  foregrip: {
    id: 'foregrip',
    slot: 'underbarrel',
    label: 'Передняя рукоять',
    labelLatin: 'Foregrip',
    note: 'Держит ствол внизу на длинной очереди.',
    detachable: true,
    kind: 'foregrip',
    mass: 0.14,
    fits: (def) => def.class !== 'pistol',
    mul: { recoilPitch: 0.85, spreadPerShot: 0.88, adsTime: 1.04 },
    add: {},
  },
  bipod: {
    id: 'bipod',
    slot: 'underbarrel',
    label: 'Сошки',
    labelLatin: 'Bipod',
    note: 'Работают лежа или с упора. Мешают в беге.',
    detachable: true,
    kind: 'bipod',
    mass: 0.31,
    fits: (def) => def.class === 'dmr' || def.class === 'rifle',
    /** Deployed bonus is applied separately by the arsenal system. */
    deployed: { mul: { recoilPitch: 0.42, spreadAds: 0.55, swayScale: 0.3 } },
    mul: { adsTime: 1.08, swayScale: 1.04 },
    add: {},
  },

  /* ---------------------------------------------------------- magazine */
  magStandard: {
    id: 'magStandard',
    slot: 'magazine',
    label: 'Штатный магазин',
    labelLatin: 'Standard mag',
    detachable: false,
    kind: 'mag',
    mass: 0,
    mul: {},
    add: {},
  },
  magExtended: {
    id: 'magExtended',
    slot: 'magazine',
    label: 'Увеличенный магазин',
    labelLatin: 'Extended mag',
    note: '+40% боекомплекта, дольше перезарядка.',
    detachable: true,
    kind: 'mag',
    mass: 0.16,
    mul: { magSize: 1.4, reloadTac: 1.14, reloadEmpty: 1.12, magLen: 1.34 },
    add: {},
  },
  magQuick: {
    id: 'magQuick',
    slot: 'magazine',
    label: 'Быстрый магазин',
    labelLatin: 'Quickdraw mag',
    note: 'Скотч и петля: перезарядка быстрее на четверть.',
    detachable: true,
    kind: 'mag',
    mass: 0.03,
    mul: { reloadTac: 0.76, reloadEmpty: 0.8 },
    add: {},
  },
};

/** Attachment ids grouped by slot, in board order. */
export const BY_SLOT = SLOT_ORDER.reduce((acc, slot) => {
  acc[slot] = Object.keys(ATTACHMENTS).filter((id) => ATTACHMENTS[id].slot === slot);
  return acc;
}, {});

/** Stats that a modifier is allowed to touch. Anything else is a typo. */
export const MODIFIABLE = new Set([
  'adsTime',
  'spreadHip',
  'spreadAds',
  'spreadPerShot',
  'spreadMax',
  'swayScale',
  'bobScale',
  'recoilPitch',
  'recoilYaw',
  'muzzleVelocity',
  'damage',
  'magSize',
  'reloadTac',
  'reloadEmpty',
  'magLen',
  'flashScale',
  'loudness',
  'drawTime',
  'holsterTime',
]);

/**
 * Can `attId` be mounted on `def`?
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canMount(def, attId) {
  const att = ATTACHMENTS[attId];
  if (!att) return { ok: false, reason: 'unknown attachment' };
  if (!def.mounts || !def.mounts.includes(att.slot)) {
    return { ok: false, reason: `${def.label}: нет крепления «${SLOT_LABELS[att.slot]}»` };
  }
  if (att.fits && !att.fits(def)) {
    return { ok: false, reason: `${att.label} не встаёт на ${def.label}` };
  }
  return { ok: true };
}

/** The loadout a weapon starts with: irons, standard mag, nothing else. */
export function defaultLoadout(def) {
  const out = {};
  if (def.mounts?.includes('optic')) out.optic = def.defaultOptic ?? 'iron';
  if (def.mounts?.includes('magazine')) out.magazine = 'magStandard';
  return out;
}

/**
 * Fold a loadout into a flat stat block.
 *
 * @param {object} def weapon definition from ARSENAL_DEFS
 * @param {Record<string,string|null>} loadout slot -> attachment id
 * @param {{ bipodDeployed?: boolean, laserOn?: boolean }} [runtime]
 * @returns {object} a NEW object: def fields plus resolved numbers, plus
 *   `attachments` (the validated loadout) and `flags`.
 */
export function resolveStats(def, loadout = {}, runtime = {}) {
  const s = {
    ...def,
    recoilPitch: def.recoil.pitch,
    recoilYaw: def.recoil.yaw,
    flashScale: 1,
    loudness: 1,
    zoom: def.adsFov,
    relief: def.eyeRelief,
    silent: false,
    hasLight: false,
    hasLaser: false,
    light: null,
    attachments: {},
    rejected: [],
  };

  for (const slot of SLOT_ORDER) {
    const id = loadout[slot];
    if (!id) continue;
    const att = ATTACHMENTS[id];
    const check = canMount(def, id);
    if (!check.ok) {
      s.rejected.push({ id, reason: check.reason });
      continue;
    }
    s.attachments[slot] = id;

    const mods = [att.mul ?? {}];
    const adds = [att.add ?? {}];
    if (att.kind === 'bipod' && runtime.bipodDeployed && att.deployed) {
      mods.push(att.deployed.mul ?? {});
      adds.push(att.deployed.add ?? {});
    }
    for (const mul of mods) {
      for (const key of Object.keys(mul)) {
        if (!MODIFIABLE.has(key)) throw new Error(`${id}: mul.${key} is not a modifiable stat`);
        s[key] = s[key] * mul[key];
      }
    }
    for (const add of adds) {
      for (const key of Object.keys(add)) {
        if (!MODIFIABLE.has(key)) throw new Error(`${id}: add.${key} is not a modifiable stat`);
        s[key] = s[key] + add[key];
      }
    }

    if (att.slot === 'optic') {
      if (att.zoom !== undefined) s.zoom = att.zoom;
      if (att.relief !== undefined) s.relief = def.eyeRelief + att.relief;
      s.opticKind = att.kind;
    }
    if (att.silent) s.silent = true;
    if (att.light) {
      s.hasLight = true;
      s.light = att.light;
    }
    if (att.kind === 'laser' || att.kind === 'combo') s.hasLaser = true;
    s.weight = s.weight + (att.mass ?? 0);
  }

  // The laser only tightens hip spread while it is actually lit.
  if (s.hasLaser && runtime.laserOn === false) {
    const att = ATTACHMENTS[s.attachments.tactical];
    if (att?.mul?.spreadHip) s.spreadHip = s.spreadHip / att.mul.spreadHip;
  }

  s.magSize = Math.round(s.magSize);
  s.cycleTime = 60 / def.rpm;
  // Heavier guns aim slower: 1% per 100 g over the bare weapon.
  s.adsTime = s.adsTime * (1 + (s.weight - def.weight) * 0.1);
  return s;
}

/**
 * Cycle the optic on a weapon (FPS Arena's B key), skipping optics that do not
 * fit and any the player has not unlocked.
 *
 * @param {object} def
 * @param {string} current
 * @param {Set<string>|null} owned null == everything unlocked
 */
export function nextOptic(def, current, owned = null) {
  const ring = BY_SLOT.optic.filter((id) => {
    if (!canMount(def, id).ok) return false;
    if (id === 'iron') return true;
    return owned ? owned.has(id) : true;
  });
  if (!ring.length) return current;
  const i = ring.indexOf(current);
  return ring[(i + 1) % ring.length];
}

/**
 * Human-readable delta between the bare weapon and a loadout, for the board.
 * @returns {Array<{ stat: string, label: string, from: number, to: number, better: boolean }>}
 */
export function statDelta(def, loadout) {
  const base = resolveStats(def, defaultLoadout(def));
  const now = resolveStats(def, loadout);
  const rows = [
    ['damage', 'Урон', true],
    ['adsTime', 'Выход в прицел', false],
    ['spreadHip', 'Разброс от бедра', false],
    ['spreadAds', 'Разброс в прицеле', false],
    ['recoilPitch', 'Отдача вверх', false],
    ['recoilYaw', 'Увод в сторону', false],
    ['magSize', 'Магазин', true],
    ['reloadTac', 'Перезарядка', false],
    ['muzzleVelocity', 'Скорость пули', true],
    ['weight', 'Вес', false],
  ];
  const out = [];
  for (const [stat, label, upIsGood] of rows) {
    const from = base[stat];
    const to = now[stat];
    if (Math.abs(to - from) < 1e-6) continue;
    out.push({ stat, label, from, to, better: upIsGood ? to > from : to < from });
  }
  return out;
}
