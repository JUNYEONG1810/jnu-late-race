// 지각 모드 흐름: 시작(정문) → 3, 2, 1, GO → 미션들 → 공과대 2호관 도착 → 결과.
// 교수님 연출과 카메라 회전은 다음 단계에서 countdown 앞에 끼워 넣는다.
import * as THREE from 'three';
import { MISSIONS } from './missions-data.js';
import { playDing, playBeep } from './voice.js';

// 제한 시간(초): 정문→미션→공대 2호관 차도 최단 경로 3,861m ÷ 시속 45km(309초)
// + 미션 4개 × 10초, 여유 20% → 419초, 30초 단위 반올림
export const TIME_LIMIT = 420;

const MISSION_SECONDS = 2;  // E를 누른 뒤 진행 막대 시간
const STOP_KMH = 3;         // 이보다 느리면 멈춘 것으로 본다
const BOOST_REWARD = 0.5;   // 미션 완료 시 부스터 게이지 보충량
const GO_SHOW = 0.8;        // "GO!" 글자가 떠 있는 시간

export class LateMode {
  constructor({ scene, car, hud, campus, camera, rig }) {
    Object.assign(this, { car, hud, campus, camera, rig });
    this.state = 'off'; // off | countdown | playing | mission | paused | result
    this.targets = MISSIONS.map((m) => {
      const b = campus.buildings.find((x) => x.name === m.building);
      if (!b) console.warn('미션 건물을 찾지 못함:', m.building);
      const [x, z] = nearestCarRoad(campus, b ? b.center : [0, 0]);
      return { ...m, x, z };
    });
    this.marker = buildMarker();
    scene.add(this.marker.group);
    hud.bindLate({
      start: () => this.start(),
      resume: () => this.resume(),
      retry: () => this.start(),
      exit: () => this.exit(),
    });
  }

  get active() { return this.state !== 'off'; }
  // 차 입력을 막는 상태 (카운트다운·미션 진행·일시정지·결과)
  get inputLocked() { return ['countdown', 'mission', 'paused', 'result'].includes(this.state); }
  // 차 물리까지 멈추는 상태
  get frozen() { return this.state === 'paused' || this.state === 'result'; }

  start() {
    const { position, dir } = this.campus.spawn;
    this.car.place(position[0], position[1], dir[0], dir[1]);
    this.rig.snap = true;
    this.index = 0;
    this.elapsed = 0;
    this.countdown = 3;
    this.lastCount = null;
    this.goTimer = 0;
    this.state = 'countdown';
    this.hud.setLateMode(true);
    this.hud.showPause(false);
    this.hud.showResult(null);
    this.hud.showProgress(null);
    this.hud.setTimer(TIME_LIMIT);
    this.hud.setMissions(this.targets, 0);
    this.showTarget();
  }

  exit() {
    this.state = 'off';
    this.marker.group.visible = false;
    this.hud.setLateMode(false);
    this.hud.updateTarget(this.camera, null);
  }

  pause() {
    this.resumeState = this.state;
    this.state = 'paused';
    this.hud.showPause(true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.resumeState;
    this.hud.showPause(false);
  }

  onKey(code) {
    if (code === 'KeyL' && !this.active) this.start();
    else if (code === 'Escape' && this.active) {
      if (this.state === 'paused') this.resume();
      else if (this.state !== 'result') this.pause();
    } else if (code === 'KeyE' && this.state === 'playing') this.tryMission();
  }

  get target() { return this.targets[this.index]; }

  distToTarget() {
    return Math.hypot(this.car.pos.x - this.target.x, this.car.pos.y - this.target.z);
  }

  tryMission() {
    const t = this.target;
    if (t.final || this.distToTarget() > t.radius || this.car.speedKmh > STOP_KMH) return;
    this.state = 'mission';
    this.progress = 0;
    this.hud.setHint(null);
  }

  update(dt) {
    const time = performance.now() / 1000;
    if (this.state === 'off') return;
    this.marker.animate(time);

    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount && n > 0) { playBeep(); this.lastCount = n; }
      this.hud.showCountdown(String(n));
      if (this.countdown <= 0) {
        this.state = 'playing';
        this.goTimer = GO_SHOW;
        playBeep(true);
        this.hud.showCountdown('GO!');
      }
    } else if (this.goTimer > 0 && !this.frozen) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.hud.showCountdown(null);
    }

    if (this.state === 'playing' || this.state === 'mission') {
      this.elapsed += dt;
      this.hud.setTimer(TIME_LIMIT - this.elapsed);
    }

    const dist = this.distToTarget();
    const t = this.target;
    if (this.state === 'playing') {
      const inside = dist <= t.radius;
      if (t.final && inside) return this.finish();
      if (inside && !t.final) this.hud.setHint(this.car.speedKmh > STOP_KMH ? '멈추세요!' : 'E 키를 눌러 미션');
      else this.hud.setHint(null);
    } else if (this.state === 'mission') {
      this.progress += dt / MISSION_SECONDS;
      this.hud.showProgress(t, this.progress);
      if (this.progress >= 1) this.completeMission();
    }

    if (this.state !== 'result') this.hud.updateTarget(this.camera, tmp.set(t.x, 6.5, t.z), dist);
  }

  completeMission() {
    const t = this.target;
    playDing();
    this.car.addBoost(BOOST_REWARD);
    this.hud.toast(`${t.emoji} ${t.title} 완료! 부스터 +50%`, 2200);
    this.index++;
    this.hud.setMissions(this.targets, this.index);
    this.state = 'playing';
    this.showTarget();
    setTimeout(() => { if (this.state !== 'mission') this.hud.showProgress(null); }, 1200); // 대사를 잠깐 보여 주고 닫기
  }

  finish() {
    this.state = 'result';
    this.hud.setMissions(this.targets, this.targets.length); // 목록 전부 체크
    this.hud.setHint(null);
    this.hud.showCountdown(null);
    this.hud.updateTarget(this.camera, null);
    const remaining = TIME_LIMIT - this.elapsed;
    if (remaining >= 0) playDing();
    this.hud.showResult({ grade: remaining >= 0 ? 'A+' : 'F', elapsed: this.elapsed, remaining });
  }

  showTarget() {
    const t = this.target;
    this.marker.place(t);
  }
}

const tmp = new THREE.Vector3();

// 바닥의 빛나는 원 + 빛 기둥 + 위아래로 떠다니는 이모지
function buildMarker() {
  const group = new THREE.Group();
  group.visible = false;

  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2), ringMat);
  ring.position.y = 0.06;
  const discMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.22, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.86, 48).rotateX(-Math.PI / 2), discMat);
  disc.position.y = 0.05;

  // 아래는 진하고 위로 갈수록 투명한 빛 기둥
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const wallMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.45, alphaMap: new THREE.CanvasTexture(c), depthWrite: false, side: THREE.DoubleSide });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 48, 1, true).translate(0, 1.5, 0), wallMat);

  for (const m of [ring, disc, wall]) m.renderOrder = 1;
  const circle = new THREE.Group();
  circle.add(ring, disc, wall);
  group.add(circle);

  const emojiCanvas = document.createElement('canvas');
  emojiCanvas.width = emojiCanvas.height = 128;
  const emojiTex = new THREE.CanvasTexture(emojiCanvas);
  emojiTex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex, depthWrite: false }));
  sprite.scale.set(3.5, 3.5, 1);
  sprite.renderOrder = 2;
  group.add(sprite);

  return {
    group,
    place(t) {
      group.visible = true;
      group.position.set(t.x, 0, t.z);
      circle.scale.set(t.radius, 1, t.radius);
      const color = t.final ? '#5fd3ff' : '#ffd23f';
      ringMat.color.set(color); discMat.color.set(color); wallMat.color.set(color);
      const ctx = emojiCanvas.getContext('2d');
      ctx.clearRect(0, 0, 128, 128);
      ctx.font = '96px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.emoji, 64, 70);
      emojiTex.needsUpdate = true;
    },
    animate(time) {
      sprite.position.y = 5 + Math.sin(time * 2.2) * 0.6;
      ringMat.opacity = 0.65 + Math.sin(time * 4) * 0.25;
      wall.scale.y = 1 + Math.sin(time * 3) * 0.12;
    },
  };
}

// 점 p에서 가장 가까운 차도 위 점
function nearestCarRoad(campus, [px, pz]) {
  let best = Infinity, bx = px, bz = pz;
  for (const r of campus.roads) {
    if (!r.car) continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [x1, z1] = r.points[i], [x2, z2] = r.points[i + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const L = dx * dx + dz * dz;
      const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L));
      const qx = x1 + t * dx, qz = z1 + t * dz;
      const d = Math.hypot(px - qx, pz - qz);
      if (d < best) { best = d; bx = qx; bz = qz; }
    }
  }
  return [bx, bz];
}
