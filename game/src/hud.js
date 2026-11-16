// hud.js — the DOM HUD. Reads sim state every frame and writes the DOM.
// The HUD never writes gameplay state (except buy clicks, which go through
// rounds.buyItem). All numbers shown come from the sim, so the HUD and the
// game can never disagree.

import { WEAPONS, ROUND, ECONOMY, GRENADE, TEAM_NAME } from './config.js';
import { buyItem } from './rounds.js';

export function createHud(sim) {
  const $ = (id) => document.getElementById(id);
  const hud = {
    sim,
    els: {
      healthNum: $('health-num'),
      healthBar: $('health-bar'),
      ammoMag: $('ammo-mag'),
      ammoReserve: $('ammo-reserve'),
      weaponName: $('weapon-name'),
      money: $('money'),
      timer: $('timer'),
      roundNum: $('round-num'),
      scoreCt: $('score-ct'),
      scoreT: $('score-t'),
      bomb: $('bomb-status'),
      phase: $('phase-label'),
      killfeed: $('killfeed'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      vignette: $('damage-vignette'),
      dmgDir: $('damage-dir'),
      banner: $('banner'),
      bannerTitle: $('banner-title'),
      bannerSub: $('banner-sub'),
      buyMenu: $('buy-menu'),
      buyMoney: $('buy-money'),
      overlay: $('overlay'),
      endScreen: $('end-screen'),
      endTitle: $('end-title'),
      endScore: $('end-score'),
      scope: $('scope'),
      defuse: $('defuse-bar'),
      defuseFill: $('defuse-fill'),
      freezeHint: $('freeze-hint'),
    },
    lastEventIdx: 0,
    bannerUntil: 0,
    hitUntil: 0,
    buyOpen: false,
  };

  // Buy menu buttons.
  const buyButtons = document.querySelectorAll('#buy-menu [data-buy]');
  for (const btn of buyButtons) {
    btn.addEventListener('click', () => {
      if (buyItem(sim, btn.dataset.buy)) updateBuyButtons(hud);
    });
  }
  const closeBuy = $('buy-close');
  if (closeBuy) closeBuy.addEventListener('click', () => setBuyOpen(hud, false));
  return hud;
}

function fmtTime(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function updateBuyButtons(hud) {
  const p = hud.sim.player;
  const m = hud.sim.match;
  const set = (id, price, owned) => {
    const btn = document.querySelector(`#buy-menu [data-buy="${id}"]`);
    if (!btn) return;
    btn.disabled = owned || p.money < price || m.phase !== 'freeze';
    btn.querySelector('.price').textContent = owned ? 'OWNED' : `$${price}`;
  };
  set('rifle', ECONOMY.prices.rifle, !!p.weapons.rifle);
  set('sniper', ECONOMY.prices.sniper, !!p.weapons.sniper);
  set('pistol', ECONOMY.prices.pistol, !!p.weapons.pistol);
  set('grenade', GRENADE.price, p.grenades >= 1);
  set('ammo', ECONOMY.prices.ammo, false);
  if (hud.els.buyMoney) hud.els.buyMoney.textContent = `$${p.money}`;
}

export function setBuyOpen(hud, open) {
  const m = hud.sim.match;
  if (open && m.phase !== 'freeze') return;
  hud.buyOpen = open;
  if (hud.els.buyMenu) hud.els.buyMenu.hidden = !open;
  if (open) {
    updateBuyButtons(hud);
    document.exitPointerLock?.();
  }
}

export function showBanner(hud, title, sub, seconds = 3) {
  if (!hud.els.banner) return;
  hud.els.bannerTitle.textContent = title;
  hud.els.bannerSub.textContent = sub;
  hud.els.banner.hidden = false;
  hud.bannerUntil = performance.now() / 1000 + seconds;
}

function addKillfeed(hud, html) {
  const kf = hud.els.killfeed;
  if (!kf) return;
  const div = document.createElement('div');
  div.className = 'kf-item';
  div.innerHTML = html;
  kf.prepend(div);
  while (kf.children.length > 5) kf.removeChild(kf.lastChild);
}

export function updateHud(hud, now) {
  const sim = hud.sim;
  const p = sim.player;
  const m = sim.match;
  const els = hud.els;

  // --- Process new sim events (kill feed, banners, hitmarkers). ---
  for (let i = hud.lastEventIdx; i < sim.events.length; i++) {
    const e = sim.events[i];
    if (e.type === 'kill') {
      const a = e.attacker === 'You' ? 'You' : e.attacker;
      const color = e.victimTeam === 'T' ? 'var(--accent-t)' : 'var(--accent-ct)';
      addKillfeed(hud, `<b>${a}</b> <span>killed</span> <b style="color:${color}">${e.victim}</b>`);
    } else if (e.type === 'hit') {
      hud.hitUntil = now + (e.kill ? 0.35 : 0.15);
      if (els.hitmarker) els.hitmarker.classList.toggle('kill', !!e.kill);
    } else if (e.type === 'roundEnd') {
      const won = e.winner === 'CT';
      showBanner(hud, won ? 'ROUND WON' : 'ROUND LOST', e.reason, 6);
    } else if (e.type === 'playerDied') {
      showBanner(hud, 'YOU DIED', 'Spectate — the next round starts soon', 3);
    } else if (e.type === 'bombPlanted') {
      showBanner(hud, 'BOMB PLANTED', `Site ${e.site} — defuse it!`, 3);
    } else if (e.type === 'roundLive') {
      showBanner(hud, `ROUND ${m.round}`, 'Eliminate the Raiders or stop the bomb', 2.5);
    } else if (e.type === 'matchEnd') {
      if (els.endScreen) {
        els.endTitle.textContent = e.winner === 'CT' ? 'VICTORY' : 'DEFEAT';
        els.endScore.textContent = `${TEAM_NAME.CT} ${m.score.CT} — ${m.score.T} ${TEAM_NAME.T}`;
        els.endScreen.hidden = false;
      }
    }
  }
  hud.lastEventIdx = sim.events.length;

  // --- Health / ammo / money. ---
  if (els.healthNum) els.healthNum.textContent = Math.ceil(p.health);
  if (els.healthBar) els.healthBar.style.width = `${Math.max(0, p.health)}%`;
  const w = WEAPONS[p.weapon];
  const st = p.weapons[p.weapon];
  if (els.ammoMag) {
    els.ammoMag.textContent = st.reloading ? '--' : st.mag;
    els.ammoMag.parentElement.classList.toggle('empty', st.mag === 0);
  }
  if (els.ammoReserve) els.ammoReserve.textContent = `/ ${st.reserve}`;
  if (els.weaponName) els.weaponName.textContent = w.name + (st.reloading ? ' — RELOADING' : '');
  if (els.money) els.money.textContent = `$${p.money}`;

  // --- Timer / score / phase. ---
  if (els.timer) {
    if (m.phase === 'planted') {
      els.timer.textContent = fmtTime(sim.bomb.timer);
      els.timer.classList.add('danger');
    } else {
      els.timer.textContent = fmtTime(m.phaseTime);
      els.timer.classList.remove('danger');
    }
  }
  if (els.roundNum) els.roundNum.textContent = `ROUND ${m.round}/${ROUND.maxRounds}`;
  if (els.scoreCt) els.scoreCt.textContent = m.score.CT;
  if (els.scoreT) els.scoreT.textContent = m.score.T;
  if (els.phase) {
    els.phase.textContent =
      m.phase === 'freeze' ? 'BUY PHASE' :
      m.phase === 'live' ? 'ROUND LIVE' :
      m.phase === 'planted' ? 'BOMB PLANTED' :
      m.phase === 'roundEnd' ? 'ROUND OVER' :
      m.phase === 'matchEnd' ? 'MATCH OVER' : '';
  }
  if (els.bomb) {
    const b = sim.bomb;
    els.bomb.textContent =
      b.state === 'planted' ? `BOMB @ SITE ${b.site} — ${fmtTime(b.timer)}` :
      b.state === 'defused' ? 'BOMB DEFUSED' :
      b.state === 'exploded' ? 'BOMB DETONATED' :
      sim.bots.some((bot) => bot.hasBomb && bot.alive) ? 'BOMB CARRIED BY RAIDERS' : 'BOMB SECURE';
    els.bomb.classList.toggle('danger', b.state === 'planted');
  }
  if (els.freezeHint) {
    els.freezeHint.hidden = m.phase !== 'freeze';
    if (m.phase === 'freeze') els.freezeHint.textContent = `Buy phase — press B to open the shop (${fmtTime(m.phaseTime)})`;
  }

  // --- Crosshair gap follows movement/stance (stopping to aim pays). ---
  if (els.crosshair) {
    const move = p.moveSpeed;
    const gap = 4 + move * 1.1 + (p.ads ? -2 : 0) + (p.crouched ? -1 : 0);
    els.crosshair.style.setProperty('--gap', `${Math.max(2, gap).toFixed(1)}px`);
    els.crosshair.classList.toggle('ads', p.ads);
  }

  // --- Hitmarker / damage vignette / banner expiry. ---
  if (els.hitmarker) els.hitmarker.classList.toggle('on', now < hud.hitUntil);
  if (els.vignette) els.vignette.style.opacity = p.damageFlash.toFixed(2);
  if (els.dmgDir) {
    els.dmgDir.style.opacity = p.damageFlash > 0.05 ? '1' : '0';
    els.dmgDir.style.transform = `translate(-50%, -50%) rotate(${p.damageDir}rad)`;
  }
  if (els.banner && now > hud.bannerUntil) els.banner.hidden = true;

  // --- Sniper scope overlay. ---
  if (els.scope) els.scope.hidden = !(p.ads && p.weapon === 'sniper');

  // --- Defuse progress. ---
  if (els.defuse) {
    const show = p.defuseProgress > 0;
    els.defuse.hidden = !show;
    if (show) els.defuseFill.style.width = `${(p.defuseProgress / ROUND.defuseTime) * 100}%`;
  }

  // --- Buy menu auto-close when the round goes live. ---
  if (hud.buyOpen && m.phase !== 'freeze') setBuyOpen(hud, false);
  if (hud.buyOpen) updateBuyButtons(hud);
}
