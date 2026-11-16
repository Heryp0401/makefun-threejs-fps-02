// effects.js — render-side effects: tracers, muzzle flashes, impacts,
// explosions. Reads sim.effects (each with a sim timestamp) and reuses a
// small pool of THREE objects, so the render loop never allocates.

import * as THREE from 'three';

const TRACER_POOL = 24;
const TRACER_LIFE = 0.09;
const IMPACT_POOL = 16;
const IMPACT_LIFE = 0.35;

export function createEffects(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  const tracerGeo = new THREE.BufferGeometry();
  for (let i = 0; i < TRACER_POOL; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    group.add(line);
    tracers.push({ line, until: 0 });
  }

  const impacts = [];
  const impactMat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.14, transparent: true, opacity: 0.95 });
  for (let i = 0; i < IMPACT_POOL; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const pts = new THREE.Points(geo, impactMat.clone());
    pts.visible = false;
    pts.frustumCulled = false;
    group.add(pts);
    impacts.push({ pts, until: 0 });
  }

  // One reusable explosion: an expanding sphere + a point light.
  const boomMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.85 });
  const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), boomMat);
  boom.visible = false;
  group.add(boom);
  const boomLight = new THREE.PointLight(0xff8a3a, 0, 18, 1.6);
  boomLight.visible = false;
  group.add(boomLight);

  // One reusable muzzle flash: a sprite + a light at the gun tip.
  const flashMat = new THREE.SpriteMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthWrite: false });
  const flash = new THREE.Sprite(flashMat);
  flash.scale.set(0.55, 0.55, 1);
  flash.visible = false;
  group.add(flash);
  const flashLight = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
  flashLight.visible = false;
  group.add(flashLight);

  return {
    group, tracers, impacts, boom, boomMat, boomLight,
    flash, flashMat, flashLight,
    lastT: -1, boomUntil: 0, flashUntil: 0,
  };
}

export function updateEffects(fx, sim, now, camera) {
  // Consume new sim effects (each carries its sim timestamp).
  for (const e of sim.effects) {
    if (e.t <= fx.lastT) continue;
    if (e.type === 'tracer') {
      const slot = fx.tracers.find((t) => now >= t.until) || fx.tracers[0];
      const pos = slot.line.geometry.attributes.position.array;
      pos[0] = e.x0; pos[1] = e.y0; pos[2] = e.z0;
      pos[3] = e.x1; pos[4] = e.y1; pos[5] = e.z1;
      slot.line.geometry.attributes.position.needsUpdate = true;
      slot.line.material.opacity = 0.9;
      slot.line.visible = true;
      slot.until = now + TRACER_LIFE;
    } else if (e.type === 'impact') {
      const slot = fx.impacts.find((t) => now >= t.until) || fx.impacts[0];
      const pos = slot.pts.geometry.attributes.position.array;
      pos[0] = e.x; pos[1] = e.y; pos[2] = e.z;
      slot.pts.geometry.attributes.position.needsUpdate = true;
      slot.pts.material.opacity = 0.95;
      slot.pts.visible = true;
      slot.until = now + IMPACT_LIFE;
    } else if (e.type === 'explosion') {
      fx.boom.position.set(e.x, Math.max(0.6, e.y), e.z);
      fx.boom.visible = true;
      fx.boomLight.position.set(e.x, e.y + 1, e.z);
      fx.boomLight.visible = true;
      fx.boomUntil = now + 0.55;
    } else if (e.type === 'muzzle') {
      // Muzzle flash at the camera (the player's gun tip).
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fx.flash.position.copy(camera.position).addScaledVector(fwd, 0.7);
      fx.flash.position.y -= 0.12;
      fx.flash.visible = true;
      fx.flashLight.position.copy(fx.flash.position);
      fx.flashLight.visible = true;
      fx.flashUntil = now + 0.05;
    }
  }
  fx.lastT = sim.time;

  // Fade tracers / impacts / explosion / flash by wall-clock time.
  for (const t of fx.tracers) {
    if (t.line.visible) {
      const remain = t.until - now;
      if (remain <= 0) t.line.visible = false;
      else t.line.material.opacity = 0.9 * (remain / TRACER_LIFE);
    }
  }
  for (const t of fx.impacts) {
    if (t.pts.visible) {
      const remain = t.until - now;
      if (remain <= 0) t.pts.visible = false;
      else t.pts.material.opacity = 0.95 * (remain / IMPACT_LIFE);
    }
  }
  if (fx.boom.visible) {
    const remain = fx.boomUntil - now;
    if (remain <= 0) {
      fx.boom.visible = false;
      fx.boomLight.visible = false;
    } else {
      const k = 1 - remain / 0.55;
      const s = 0.5 + k * 5;
      fx.boom.scale.set(s, s, s);
      fx.boomMat.opacity = 0.85 * (remain / 0.55);
      fx.boomLight.intensity = 60 * (remain / 0.55);
    }
  }
  if (fx.flash.visible && now >= fx.flashUntil) {
    fx.flash.visible = false;
    fx.flashLight.visible = false;
  }
}
