// config.js — every tuning constant lives here, in one place.
// The simulation reads only this module for numbers, so balance changes
// never require hunting through gameplay code.

export const SIM_DT = 1 / 60; // fixed simulation step (seconds)

// Map: x east, z south, y up. Playable area x in [-32, 32], z in [-22, 22].
export const MAP = {
  halfX: 32,
  halfZ: 22,
  cell: 2, // nav-grid cell size (metres)
  wallHeight: 4,
};

export const TEAMS = { CT: 'CT', T: 'T' };
export const TEAM_NAME = { CT: 'Wardens', T: 'Raiders' };
export const TEAM_COLOR = { CT: 0x3a7bd5, T: 0xd5543a };
export const TEAM_SPAWNS = {
  CT: [[-28, -6], [-28, 0], [-28, 6], [-26, -10], [-26, 10]],
  T: [[28, -6], [28, 0], [28, 6], [26, -10], [26, 10]],
};

// Bomb sites (centre x/z, radius in metres).
export const SITES = {
  A: { x: 22, z: -15, r: 6.5 },
  B: { x: 22, z: 15, r: 6.5 },
};

// Named waypoints bots route between (x, z).
export const WAYPOINTS = {
  aLong: [4, -16],
  aSite: [22, -15],
  bTunnel: [4, 16],
  bSite: [22, 15],
  mid: [0, 0],
  midDoor: [6, 0],
  ctMid: [-14, 0],
  tMid: [14, 0],
  aConnector: [6, -12],
  bConnector: [6, 12],
  ctSpawn: [-28, 0],
  tSpawn: [28, 0],
};

export const ROUND = {
  freeze: 5, // buy / positioning time at round start
  duration: 100, // round clock (seconds)
  plantTime: 4, // seconds to plant the bomb
  defuseTime: 5, // seconds to defuse
  fuse: 35, // bomb fuse after planting
  intermission: 4, // pause between rounds
  winRounds: 5, // first to this many rounds takes the match
  maxRounds: 9,
};

export const ECONOMY = {
  start: 1600, // enough for a rifle in round 1; sniper and grenades stay earned
  kill: 300,
  win: 1400,
  loss: 800,
  prices: { rifle: 1500, sniper: 2500, pistol: 300, grenade: 400, ammo: 200 },
};

// Weapons. spread is the base half-angle in degrees; recoil is the camera
// pitch kick in degrees per shot; damage falls off past falloff metres.
export const WEAPONS = {
  rifle: {
    id: 'rifle', name: 'VK-47', auto: true, rpm: 600,
    mag: 30, reserve: 90, damage: 30, headMul: 3.0,
    spread: 0.55, spreadPerShot: 0.28, spreadMax: 3.4,
    recoil: 0.55, reload: 2.2, range: 60, falloff: 28,
    price: 1500, zoom: 1.35, moveSpeed: 5.0,
  },
  sniper: {
    id: 'sniper', name: 'LONGSHOT', auto: false, rpm: 48,
    mag: 5, reserve: 15, damage: 110, headMul: 2.0,
    spread: 2.8, spreadPerShot: 2.0, spreadMax: 4.5,
    recoil: 2.4, reload: 3.0, range: 120, falloff: 60,
    price: 2500, zoom: 2.6, moveSpeed: 4.4,
  },
  pistol: {
    id: 'pistol', name: 'P9', auto: false, rpm: 350,
    mag: 12, reserve: 48, damage: 26, headMul: 2.7,
    spread: 0.7, spreadPerShot: 0.35, spreadMax: 2.8,
    recoil: 0.4, reload: 1.6, range: 40, falloff: 18,
    price: 300, zoom: 1.2, moveSpeed: 5.4,
  },
};

export const GRENADE = {
  id: 'grenade', name: 'FRAG', price: 400,
  fuse: 1.2, radius: 6, damage: 90, throwSpeed: 16,
};

export const PLAYER = {
  radius: 0.4,
  eyeStand: 1.62,
  eyeCrouch: 1.08,
  health: 100,
  accel: 42,
  friction: 10,
  crouchMul: 0.55,
  adsMul: 0.62,
  fov: 75,
};

export const BOT = {
  radius: 0.4,
  eyeHeight: 1.55,
  health: 100,
  speed: 4.2,
  // Perception: vision cone half-angle and range, hearing radius.
  visionHalfAngle: 55, // degrees
  visionRange: 42,
  hearRadius: 26,
  // Aim error in degrees: base + per-metre + target-speed terms.
  aimBase: 2.2,
  aimPerMetre: 0.045,
  aimTargetSpeed: 0.9,
  reactionMin: 0.25,
  reactionMax: 0.55,
  burstMin: 3,
  burstMax: 5,
};
