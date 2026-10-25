// 미니 굴착기(미니 포크레인) 모델, 아케이드 주행, 부스터 게이지, 건물 충돌.
// 차량의 앞은 로컬 +z. heading h일 때 앞 방향 = (sin h, cos h) (x 동쪽, z 남쪽).
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { Driver } from './driver.js';
import { DRIVER } from './driver-config.js';

export const DRIVE = {
  maxSpeed: 60 / 3.6,    // 기본 최고 속도 (m/s)
  boostSpeed: 120 / 3.6, // 부스터 최고 속도
  reverseSpeed: 20 / 3.6,
  accel: 9,              // m/s²
  boostAccel: 24,
  brake: 22,
  coastDrag: 3.5,
  handbrake: 9,
  steerRate: 2.3,        // rad/s (저속 기준 최대 회전 속도)
  grip: 10,              // 옆 미끄러짐이 사라지는 빠르기
  driftGrip: 1.6,        // Space 누를 때
  radius: 1.9,           // 충돌 원 반지름 (m) — 앞으로 뻗은 팔까지 덮도록
  radiusOffset: 0.5,     // 충돌 원 중심을 앞으로 옮기는 거리 (m)
  wallMargin: 40,        // 캠퍼스 경계 밖으로 나갈 수 있는 거리 (m)
};

// 비탈: 궤도 앞뒤·좌우 땅 높이로 몸 전체를 기울이고, 오르막은 살짝 느리게·내리막은 살짝 빠르게
export const SLOPE = {
  halfLength: 1.5, // 궤도 앞뒤 끝까지 (m)
  halfWidth: 1.1,  // 좌우 궤도까지 (m)
  smooth: 8,       // 기울기가 따라가는 빠르기
  pull: 4.5,       // 경사 1(45°)일 때 앞뒤로 끌리는 가속도 (m/s²)
  topSpeed: 1.6,   // 경사 1당 최고 속도 변화 비율 (오르막 -, 내리막 +)
  // 수치지도 지형은 옹벽 자리에 짧고 가파른 단차가 있어, 주행만 부드럽게 (지형 모양은 그대로)
  maxSlope: 0.25,  // 속도 계산에 쓰는 경사 한도
  maxTilt: 0.32,   // 몸 기울기 한도 (rad, 약 18°)
  riseRate: 15,    // 땅이 높아질 때 따라 올라가는 빠르기
  fallRate: 9,     // 땅이 낮아질 때 따라 내려가는 빠르기
  maxSink: 0.25,   // 따라가는 동안 땅속으로 들어가도 되는 최대 깊이 (m)
};

export const BOOST = {
  fillTime: 15, // 빈 게이지가 저절로 가득 차는 시간 (s)
  useTime: 4,   // 가득 찬 게이지를 다 쓰는 시간 (s)
};

export const EXCAVATOR_COLOR = '#f5b82e';

// 궤도 고리: 앞뒤 휠 중심 사이 반 길이, 고리 반지름, 중심 높이
const TRACK = { half: 1.0, r: 0.34, y: 0.37, x: 0.72, cleats: 18 };
const WHEEL_R = 0.3;
// 팔 기본 각도 (rad, rotation.x): 붐은 앞위로, 암은 아래로 꺾이고, 버킷은 안쪽으로
const ARM_POSE = { boom: -0.75, stick: 1.95, bucket: 0.5 };

export class Car {
  constructor(color = EXCAVATOR_COLOR) {
    this.object = new THREE.Group();
    this.body = new THREE.Group();
    this.object.add(this.body);
    this.wheels = [];
    this.tracks = [];
    this.trackS = 0;
    this.spring = { boom: { x: 0, v: 0 }, stick: { x: 0, v: 0 }, bucket: { x: 0, v: 0 } };
    this.buildModel(color);

    this.pos = new THREE.Vector2();
    this.vel = new THREE.Vector2();
    this.heading = 0;
    this.slope = 0;   // 앞쪽이 높으면 + (높이차 / 거리)
    this.tilt = { x: 0, z: 0 };
    this.steer = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.braking = false;
    this.drifting = false;
    this.hitTimer = 0;

    this.boost = 1;          // 게이지 0~1 (처음엔 가득)
    this.boosting = false;
    this.boostLocked = false; // 게이지가 비면 Shift를 뗐다 다시 눌러야 함
    this.boostFx = 0;         // 효과 세기 0~1 (부드럽게 켜지고 꺼짐)
    this.onBoostStart = null; // 소리 연결용 (부스터 시작·끝, 충돌)
    this.onBoostEnd = null;
    this.onHit = null;
    this.throttle = false;
    this.puffPending = false;
    this.exhaust = new ExhaustFX(); // main에서 scene에 exhaust.group을 더한다

    this.prevSpeed = 0;
    this.accel = 0;
    this.time = 0;
  }

  buildModel(color) {
    const mat = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
    const box = (w, h, d, m, x, y, z, parent = this.body) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    this.paint = mat(color);
    const dark = mat('#3a3d44');
    const steel = mat('#9aa0a8');
    const rubber = mat('#232529');
    const glass = mat('#a9cfe8', { transparent: true, opacity: 0.38, depthWrite: false }); // 운전사 학생 얼굴이 유리 너머로 잘 보이게 옅게

    // ---- 궤도 (몸체 기울기와 상관없이 땅에 붙어 있게 object에 바로) ----
    const cleatGeo = new THREE.BoxGeometry(0.5, 0.07, 0.2);
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.46, 12).rotateZ(Math.PI / 2);
    for (const sx of [1, -1]) {
      box(0.4, 0.42, TRACK.half * 2, dark, sx * TRACK.x, TRACK.y, 0, this.object); // 궤도 틀
      for (const z of [-TRACK.half, TRACK.half]) {
        const wheel = new THREE.Group();
        wheel.position.set(sx * TRACK.x, TRACK.y, z);
        wheel.add(new THREE.Mesh(wheelGeo, steel));
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.1, 0.5), dark); // 도는 게 보이게
        wheel.add(spoke);
        this.object.add(wheel);
        this.wheels.push(wheel);
      }
      const cleats = new THREE.InstancedMesh(cleatGeo, rubber, TRACK.cleats);
      cleats.castShadow = true;
      cleats.frustumCulled = false;
      cleats.position.x = sx * TRACK.x;
      this.object.add(cleats);
      this.tracks.push(cleats);
    }
    this.updateTracks();

    // ---- 윗몸 (돌림판 위) ----
    const turntable = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 16), dark);
    turntable.position.y = 0.8;
    this.body.add(turntable);
    box(1.5, 0.56, 1.75, this.paint, 0, 1.15, -0.1);         // 몸체
    box(1.56, 0.52, 0.42, this.paint, 0, 1.12, -1.08);       // 뒤 균형추
    box(0.62, 0.3, 0.8, this.paint, -0.42, 1.57, -0.5);      // 엔진 덮개

    // 운전석 캐빈 (왼쪽 = 로컬 +x). 운전사 학생의 뿔이 지붕에 닿지 않게 높이 0.95 → 1.05m
    const cab = { x: 0.34, y: 1.95, z: 0.2, w: 0.8, h: 1.05, d: 0.95 };
    this.cab = cab;
    // 유리: 앞·뒤·오른쪽은 한 메시, 왼쪽(팔이 없는 쪽) 창은 고개 내밀 때 내려가도록 따로
    const pane = (w, h, d, x, z) => new THREE.BoxGeometry(w, h, d).translate(x, 0, z).toNonIndexed();
    const panes = [pane(cab.w - 0.06, cab.h, 0.03, cab.x, cab.z + cab.d / 2 - 0.03), pane(cab.w - 0.06, cab.h, 0.03, cab.x, cab.z - cab.d / 2 + 0.03),
      pane(0.03, cab.h, cab.d - 0.06, cab.x - cab.w / 2 + 0.03, cab.z)];
    const glassGeo = new THREE.BufferGeometry();
    for (const a of ['position', 'normal']) {
      glassGeo.setAttribute(a, new THREE.Float32BufferAttribute(panes.flatMap((g) => [...g.attributes[a].array]), 3));
    }
    const glassMesh = new THREE.Mesh(glassGeo, glass);
    glassMesh.position.y = cab.y;
    this.body.add(glassMesh);
    this.leftWindow = box(0.03, cab.h, cab.d - 0.06, glass, cab.x + cab.w / 2 - 0.03, cab.y, cab.z);
    this.cabin = [glassMesh, this.leftWindow];
    for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      this.cabin.push(box(0.07, cab.h, 0.07, this.paint, cab.x + px * cab.w / 2, cab.y, cab.z + pz * cab.d / 2));
    }
    this.cabin.push(box(cab.w + 0.12, 0.09, cab.d + 0.14, this.paint, cab.x, cab.y + cab.h / 2 + 0.04, cab.z));

    // 운전사: 황소 "학생" (driver.js). 운전석에 앉아 앞발굽을 조종 레버에
    this.driver = new Driver();
    this.driverAboard = true; // 자유 모드에서 E로 내리면 false (walker.js)
    this.door = 0;            // 타고 내릴 때 왼쪽 문 창 열림 0~1
    this.driver.object.position.set(...DRIVER.seat);
    this.body.add(this.driver.object);
    this.cabin.push(this.driver.object); // 운전석 시점에서는 숨김

    // 배기구 (위로 솟음) + 불꽃
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.75, 10), steel);
    pipe.position.set(-0.5, 1.95, -0.72);
    pipe.castShadow = true;
    this.body.add(pipe);
    this.exhaustTip = new THREE.Object3D(); // 불꽃·연기가 나오는 자리 (입자는 ExhaustFX가 월드에 뿌림)
    this.exhaustTip.position.set(-0.5, 2.35, -0.72);
    this.body.add(this.exhaustTip);

    // 브레이크등 (균형추 뒤)
    this.brakeMat = mat('#c0262c', { emissive: '#ff2020', emissiveIntensity: 0.15 });
    for (const x of [-0.55, 0.55]) box(0.24, 0.12, 0.05, this.brakeMat, x, 1.2, -1.31);

    // ---- 팔: 붐 → 암 → 버킷 (각 마디가 스프링으로 흔들림) ----
    this.boomPivot = new THREE.Group();
    this.boomPivot.position.set(-0.3, 1.25, 0.72);
    this.body.add(this.boomPivot);
    box(0.24, 0.26, 1.6, this.paint, 0, 0, 0.8, this.boomPivot);
    box(0.08, 0.08, 1.1, steel, 0, 0.18, 0.6, this.boomPivot); // 유압 실린더

    this.stickPivot = new THREE.Group();
    this.stickPivot.position.set(0, 0, 1.6);
    this.boomPivot.add(this.stickPivot);
    box(0.2, 0.22, 1.25, this.paint, 0, 0, 0.62, this.stickPivot);

    this.bucketPivot = new THREE.Group();
    this.bucketPivot.position.set(0, 0, 1.25);
    this.stickPivot.add(this.bucketPivot);
    box(0.72, 0.08, 0.5, dark, 0, -0.04, 0.22, this.bucketPivot);   // 바닥
    box(0.72, 0.42, 0.08, dark, 0, 0.17, 0.02, this.bucketPivot);   // 뒤판
    for (const sx of [-1, 1]) box(0.06, 0.36, 0.48, dark, sx * 0.36, 0.12, 0.22, this.bucketPivot); // 옆판
    for (let i = 0; i < 4; i++) box(0.08, 0.06, 0.14, steel, -0.27 + i * 0.18, -0.04, 0.53, this.bucketPivot); // 이빨
    this.poseArm();
  }

  setColor(color) {
    this.paint.color.set(color);
  }

  // 운전석 시점에서는 캐빈(유리·기둥·지붕)을 숨겨 앞이 보이게
  setCockpitView(on) {
    for (const m of this.cabin) m.visible = !on;
  }

  // 부스터 게이지 채우기 (amount: 0~1, 1이면 가득). 지각 모드의 미션 완료 보상에 쓴다
  addBoost(amount = 1) {
    this.boost = Math.min(1, this.boost + amount);
  }

  get boostReady() {
    return this.boost >= 1;
  }

  place(x, z, dirX, dirZ) {
    this.pos.set(x, z);
    this.vel.set(0, 0);
    this.heading = Math.atan2(dirX, dirZ);
    this.syncObject(true);
  }

  get speedKmh() {
    return Math.abs(this.forwardSpeed) * 3.6;
  }

  forward() {
    return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading));
  }

  // input: { up, down, left, right, drift, boost } (불리언)
  update(dt, input, collider) {
    const D = DRIVE;
    this.updateBoost(dt, input.boost);

    const f = this.forward();
    const r = new THREE.Vector2(f.y, -f.x); // 옆 방향 (차량 기준 왼쪽)
    let fs = this.vel.dot(f);
    let lat = this.vel.dot(r);

    const throttle = input.up || this.boosting; // 부스터는 Shift만 눌러도 앞으로
    // 멈춰 있다가 가속을 시작하는 순간 배기구에서 검은 디젤 연기 "푹"
    if (throttle && !this.throttle && Math.abs(fs) < 1) this.puffPending = true;
    this.throttle = throttle;
    const slopeK = THREE.MathUtils.clamp(1 - this.slope * SLOPE.topSpeed, 0.85, 1.15);
    const top = (this.boosting ? D.boostSpeed : D.maxSpeed) * slopeK;
    this.braking = false;

    if (throttle) {
      if (fs < -0.5) { fs += D.brake * dt; this.braking = true; }
      else if (fs < top) fs = Math.min(top, fs + (this.boosting ? D.boostAccel : D.accel) * dt);
      else fs = Math.max(top, fs - D.coastDrag * 2 * dt); // 부스터 끝나면 천천히 줄어듦
    } else if (input.down) {
      if (fs > 0.5) { fs -= D.brake * dt; this.braking = true; }
      else fs = Math.max(-D.reverseSpeed, fs - D.accel * 0.7 * dt);
    } else {
      fs -= Math.sign(fs) * Math.min(Math.abs(fs), D.coastDrag * dt);
    }

    if (Math.abs(fs) > 0.3 || throttle) fs -= this.slope * SLOPE.pull * dt; // 멈춰 있을 땐 미끄러지지 않게

    this.drifting = input.drift && Math.abs(fs) > 4;
    if (input.drift) {
      fs -= Math.sign(fs) * Math.min(Math.abs(fs), D.handbrake * dt);
      this.braking = true;
    }

    // 조향: 입력을 부드럽게, 빠를수록 조금 덜 꺾임, 후진하면 반대로
    const target = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    this.steer += (target - this.steer) * Math.min(1, dt * 8);
    const speedFactor = Math.min(1, Math.abs(fs) / 5) * (1 - 0.35 * Math.min(1, Math.abs(fs) / D.boostSpeed));
    const yaw = this.steer * D.steerRate * speedFactor * Math.sign(fs) * (this.drifting ? 1.35 : 1);
    this.heading += yaw * dt;

    // 옆 미끄러짐: 평소엔 금방 사라지고, 드리프트 중엔 오래 남음
    lat *= Math.exp(-(this.drifting ? D.driftGrip : D.grip) * dt);

    const nf = this.forward();
    const nr = new THREE.Vector2(nf.y, -nf.x);
    this.vel.copy(nf).multiplyScalar(fs).addScaledVector(nr, lat);
    this.pos.addScaledVector(this.vel, dt);

    if (collider) {
      // 충돌 원은 팔까지 덮도록 중심을 앞으로 옮겨서 검사
      const center = this.pos.clone().addScaledVector(nf, D.radiusOffset);
      const n = collider.resolve(center, D.radius);
      if (n) {
        this.pos.copy(center).addScaledVector(nf, -D.radiusOffset);
        const vn = this.vel.dot(n);
        if (vn < 0 && collider.lastQuiet) {
          // 기념물: 튕기거나 소리 내지 않고 그 자리에서 조용히 멈춤
          this.vel.addScaledVector(n, -vn);
          this.vel.multiplyScalar(0.3);
        } else if (vn < 0) {
          this.vel.addScaledVector(n, -vn * 1.25); // 벽 쪽 속도를 없애고 살짝 튕김
          this.vel.multiplyScalar(0.8);
          if (vn < -3 && this.hitTimer === 0) this.onHit?.(Math.min(1, -vn / 15)); // 충돌음 (세기 0~1)
          if (vn < -3) this.hitTimer = 0.3;
        }
      }
      const w = collider.boundaryWall(this.pos, D.wallMargin);
      if (w) {
        const vn = this.vel.dot(w);
        if (vn < 0) this.vel.addScaledVector(w, -vn);
      }
    }

    this.forwardSpeed = this.vel.dot(nf);
    this.lateralSpeed = this.vel.dot(nr);
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.animate(dt);
    this.syncObject(false, dt);
    this.updateExhaust(dt);
  }

  updateBoost(dt, held) {
    if (!held) this.boostLocked = false;
    const was = this.boosting;
    this.boosting = held && !this.boostLocked && this.boost > 0;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - dt / BOOST.useTime);
      if (this.boost === 0) this.boostLocked = true; // 비면 끝
    } else {
      this.boost = Math.min(1, this.boost + dt / BOOST.fillTime);
    }
    if (this.boosting && !was) this.onBoostStart?.();
    if (!this.boosting && was) this.onBoostEnd?.();
    // 효과는 빨리 켜지고 천천히 꺼진다
    const goal = this.boosting ? 1 : 0;
    this.boostFx += (goal - this.boostFx) * Math.min(1, dt * (this.boosting ? 6 : 2.2));
  }

  animate(dt) {
    this.time += dt;

    // 궤도: 위쪽은 앞으로, 아래쪽은 뒤로 (땅에 붙어 있는 것처럼)
    this.trackS += this.forwardSpeed * dt;
    this.updateTracks();
    const spin = (this.forwardSpeed * dt) / WHEEL_R;
    for (const w of this.wheels) w.rotation.x += spin;

    // 앞뒤 가속도 → 팔 스프링 (가속하면 뒤로 젖혀지고, 브레이크·충돌하면 앞으로 출렁)
    const a = (this.forwardSpeed - this.prevSpeed) / Math.max(dt, 1e-4);
    this.prevSpeed = this.forwardSpeed;
    this.accel += (a - this.accel) * Math.min(1, dt * 12);
    const S = this.spring;
    const flutter = this.boosting ? Math.sin(this.time * 34) * 22 + Math.sin(this.time * 13) * 10 : 0;
    step(S.boom, 40, 5, -this.accel * 0.8, dt, 0.45);
    step(S.stick, 55, 5, -this.accel * 1.2, dt, 0.6);
    step(S.bucket, 70, 3, -this.accel * 1.5 + flutter, dt, 0.8);
    this.poseArm();

    // 몸체가 살짝 기울어 귀엽게
    const roll = THREE.MathUtils.clamp(-this.lateralSpeed * 0.02 + this.steer * this.forwardSpeed * 0.004, -0.12, 0.12);
    this.body.rotation.z += (roll - this.body.rotation.z) * Math.min(1, dt * 6);
    const pitch = this.braking ? 0.05 : (this.boosting ? -0.05 : 0);
    this.body.rotation.x += (pitch - this.body.rotation.x) * Math.min(1, dt * 6);
    this.brakeMat.emissiveIntensity = this.braking ? 2.5 : 0.15;

    // 운전사 학생 (표정·고개 내밀기·귀 펄럭임), 고개를 내밀면 왼쪽 창이 내려감
    // 학생이 내려서 걷는 중이면 운전석은 비어 있고(의자·레버만), 타고 내릴 때 왼쪽 문 창을 내린다
    if (this.driverAboard) this.driver.update(dt, this.forwardSpeed);
    const open = 1 - Math.max(this.driverAboard ? this.driver.peek : 0, this.door) * 0.95; // 창을 아래 틀 쪽으로 접어 내림
    this.leftWindow.scale.y = open;
    this.leftWindow.position.y = this.cab.y - (this.cab.h / 2) * (1 - open);

  }

  // 배기구 불꽃·연기 (syncObject 뒤에 불러야 배기구 위치가 맞다)
  updateExhaust(dt) {
    this.object.updateMatrixWorld(true);
    this.exhaustTip.getWorldPosition(tmpVec);
    const f = this.forward();
    if (this.puffPending) { this.exhaust.puff(tmpVec, f); this.puffPending = false; }
    this.exhaust.update(dt, tmpVec, f, this.boostFx);
  }

  poseArm() {
    this.boomPivot.rotation.x = ARM_POSE.boom + this.spring.boom.x;
    this.stickPivot.rotation.x = ARM_POSE.stick + this.spring.stick.x;
    this.bucketPivot.rotation.x = ARM_POSE.bucket + this.spring.bucket.x;
  }

  // 궤도 무늬 조각들을 고리(위 직선 → 앞 반원 → 아래 직선 → 뒤 반원)를 따라 배치
  updateTracks() {
    const { half: a, r: R, y: y0, cleats: n } = TRACK;
    const P = 4 * a + 2 * Math.PI * R;
    const m = tmpMatrix, q = tmpQuat, p = tmpVec;
    for (let i = 0; i < n; i++) {
      let s = (((this.trackS + (i * P) / n) % P) + P) % P;
      let y, z, ny, nz;
      if (s < 2 * a) { y = y0 + R; z = -a + s; ny = 1; nz = 0; }
      else if ((s -= 2 * a) < Math.PI * R) { const t = s / R; ny = Math.cos(t); nz = Math.sin(t); y = y0 + R * ny; z = a + R * nz; }
      else if ((s -= Math.PI * R) < 2 * a) { y = y0 - R; z = a - s; ny = -1; nz = 0; }
      else { const t = (s - 2 * a) / R; ny = -Math.cos(t); nz = -Math.sin(t); y = y0 + R * ny; z = -a + R * nz; }
      q.setFromAxisAngle(X_AXIS, Math.atan2(nz, ny));
      m.compose(p.set(0, y, z), q, ONE);
      for (const t of this.tracks) t.setMatrixAt(i, m);
    }
    for (const t of this.tracks) t.instanceMatrix.needsUpdate = true;
  }

  // 땅 높이에 올려놓고, 궤도 앞뒤·좌우 땅 높이로 기울인다 (snap이면 바로, 아니면 부드럽게)
  syncObject(snap = false, dt = 1 / 60) {
    const { x, y: z } = this.pos;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const L = SLOPE.halfLength, W = SLOPE.halfWidth;
    const hf = heightAt(x + fx * L, z + fz * L), hb = heightAt(x - fx * L, z - fz * L);
    const hl = heightAt(x + fz * W, z - fx * W), hr = heightAt(x - fz * W, z + fx * W); // 왼쪽 = 로컬 +x
    const clamp = THREE.MathUtils.clamp;
    this.slope = clamp((hf - hb) / (2 * L), -SLOPE.maxSlope, SLOPE.maxSlope);
    const pitch = clamp(-Math.atan((hf - hb) / (2 * L)), -SLOPE.maxTilt, SLOPE.maxTilt);
    const roll = clamp(Math.atan((hl - hr) / (2 * W)), -SLOPE.maxTilt, SLOPE.maxTilt);
    const k = snap ? 1 : Math.min(1, dt * SLOPE.smooth);
    this.tilt.x += (pitch - this.tilt.x) * k;
    this.tilt.z += (roll - this.tilt.z) * k;
    // 높이: 단차에서 튀지 않게 부드럽게 따라가되 땅속으로는 maxSink 넘게 들어가지 않음
    const ground = heightAt(x, z);
    if (snap || this.groundY === undefined) this.groundY = ground;
    else {
      const rate = ground > this.groundY ? SLOPE.riseRate : SLOPE.fallRate;
      this.groundY += (ground - this.groundY) * Math.min(1, dt * rate);
      this.groundY = Math.max(this.groundY, ground - SLOPE.maxSink);
    }
    this.object.position.set(x, this.groundY, z);
    this.object.rotation.set(this.tilt.x, this.heading, this.tilt.z, 'YXZ');
  }
}

// 배기구 불꽃·연기 입자. 월드 좌표에 뿌려서 굴착기가 달리면 뒤로 꼬리처럼 남는다.
// 불꽃: 크기·밝기 무작위의 작은 조각(주황~노랑, 가산 혼합)이 깜빡이며 위·뒤로 → 끝에서 연한 연기로.
// 디젤 연기: 정지 상태에서 가속을 시작할 때 검은 연기 "푹".
class ExhaustFX {
  constructor() {
    this.group = new THREE.Group();
    const tex = softDotTexture();
    const pool = (n, blending) => Array.from({ length: n }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending }));
      s.visible = false;
      s.userData = { life: 0, max: 1, vel: new THREE.Vector3(), size: 1, grow: 0 };
      this.group.add(s);
      return s;
    });
    this.fire = pool(36, THREE.AdditiveBlending);
    this.smoke = pool(48, THREE.NormalBlending);
    this.fireAcc = 0;
  }

  take(list) {
    return list.find((s) => !s.visible) || list[Math.floor(Math.random() * list.length)];
  }

  spawnSmoke(pos, vel, color, size, grow, life, opacity) {
    const s = this.take(this.smoke);
    Object.assign(s.userData, { life: 0, max: life, size, grow, opacity });
    s.userData.vel.copy(vel);
    s.position.copy(pos);
    s.material.color.set(color);
    s.visible = true;
  }

  puff(pos, forward) {
    for (let i = 0; i < 10; i++) {
      tmpV.set(-forward.x * 1.5 + rnd(1), 2 + Math.random() * 1.5, -forward.y * 1.5 + rnd(1));
      this.spawnSmoke(pos, tmpV, i % 3 ? '#2a2a2a' : '#454545', 0.5 + Math.random() * 0.3, 1.8, 0.9 + Math.random() * 0.5, 0.85);
    }
  }

  update(dt, pos, forward, boostFx) {
    this.fireAcc += dt * 80 * boostFx;
    while (this.fireAcc >= 1) {
      this.fireAcc -= 1;
      const s = this.take(this.fire);
      const u = s.userData;
      Object.assign(u, { life: 0, max: 0.12 + Math.random() * 0.22, size: 0.25 + Math.random() * 0.45, bright: 0.6 + Math.random() * 0.4 });
      u.vel.set(-forward.x * (3 + Math.random() * 3) + rnd(1.2), 4 + Math.random() * 4, -forward.y * (3 + Math.random() * 3) + rnd(1.2));
      s.position.set(pos.x + rnd(0.08), pos.y, pos.z + rnd(0.08));
      u.hue = Math.random(); // 0 주황 ~ 1 노랑
      s.visible = true;
    }
    for (const s of this.fire) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life += dt;
      const k = u.life / u.max;
      if (k >= 1) { // 끝에서 연기로 흩어짐
        s.visible = false;
        if (Math.random() < 0.5) {
          tmpV.copy(u.vel).multiplyScalar(0.25);
          tmpV.y += 1;
          this.spawnSmoke(s.position, tmpV, '#8f8f8f', u.size * 1.2, 1.4, 0.7 + Math.random() * 0.4, 0.4);
        }
        continue;
      }
      s.position.addScaledVector(u.vel, dt);
      const flicker = 0.7 + Math.random() * 0.6;
      s.scale.setScalar(u.size * (1 + k * 0.6) * flicker);
      s.material.color.copy(FIRE_ORANGE).lerp(FIRE_YELLOW, u.hue * (1 - k * 0.7));
      s.material.opacity = u.bright * (1 - k) * flicker;
    }
    for (const s of this.smoke) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life += dt;
      const k = u.life / u.max;
      if (k >= 1) { s.visible = false; continue; }
      u.vel.multiplyScalar(Math.exp(-dt * 1.5));
      s.position.addScaledVector(u.vel, dt);
      s.scale.setScalar(u.size * (1 + k * u.grow));
      s.material.opacity = u.opacity * (1 - k) * Math.min(1, k * 8);
    }
  }
}

const FIRE_ORANGE = new THREE.Color('#ff5a10');
const FIRE_YELLOW = new THREE.Color('#ffd23a');
const tmpV = new THREE.Vector3();
const rnd = (a) => (Math.random() - 0.5) * 2 * a;

// 가운데가 진하고 가장자리가 투명한 동그라미 (입자 모양)
function softDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpVec = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const ONE = new THREE.Vector3(1, 1, 1);

// 감쇠 스프링 한 걸음: 힘 → 각도 변위 x (최대 ±limit)
function step(s, k, c, force, dt, limit) {
  s.v += (-k * s.x - c * s.v + force) * dt;
  s.x = THREE.MathUtils.clamp(s.x + s.v * dt, -limit, limit);
}

// 건물 외곽선과 캠퍼스 경계로 차(원)를 밀어내는 충돌 처리.
// 모든 건물 변을 격자 칸에 나눠 담아 가까운 변만 검사한다.
export class Collider {
  constructor(campus, cell = 16) {
    this.cell = cell;
    this.grid = new Map();
    this.edges = []; // [x1, z1, x2, z2, 건물 번호]
    this.buildings = [];
    for (const b of campus.buildings) this.addObstacle(b.outline, b.name);
    this.boundary = campus.boundary;
    this.query = 0;
  }

  // 건물이 아닌 장애물(정문 기둥 등)도 같은 방식으로 넣는다
  // quiet: 부딪혀도 튕김·충돌음·웃긴 반응 없이 조용히 멈추는 장애물 (기념물)
  // 돌려준 번호로 setEnabled(번호들, false)하면 그 장애물을 잠시 뺀다
  addObstacle(outline, name = '', { quiet = false } = {}) {
    const bi = this.buildings.push({ name, quiet, off: false }) - 1;
    for (let i = 0; i < outline.length; i++) {
      const [x1, z1] = outline[i];
      const [x2, z2] = outline[(i + 1) % outline.length];
      this.addEdge([x1, z1, x2, z2, bi]);
    }
    return bi;
  }

  setEnabled(ids, on) {
    for (const i of ids) this.buildings[i].off = !on;
  }

  addEdge(e) {
    const idx = this.edges.push(e) - 1;
    const c = this.cell;
    const x0 = Math.floor(Math.min(e[0], e[2]) / c), x1 = Math.floor(Math.max(e[0], e[2]) / c);
    const z0 = Math.floor(Math.min(e[1], e[3]) / c), z1 = Math.floor(Math.max(e[1], e[3]) / c);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = key(x, z);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(idx);
      }
    }
  }

  // (x, z)에서 r 안쪽 칸들의 변을 중복 없이 하나씩 넘겨 준다
  forEachEdge(x, z, r, fn) {
    const c = this.cell;
    if (!this.stamp || this.stamp.length < this.edges.length) this.stamp = new Uint32Array(this.edges.length);
    const q = ++this.query;
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++) {
      for (let gz = Math.floor((z - r) / c); gz <= Math.floor((z + r) / c); gz++) {
        const list = this.grid.get(key(gx, gz));
        if (!list) continue;
        for (const i of list) {
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          fn(this.edges[i]);
        }
      }
    }
  }

  // pos(Vector2)를 건물 밖으로 밀어낸다. 부딪혔으면 밀어낸 방향(단위 벡터)을 돌려줌
  resolve(pos, radius) {
    let hit = null;
    this.lastQuiet = true; // 이번에 부딪힌 것이 모두 조용한 장애물(기념물)인지
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.forEachEdge(pos.x, pos.y, radius, (e) => {
        if (this.buildings[e[4]].off) return;
        const [qx, qz] = closestOnSegment(pos.x, pos.y, e);
        let dx = pos.x - qx, dz = pos.y - qz;
        const d = Math.hypot(dx, dz);
        if (d >= radius) return;
        if (d < 1e-6) { dx = -(e[3] - e[1]); dz = e[2] - e[0]; } // 변 위에 정확히 있으면 변의 법선
        const len = Math.hypot(dx, dz);
        dx /= len; dz /= len;
        pos.x += dx * (radius - d);
        pos.y += dz * (radius - d);
        hit = (hit || new THREE.Vector2()).set(dx, dz);
        if (!this.buildings[e[4]].quiet) this.lastQuiet = false;
        moved = true;
      });
      if (!moved) break;
    }
    return hit;
  }

  // 경계에서 margin보다 멀리 나가면 되돌린다. 되돌렸으면 안쪽 방향을 돌려줌
  boundaryWall(pos, margin) {
    if (pointInPolygon(pos.x, pos.y, this.boundary)) return null;
    let best = Infinity, bx = 0, bz = 0;
    const o = this.boundary;
    for (let i = 0; i < o.length; i++) {
      const e = [o[i][0], o[i][1], o[(i + 1) % o.length][0], o[(i + 1) % o.length][1]];
      const [qx, qz] = closestOnSegment(pos.x, pos.y, e);
      const d = Math.hypot(pos.x - qx, pos.y - qz);
      if (d < best) { best = d; bx = qx; bz = qz; }
    }
    if (best <= margin) return null;
    const nx = (bx - pos.x) / best, nz = (bz - pos.y) / best;
    pos.x = bx - nx * margin;
    pos.y = bz - nz * margin;
    return new THREE.Vector2(nx, nz);
  }

  // maxDist 안에서 가장 가까운 이름 있는 건물
  nearestNamed(x, z, maxDist) {
    let best = maxDist, name = null;
    this.forEachEdge(x, z, maxDist, (e) => {
      const b = this.buildings[e[4]];
      if (!b.name) return;
      const [qx, qz] = closestOnSegment(x, z, e);
      const d = Math.hypot(x - qx, z - qz);
      if (d < best) { best = d; name = b.name; }
    });
    return name;
  }
}

function key(x, z) {
  return x * 73856093 ^ z * 19349663;
}

function closestOnSegment(px, pz, e) {
  const [x1, z1, x2, z2] = e;
  const dx = x2 - x1, dz = z2 - z1;
  const L = dx * dx + dz * dz;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L));
  return [x1 + t * dx, z1 + t * dz];
}

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < xi + ((z - zi) * (xj - xi)) / (zj - zi)) inside = !inside;
  }
  return inside;
}
