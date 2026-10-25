// 지각 모드 흐름:
// 연출(공대 2호관 입구로 날아감 → 교수님 등장·대사 → 굴착기 앞·옆·뒤) → 3, 2, 1, GO
// → 미션들 → 공과대 2호관 도착 → 교수님 판정(A+ / F) → 결과.
import * as THREE from 'three';
import { MISSIONS } from './missions-data.js';
import { DIALOGUE, SPEAKER } from './dialogue-data.js';
import { Professor, SpeechBubble } from './professor.js';
import { PROFESSOR } from './professor-config.js';
import { playDing, playBeep, playMissionRise, playCharge } from './voice.js';

// 제한 시간(초). 참고: 차도 최단 경로는 3,861m라 부스터와 지름길이 필요하다
export const TIME_LIMIT = 180;

const MISSION_SECONDS = 2;  // E를 누른 뒤 진행 막대 시간
const STOP_KMH = 3;         // 이보다 느리면 멈춘 것으로 본다
const BOOST_REWARD = 0.5;   // 미션 완료 시 부스터 게이지 보충량
const GO_SHOW = 0.8;        // "GO!" 글자가 떠 있는 시간

// 연출 길이(초). 대사 3줄(약 6초)과 카운트다운 3초를 더해 전체 20초 안쪽
const CINE = {
  fly: 2.0,        // 공대 2호관 입구로 날아감
  walk: 2.0,       // 교수님이 걸어 나옴
  lineHold: 0.9,   // 대사 한 줄이 다 나온 뒤 기다림 (클릭·Space로 바로 넘김)
  toCar: 1.6,      // 굴착기 앞으로 날아감
  orbit: 3.0,      // 앞 → 옆 → 뒤
  outroFly: 1.4,   // 도착 후 교수님에게 날아감
  outroHold: 1.6,  // 판정 대사 뒤 결과 창까지
};

export class LateMode {
  constructor({ scene, car, hud, campus, camera, rig, trees }) {
    Object.assign(this, { car, hud, campus, camera, rig });
    this.state = 'off'; // off | intro | countdown | playing | mission | paused | outro | result
    this.targets = MISSIONS.map((m) => {
      const b = campus.buildings.find((x) => x.name === m.building);
      if (!b) console.warn('미션 건물을 찾지 못함:', m.building);
      const [x, z] = nearestCarRoad(campus, b ? b.center : [0, 0]);
      return { ...m, x, z };
    });
    this.marker = buildMarker();
    scene.add(this.marker.group);

    this.professor = new Professor();
    this.professor.object.visible = false;
    scene.add(this.professor.object);
    this.bubble = new SpeechBubble(SPEAKER);
    this.stage = this.makeStage();
    // 교수님과 연출 카메라 사이의 나무를 치운다
    const S = this.stage;
    for (let k = 0; k <= 1; k += 0.25) {
      trees?.clearAround(S.from.x + (S.camPos.x - S.from.x) * k, S.from.z + (S.camPos.z - S.from.z) * k, 5);
    }

    hud.bindLate({
      start: () => this.start(),
      resume: () => this.resume(),
      retry: () => this.start(),
      exit: () => this.exit(),
    });
  }

  // 교수님이 등장하는 자리: 마지막 목적지 건물(공과대 2호관) 입구 앞
  makeStage() {
    const fin = this.targets[this.targets.length - 1];
    const b = this.campus.buildings.find((x) => x.name === fin.building);
    let e = b && b.entrance;
    if (!e) { // 입구 정보가 없으면 건물 중심에서 목적지 쪽
      const [cx, cz] = b ? b.center : [fin.x, fin.z];
      const dx = fin.x - cx, dz = fin.z - cz, L = Math.hypot(dx, dz) || 1;
      e = { x: cx, z: cz, nx: dx / L, nz: dz / L };
    }
    const walk = PROFESSOR.walk.speed * PROFESSOR.scale * CINE.walk;
    const from = new THREE.Vector3(e.x + e.nx * 0.6, 0, e.z + e.nz * 0.6);
    const to = new THREE.Vector3(e.x + e.nx * (0.6 + walk), 0, e.z + e.nz * (0.6 + walk));
    const side = new THREE.Vector3(-e.nz, 0, e.nx);
    const camPos = to.clone().addScaledVector(new THREE.Vector3(e.nx, 0, e.nz), 6.5).addScaledVector(side, 1.4);
    camPos.y = 2.4;
    return { from, to, n: new THREE.Vector3(e.nx, 0, e.nz), camPos, lookY: 1.5 * PROFESSOR.scale };
  }

  get active() { return this.state !== 'off'; }
  // 차 입력을 막는 상태
  get inputLocked() { return !['off', 'playing'].includes(this.state); }
  // 차 물리까지 멈추는 상태
  get frozen() { return ['paused', 'outro', 'result'].includes(this.state); }

  start() {
    const { position, dir } = this.campus.spawn;
    this.car.place(position[0], position[1], dir[0], dir[1]);
    this.index = 0;
    this.elapsed = 0;
    this.goTimer = 0;
    this.hud.setLateMode(true);
    this.hud.setCinematic(true);
    this.hud.showPause(false);
    this.hud.showResult(null);
    this.hud.showProgress(null);
    this.hud.showCountdown(null);
    this.hud.updateTarget(this.camera, null);
    this.hud.setTimer(TIME_LIMIT);
    this.hud.setMissions(this.targets, 0);
    this.showTarget();

    const S = this.stage;
    this.professor.object.visible = true;
    this.professor.place(S.from.x, S.from.z, S.n.x, S.n.z);
    this.professor.pose = 'rest';
    this.professor.walking = false;
    this.bubble.hide();

    this.state = 'intro';
    this.phase = 'fly';
    this.phaseT = 0;
    this.flyFrom = { pos: this.camera.position.clone(), look: this.lookPoint() };
    this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
    this.rig.setCinematic(this.cam);
  }

  exit() {
    this.state = 'off';
    this.marker.group.visible = false;
    this.professor.object.visible = false;
    this.bubble.hide();
    this.rig.setCinematic(null);
    this.hud.setCinematic(false);
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
      if (this.state === 'intro' || this.state === 'countdown') this.skipIntro();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'playing' || this.state === 'mission') this.pause();
    } else if (code === 'Space') this.advance();
    else if (code === 'KeyE' && this.state === 'playing') this.tryMission();
  }

  // 클릭·Space: 대사 넘기기
  advance() {
    const talking = (this.state === 'intro' && this.phase === 'talk') || (this.state === 'outro' && this.phase === 'talk');
    if (!talking) return;
    if (!this.bubble.skipTyping()) this.phaseT = 1e9; // 이미 다 나왔으면 바로 다음
  }

  // Esc: 연출을 통째로 건너뛰고 바로 출발
  skipIntro() {
    this.bubble.hide();
    const S = this.stage;
    this.professor.place(S.to.x, S.to.z, S.n.x, S.n.z);
    this.professor.walking = this.professor.talking = false;
    this.go();
  }

  go() {
    this.state = 'playing';
    this.rig.setCinematic(null);
    this.rig.snap = true;
    this.hud.setCinematic(false);
    this.goTimer = GO_SHOW;
    playBeep(true);
    this.hud.showCountdown('GO!');
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
    playMissionRise(MISSION_SECONDS); // 진행 막대 동안 "뚜루루루↗"
  }

  update(dt) {
    if (this.state === 'off') return;
    const time = performance.now() / 1000;
    this.marker.animate(time);
    this.professor.update(dt);
    this.bubble.update(dt);
    this.professor.gesture = this.bubble.gesture;
    if (this.bubble.active) {
      this.professor.talking = !this.bubble.done;
      tmp.copy(this.professor.headTop()).project(this.camera);
      this.bubble.place((tmp.x + 1) / 2 * innerWidth, (1 - tmp.y) / 2 * innerHeight);
    }

    if (this.state === 'intro') this.updateIntro(dt);
    else if (this.state === 'countdown') this.updateCountdown(dt);
    else if (this.state === 'outro') this.updateOutro(dt);
    else if (this.goTimer > 0 && !this.frozen) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.hud.showCountdown(null);
    }

    if (this.state === 'playing' || this.state === 'mission') {
      this.elapsed += dt;
      this.hud.setTimer(TIME_LIMIT - this.elapsed);
      const dist = this.distToTarget();
      const t = this.target;
      if (this.state === 'playing') {
        const inside = dist <= t.radius;
        if (t.final && inside) return this.finish();
        if (inside && !t.final) this.hud.setHint(this.car.speedKmh > STOP_KMH ? '멈추세요!' : 'E 키를 눌러 미션');
        else this.hud.setHint(null);
      } else {
        this.progress += dt / MISSION_SECONDS;
        this.hud.showProgress(t, this.progress);
        if (this.progress >= 1) this.completeMission();
      }
      this.hud.updateTarget(this.camera, tmp.set(t.x, 6.5, t.z), dist);
    }
  }

  // ---------- 시작 연출 ----------

  updateIntro(dt) {
    this.phaseT += dt;
    const S = this.stage, P = this.professor, cam = this.cam;
    const owlLook = (v) => v.set(P.object.position.x, S.lookY, P.object.position.z);

    if (this.phase === 'fly') {
      const k = ease(this.phaseT / CINE.fly);
      flyBetween(cam, this.flyFrom, { pos: S.camPos, look: owlLook(tmp2) }, k, 12);
      if (this.phaseT >= CINE.fly) this.next('walk');
    } else if (this.phase === 'walk') {
      const k = Math.min(1, this.phaseT / CINE.walk);
      P.walking = k < 1;
      P.object.position.lerpVectors(S.from, S.to, k);
      cam.pos.copy(S.camPos);
      cam.look.lerp(owlLook(tmp2), Math.min(1, dt * 6));
      if (k >= 1) {
        P.face(S.camPos.x - S.to.x, S.camPos.z - S.to.z); // 카메라를 본다
        this.line = 0;
        this.sayIntroLine();
        this.next('talk');
      }
    } else if (this.phase === 'talk') {
      cam.look.lerp(owlLook(tmp2), Math.min(1, dt * 6));
      if (!this.bubble.done) this.phaseT = 0; // 다 나온 뒤부터 기다림 시간을 잰다
      if (this.phaseT >= CINE.lineHold) {
        this.line++;
        if (this.line < DIALOGUE.intro.length) { this.sayIntroLine(); this.phaseT = 0; } else {
          this.bubble.hide();
          P.talking = false;
          this.flyFrom = { pos: cam.pos.clone(), look: cam.look.clone() };
          this.next('toCar');
        }
      }
    } else if (this.phase === 'toCar') {
      const k = ease(this.phaseT / CINE.toCar);
      flyBetween(cam, this.flyFrom, this.orbitPose(0, tmpPose), k, 25);
      if (this.phaseT >= CINE.toCar) this.next('orbit');
    } else if (this.phase === 'orbit') {
      const k = Math.min(1, this.phaseT / CINE.orbit);
      const pose = this.orbitPose(ease(k), tmpPose);
      cam.pos.copy(pose.pos);
      cam.look.copy(pose.look);
      if (k >= 1) {
        this.state = 'countdown';
        this.countdown = 3;
        this.lastCount = null;
      }
    }
  }

  next(phase) {
    this.phase = phase;
    this.phaseT = 0;
  }

  sayIntroLine() {
    this.bubble.say(DIALOGUE.intro[this.line]);
  }

  // 굴착기 주위를 도는 카메라: k=0 앞면, 0.5 옆면, 1 뒷면(= 뒤 따라가기 시점과 같은 자리)
  orbitPose(k, out) {
    const c = this.car, f = c.forward();
    const a = k * Math.PI;
    const dx = f.x * Math.cos(a) + f.y * Math.sin(a);
    const dz = f.y * Math.cos(a) - f.x * Math.sin(a);
    const r = 6.5 + 2 * k;
    out.pos.set(c.pos.x + dx * r, 2.0 + 2 * k, c.pos.y + dz * r);
    // 마지막엔 따라가기 카메라처럼 앞쪽을 보게
    const w = k * k;
    out.look.set(c.pos.x + f.x * 4 * w, 1.3 + 0.3 * w, c.pos.y + f.y * 4 * w);
    return out;
  }

  updateCountdown(dt) {
    this.countdown -= dt;
    const n = Math.ceil(this.countdown);
    if (n !== this.lastCount && n > 0) { playBeep(); this.lastCount = n; }
    this.hud.showCountdown(String(n));
    if (this.countdown <= 0) this.go();
  }

  // ---------- 미션 ----------

  completeMission() {
    const t = this.target;
    playDing();
    playCharge(); // 부스터 게이지 충전 "슈웅↑"
    this.car.addBoost(BOOST_REWARD);
    this.hud.flashGauge();
    this.hud.toast(`${t.emoji} ${t.title} 완료! 부스터 +50%`, 2200);
    this.index++;
    this.hud.setMissions(this.targets, this.index);
    this.state = 'playing';
    this.showTarget();
    setTimeout(() => { if (this.state !== 'mission') this.hud.showProgress(null); }, 1200); // 대사를 잠깐 보여 주고 닫기
  }

  // ---------- 도착 → 판정 ----------

  finish() {
    this.remaining = TIME_LIMIT - this.elapsed;
    this.success = this.remaining >= 0;
    this.state = 'outro';
    this.car.vel.set(0, 0);
    this.hud.setMissions(this.targets, this.targets.length); // 목록 전부 체크
    this.hud.setHint(null);
    this.hud.showCountdown(null);
    this.hud.updateTarget(this.camera, null);
    this.hud.setCinematic(true);

    const S = this.stage, P = this.professor;
    P.place(S.to.x, S.to.z, S.camPos.x - S.to.x, S.camPos.z - S.to.z);
    P.walking = false;
    P.pose = this.success ? 'thumbsUp' : 'stern';
    this.flyFrom = { pos: this.camera.position.clone(), look: this.lookPoint() };
    this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
    this.rig.setCinematic(this.cam);
    this.next('fly');
  }

  updateOutro(dt) {
    this.phaseT += dt;
    const S = this.stage, cam = this.cam;
    const look = tmp2.set(S.to.x, S.lookY, S.to.z);
    if (this.phase === 'fly') {
      flyBetween(cam, this.flyFrom, { pos: S.camPos, look }, ease(this.phaseT / CINE.outroFly), 10);
      if (this.phaseT >= CINE.outroFly) {
        const line = this.success ? DIALOGUE.success : DIALOGUE.fail;
        this.bubble.say(line, { onBig: () => this.hud.shake() });
        this.next('talk');
      }
    } else if (this.phase === 'talk') {
      if (!this.bubble.done) this.phaseT = 0;
      if (this.phaseT >= CINE.outroHold) this.showResult();
    }
  }

  showResult() {
    this.state = 'result';
    this.professor.talking = false;
    if (this.success) playDing();
    this.hud.showResult({ grade: this.success ? 'A+' : 'F', elapsed: this.elapsed, remaining: this.remaining });
  }

  // ---------- 도우미 ----------

  showTarget() {
    this.marker.place(this.target);
  }

  // 지금 카메라가 보고 있는 점 (연출 시작할 때 이어지게)
  lookPoint() {
    return this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(this.camera.position);
  }
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmpPose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };

function ease(k) {
  k = Math.min(1, Math.max(0, k));
  return k * k * (3 - 2 * k);
}

// a → b로 날아가는 카메라. 중간에 arc만큼 위로 솟는다
function flyBetween(cam, a, b, k, arc) {
  cam.pos.lerpVectors(a.pos, b.pos, k);
  cam.pos.y += Math.sin(k * Math.PI) * arc;
  cam.look.lerpVectors(a.look, b.look, k);
}

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
