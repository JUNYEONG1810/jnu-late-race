// 내려서 걷는 운전사 학생(황소). 자유 주행에서 E로 굴착기 왼쪽(팔이 없는 쪽) 문으로 폴짝 내려 걷고,
// 굴착기 근처에서 E로 다시 탄다. 모델은 운전석의 Driver를 그대로 옮겨 쓴다(의자·레버는 굴착기에 남음).
// 충돌은 굴착기와 같은 건물 외곽선 방식, 굴착기는 몸체·팔 상자, 물에는 못 들어간다.
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { pointInPolygon } from './car.js';
import { DRIVER as D } from './driver-config.js';

export const WALK = {
  speed: 1.7,       // 걷기 (m/s)
  run: 4.6,         // Shift 달리기
  accel: 12,        // 빠르기가 따라붙는 정도
  turn: 12,         // 몸을 돌리는 빠르기
  jump: 4.2,        // Space 점프 처음 속도 (m/s) → 약 0.6m
  gravity: 14,
  radius: 0.3,      // 충돌 원 (m)
  maxGrade: 0.75,   // 이보다 가파른 오르막(높이차/거리, 약 37°)은 못 올라감
  dropFall: 0.35,   // 땅이 이만큼 넘게 갑자기 낮아지면 떨어짐
  boardDist: 4,     // 굴착기 가운데에서 이 거리 안이면 E로 탐 (몸체 가장자리에서 약 3m)
  exitSide: 2.25,   // 내려서 서는 곳: 굴착기 가운데에서 왼쪽(로컬 +x)으로
  hop: 0.75,        // 타고 내리는 폴짝 시간 (s)
  hopHeight: 0.55,
  summonDist: 15,   // 이보다 멀면 R로 굴착기를 부를 수 있음
  boardHopMax: 12,  // 걷다가 L: 이 거리 안이면 폴짝 뛰어 타고, 더 멀면 바로 탄다
};

// 굴착기 충돌 상자 (굴착기 로컬: x 왼쪽, z 앞) [x0, x1, z0, z1]: 몸체·궤도, 앞으로 뻗은 팔
const CAR_BOXES = [[-1.0, 1.0, -1.35, 1.3], [-0.75, 0.15, 1.3, 2.9]];
// 서 있을 때 엉덩이(몸 기준점)를 땅에서 띄우는 높이: 뒷다리 발굽 바닥이 땅에 닿게
const FOOT_LIFT = -(D.leg.y - D.leg.len - D.leg.r * 1.5) * D.scale;
const SIT = D.pose.sit;
const STAND = { arm: [0.05, 0.14], leg: [0, 0.04] };

export class Walker {
  constructor(car, { campus, collider }) {
    this.car = car;
    this.driver = car.driver;
    this.collider = collider;
    this.object = new THREE.Group(); // 월드에 놓인 학생 (발밑 = 땅)
    this.object.visible = false;
    this.state = 'off'; // off(운전 중) | exit | walk | board
    this.pos = new THREE.Vector2();
    this.vel = new THREE.Vector2();
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.jumpHeld = false;
    this.heading = 0;
    this.speed = 0;
    this.moving = false;
    this.running = false;
    this.phase = 0;
    this.time = 0;
    this.idle = 0;
    this.look = { cur: 0, goal: 0, timer: 3 }; // 서 있으면 가끔 두리번
    this.hop = null;
    this.onStep = null; // 발소리 (main에서 voice.playStep)
    this.water = (campus.greens || []).filter((g) => g.kind === 'water').map((g) => ({ outline: g.outline, box: bbox(g.outline) }));
  }

  get active() { return this.state !== 'off'; }
  get walking() { return this.state === 'walk'; }
  nearCar() { return this.pos.distanceTo(this.car.pos) < WALK.boardDist; }

  // ---------- 타고 내리기 ----------

  // 굴착기 왼쪽 문으로 폴짝 내려 옆에 선다
  exit() {
    const car = this.car, h = car.heading;
    this.driver.setPeek(false);
    this.driver.peek = 0;
    car.object.updateMatrixWorld(true);
    const from = this.driver.object.getWorldPosition(new THREE.Vector3()); // 운전석 엉덩이 자리
    const to = new THREE.Vector2(car.pos.x + Math.cos(h) * WALK.exitSide + Math.sin(h) * 0.2,
      car.pos.y - Math.sin(h) * WALK.exitSide + Math.cos(h) * 0.2);
    this.collider.resolve(to, WALK.radius);
    this.vel.set(0, 0);
    this.vy = 0;
    this.grounded = true;
    this.attach(true);
    this.startHop('exit', from, new THREE.Vector3(to.x, heightAt(to.x, to.y), to.y), h, h + Math.PI / 2);
  }

  // 굴착기로 폴짝 뛰어 운전석에 앉는다. then: 앉은 뒤 할 일 (걷다가 L → 지각 모드)
  board(then = null) {
    if (this.state !== 'walk') return;
    const d = this.pos.distanceTo(this.car.pos);
    if (d > WALK.boardHopMax) { this.boardNow(); then?.(); return; }
    this.car.object.updateMatrixWorld(true);
    const to = this.driver.object.getWorldPosition(new THREE.Vector3());
    this.vel.set(0, 0);
    this.startHop('board', this.object.position.clone(), to, this.heading, this.car.heading, Math.max(0, d - WALK.boardDist));
    this.hop.then = then;
  }

  // 연출 없이 바로 운전석으로 (지각 모드 시작 버튼 등)
  boardNow() {
    if (this.state === 'off') return;
    this.hop = null;
    this.attach(false);
    this.state = 'off';
    this.car.door = 0;
  }

  // 학생 몸(root)을 월드(걷기) 또는 운전석으로 옮긴다
  attach(toWorld) {
    const d = this.driver, r = d.root;
    if (toWorld) {
      this.object.add(r);
      d.standing = true;
      this.car.driverAboard = false;
      this.object.visible = true;
    } else {
      d.object.add(r);
      d.standing = false;
      this.car.driverAboard = true;
      this.object.visible = false;
      r.position.set(0, 0, 0);
      r.rotation.set(0, 0, 0);
      r.scale.setScalar(D.scale);
      d.head.rotation.set(0, 0, 0);
      d.update(0, 0);
    }
  }

  startHop(kind, from, to, h0, h1, extra = 0) {
    this.state = kind;
    this.hop = { kind, t: 0, dur: WALK.hop + extra * 0.05, height: WALK.hopHeight + extra * 0.08, from, to, h0, h1, then: null };
  }

  updateHop(dt) {
    const H = this.hop, car = this.car;
    H.t += dt;
    const k = Math.min(1, H.t / H.dur), e = k * k * (3 - 2 * k);
    const p = H.from.clone().lerp(H.to, e);
    p.y += 4 * k * (1 - k) * H.height;
    this.object.position.copy(p);
    this.pos.set(p.x, p.z);
    this.y = p.y;
    this.heading = H.h0 + angleDiff(H.h1, H.h0) * e;
    this.object.rotation.set(0, this.heading, 0);
    // 앉은 자세 ↔ 선 자세, 공중에서는 앞발을 살짝 벌림
    const sit = H.kind === 'exit' ? 1 - e : e;
    const r = this.driver.root;
    r.position.set(0, (1 - sit) * FOOT_LIFT, 0);
    r.rotation.set(0, 0, 0);
    const air = 4 * k * (1 - k);
    this.setLimbs(lerp(STAND.arm[0], SIT.arm[0], sit) - air * 0.5, lerp(STAND.arm[1], SIT.arm[1], sit) + air * 0.6,
      lerp(STAND.leg[0], SIT.leg[0], sit) - air * 0.4, lerp(STAND.leg[1], SIT.leg[1], sit), 1);
    // 왼쪽 문 창: 학생이 지나가는 동안 내려가 있다가 닫힘
    car.door = H.kind === 'exit' ? (k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45) : Math.min(1, k * 5);
    if (k < 1) return;
    this.hop = null;
    if (H.kind === 'exit') {
      this.state = 'walk';
      this.pos.set(H.to.x, H.to.z);
      this.y = H.to.y;
      this.onStep?.(false);
    } else {
      this.attach(false);
      this.state = 'off';
      H.then?.();
    }
  }

  // ---------- 걷기 ----------

  // input: 방향키, boost(Shift) = 달리기, drift(Space) = 점프. camDir: 화면 앞쪽(월드 x, z 단위 벡터)
  update(dt, input = null, camDir = null) {
    this.time += dt;
    if (this.state === 'off') {
      if (this.car.door > 0) this.car.door = Math.max(0, this.car.door - dt * 3); // 타고 나서 문 닫기
      return;
    }
    if (this.hop) { this.updateHop(dt); return; }

    // 화면 기준 방향: W는 카메라가 보는 쪽, A·D는 화면 왼쪽·오른쪽
    const f = camDir, rx = -f.y, rz = f.x;
    const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0), iz = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const want = new THREE.Vector2(f.x * iz + rx * ix, f.y * iz + rz * ix);
    const has = want.lengthSq() > 0;
    if (has) want.normalize();
    this.running = !!input.boost && has;
    want.multiplyScalar(this.running ? WALK.run : WALK.speed);
    this.vel.lerp(want, 1 - Math.exp(-dt * (this.grounded ? WALK.accel : 3)));
    if (has) this.heading += angleDiff(Math.atan2(want.x, want.y), this.heading) * Math.min(1, dt * WALK.turn);
    if (input.drift && !this.jumpHeld && this.grounded) { this.vy = WALK.jump; this.grounded = false; }
    this.jumpHeld = !!input.drift;

    this.move(dt);
    this.speed = this.vel.length();
    this.moving = this.speed > 0.2;
    this.animate(dt);
    this.object.position.set(this.pos.x, this.y, this.pos.y);
    this.object.rotation.set(0, this.heading, 0);
  }

  move(dt) {
    const sx = this.vel.x * dt, sz = this.vel.y * dt;
    // 물·가파른 오르막이면 막고, 한 축씩 다시 해 봐서 벽을 따라 미끄러지게
    if (!this.tryStep(sx, sz)) {
      if (this.tryStep(sx, 0)) this.vel.y = 0;
      else if (this.tryStep(0, sz)) this.vel.x = 0;
      else this.vel.set(0, 0);
    }
    // 건물·기념물 (굴착기와 같은 외곽선 충돌), 굴착기, 캠퍼스 경계
    this.hit = 0;
    const n = this.collider.resolve(this.pos, WALK.radius);
    if (n) this.pushBack(n);
    const m = this.pushOutOfCar();
    if (m) this.pushBack(m);
    const w = this.collider.boundaryWall(this.pos, 40);
    if (w) this.pushBack(w);

    // 땅 높이: 걸을 땐 땅에 붙고, 점프·낭떠러지에서는 떨어진다
    const g = heightAt(this.pos.x, this.pos.y);
    if (this.grounded) {
      if (g < this.y - WALK.dropFall) { this.grounded = false; this.vy = 0; }
      else this.y = g;
    }
    if (!this.grounded) {
      this.vy -= WALK.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= g) {
        this.landSpeed = -this.vy;
        this.y = g;
        this.vy = 0;
        this.grounded = true;
        this.onStep?.(false);
      }
    }
  }

  // 벽 쪽 속도를 없앤다. 부딪힌 세기는 this.hit
  pushBack(n) {
    const vn = this.vel.dot(n);
    if (vn < 0) {
      this.vel.addScaledVector(n, -vn);
      this.hit = Math.max(this.hit, -vn);
    }
  }

  tryStep(dx, dz) {
    if (!dx && !dz) return true;
    const x = this.pos.x + dx, z = this.pos.y + dz;
    if (this.inWater(x, z)) return false;
    const rise = heightAt(x, z) - this.y; // 땅에 붙어 있으면 경사, 공중이면 발보다 높은 땅만 막음
    if (this.grounded ? rise > WALK.maxGrade * Math.hypot(dx, dz) + 0.002 : rise > 0.02) return false;
    this.pos.set(x, z);
    return true;
  }

  inWater(x, z) {
    for (const w of this.water) {
      const b = w.box;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      if (pointInPolygon(x, z, w.outline)) return true;
    }
    return false;
  }

  // 세워 둔 굴착기(몸체·팔 상자) 밖으로 밀어낸다. 밀었으면 바깥 방향(월드 단위 벡터)
  pushOutOfCar() {
    const c = this.car, s = Math.sin(c.heading), co = Math.cos(c.heading), R = WALK.radius;
    const dx = this.pos.x - c.pos.x, dz = this.pos.y - c.pos.y;
    let lx = dx * co - dz * s, lz = dx * s + dz * co; // 굴착기 로컬 (x 왼쪽, z 앞)
    let nx = 0, nz = 0;
    for (const [x0, x1, z0, z1] of CAR_BOXES) {
      const qx = Math.min(x1, Math.max(x0, lx)), qz = Math.min(z1, Math.max(z0, lz));
      let ex = lx - qx, ez = lz - qz;
      const d = Math.hypot(ex, ez);
      if (d >= R) continue;
      if (d < 1e-6) { // 상자 안: 가장 가까운 면으로
        const opts = [[x0 - lx, -1, 0], [x1 - lx, 1, 0], [z0 - lz, 0, -1], [z1 - lz, 0, 1]];
        opts.sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]));
        ex = opts[0][1]; ez = opts[0][2];
        lx = ex ? (ex < 0 ? x0 : x1) + ex * R : lx;
        lz = ez ? (ez < 0 ? z0 : z1) + ez * R : lz;
      } else {
        ex /= d; ez /= d;
        lx = qx + ex * R;
        lz = qz + ez * R;
      }
      nx = ex; nz = ez;
    }
    if (!nx && !nz) return null;
    this.pos.set(c.pos.x + lx * co + lz * s, c.pos.y - lx * s + lz * co);
    return new THREE.Vector2(nx * co + nz * s, -nx * s + nz * co);
  }

  // R: 멀리 둔 굴착기를 학생 옆으로 순간 이동. 돌려줌: 'ok' | 'near' | 'blocked'
  summon() {
    if (this.pos.distanceTo(this.car.pos) < WALK.summonDist) return 'near';
    const h = this.heading;
    for (const dist of [3.4, 6]) { // 가까우면 바로 E로 탈 수 있게
      for (const a of [-Math.PI / 2, Math.PI / 2, Math.PI, -Math.PI * 0.75, Math.PI * 0.75, 0]) {
        const x = this.pos.x + Math.sin(h + a) * dist, z = this.pos.y + Math.cos(h + a) * dist;
        const p = new THREE.Vector2(x, z);
        if (this.collider.resolve(p, 2.2) || this.inWater(x, z)) continue;
        const hs = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([u, v]) => heightAt(x + u, z + v));
        if (Math.max(...hs) - Math.min(...hs) > 1.2) continue; // 너무 기운 곳
        this.car.place(x, z, Math.sin(h), Math.cos(h));
        this.car.forwardSpeed = 0;
        return 'ok';
      }
    }
    return 'blocked';
  }

  // ---------- 몸짓 ----------

  setLimbs(armX, armZ, legX, legZ, k) {
    const d = this.driver;
    d.arms.forEach((g, i) => {
      const s = i ? 1 : -1;
      g.rotation.x += (armX - g.rotation.x) * k;
      g.rotation.z += (s * armZ - g.rotation.z) * k;
    });
    d.legs.forEach((g, i) => {
      const s = i ? 1 : -1;
      g.rotation.x += (legX - g.rotation.x) * k;
      g.rotation.z += (s * legZ - g.rotation.z) * k;
    });
  }

  // 2등신 뒤뚱 걷기: 몸을 좌우로 흔들고 팔다리를 엇갈려 흔든다. 달리면 더 빠르고 크게, 앞으로 기울임
  animate(dt) {
    const d = this.driver, r = d.root, t = this.time;
    const walkK = Math.min(1, this.speed / WALK.speed);
    const runK = THREE.MathUtils.clamp((this.speed - WALK.speed) / (WALK.run - WALK.speed), 0, 1);
    const before = Math.floor(this.phase / Math.PI);
    this.phase += dt * 6.8 * Math.sqrt(this.speed);
    if (Math.floor(this.phase / Math.PI) !== before && this.grounded && this.speed > 0.3) this.onStep?.(this.running);
    const s = Math.sin(this.phase), bob = Math.abs(s);
    const k = 1 - Math.exp(-dt * 25);

    const breathe = Math.sin(t * 2.4) * 0.008 * (1 - walkK);
    r.position.set(0, FOOT_LIFT + bob * 0.035 * walkK * (1 + runK) + breathe, 0);
    r.rotation.set(0.2 * runK, 0, s * (0.13 - 0.04 * runK) * walkK);

    if (!this.grounded) { // 공중: 앞발 벌리고 뒷발 살짝 웅크림
      this.setLimbs(-0.6, 0.9, -0.6, 0.12, k);
    } else {
      const sw = (0.5 + 0.4 * runK) * walkK;
      const d0 = d.arms[0], d1 = d.arms[1];
      d0.rotation.x += (s * sw - 0.25 * runK - d0.rotation.x) * k;
      d1.rotation.x += (-s * sw - 0.25 * runK - d1.rotation.x) * k;
      for (const [i, g] of d.arms.entries()) g.rotation.z += ((i ? 1 : -1) * (STAND.arm[1] + 0.25 * runK) - g.rotation.z) * k;
      const lw = (0.65 + 0.25 * runK) * walkK;
      d.legs[0].rotation.x += (-s * lw - d.legs[0].rotation.x) * k;
      d.legs[1].rotation.x += (s * lw - d.legs[1].rotation.x) * k;
      for (const [i, g] of d.legs.entries()) g.rotation.z += ((i ? 1 : -1) * STAND.leg[1] - g.rotation.z) * k;
    }

    // 서 있으면 가끔 두리번
    this.idle = this.moving || !this.grounded ? 0 : this.idle + dt;
    const L = this.look;
    L.timer -= dt;
    if (this.moving) L.goal = 0;
    else if (L.timer <= 0) {
      if (L.goal === 0 && this.idle > 1.5) { L.goal = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.35); L.timer = 1.1 + Math.random(); }
      else { L.goal = 0; L.timer = 2.5 + Math.random() * 3.5; }
    }
    L.cur += (L.goal - L.cur) * Math.min(1, dt * 4);
    d.head.rotation.set(bob * 0.04 * walkK, L.cur, -s * 0.05 * walkK);

    // 꼬리 살랑, 귀는 걸음에 맞춰 살짝 (위치·회전만)
    d.tail.rotation.set(0.5, Math.sin(t * (4 + this.speed * 2)) * (0.25 + 0.2 * walkK), 0);
    const amp = 0.05 + 0.12 * walkK + 0.1 * runK;
    d.ears.forEach((g, i) => {
      const e = i ? 1 : -1;
      g.rotation.z = -e * D.ear.droop + e * Math.sin(t * (8 + 8 * walkK) + i * 1.3) * amp;
      g.rotation.y = 0;
    });
  }
}

function lerp(a, b, k) { return a + (b - a) * k; }

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function bbox(pts) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
}
