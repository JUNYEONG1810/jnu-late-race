// 미니 굴착기(미니 포크레인) 모델, 아케이드 주행, 부스터 게이지, 건물 충돌.
// 차량의 앞은 로컬 +z. heading h일 때 앞 방향 = (sin h, cos h) (x 동쪽, z 남쪽).
import * as THREE from 'three';

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
    this.onBoostStart = null;

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
    const glass = mat('#7fb0d6', { transparent: true, opacity: 0.75 });

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

    // 운전석 캐빈 (왼쪽 = 로컬 +x)
    const cab = { x: 0.34, y: 1.9, z: 0.2, w: 0.8, h: 0.95, d: 0.95 };
    this.cabin = [box(cab.w - 0.06, cab.h, cab.d - 0.06, glass, cab.x, cab.y, cab.z)];
    for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      this.cabin.push(box(0.07, cab.h, 0.07, this.paint, cab.x + px * cab.w / 2, cab.y, cab.z + pz * cab.d / 2));
    }
    this.cabin.push(box(cab.w + 0.12, 0.09, cab.d + 0.14, this.paint, cab.x, cab.y + cab.h / 2 + 0.04, cab.z));

    // 배기구 (위로 솟음) + 불꽃
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.75, 10), steel);
    pipe.position.set(-0.5, 1.95, -0.72);
    pipe.castShadow = true;
    this.body.add(pipe);
    this.flame = this.buildFlame();
    this.flame.position.set(-0.5, 2.33, -0.72);
    this.body.add(this.flame);

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

  buildFlame() {
    const group = new THREE.Group();
    group.rotation.x = -0.55; // 위·뒤로 기울여 뿜음
    const fire = (r, h, c) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10).translate(0, h / 2, 0),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false }));
      group.add(m);
      return m;
    };
    // 밝은 하늘 앞에서도 주황이 보이도록 일반 합성(가산 합성은 하얗게 날아감)
    fire(0.3, 1.9, '#ff5a14');
    fire(0.18, 1.2, '#ffb02e');
    fire(0.09, 0.7, '#fff3a0');
    group.visible = false;
    return group;
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
    this.syncObject();
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
    const top = this.boosting ? D.boostSpeed : D.maxSpeed;
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
        if (vn < 0) {
          this.vel.addScaledVector(n, -vn * 1.25); // 벽 쪽 속도를 없애고 살짝 튕김
          this.vel.multiplyScalar(0.8);
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
    this.syncObject();
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
    if (this.boosting && !was && this.onBoostStart) this.onBoostStart();
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

    // 배기구 불꽃: 부스터 세기만큼, 매 프레임 조금씩 일렁임
    const fx = this.boostFx;
    this.flame.visible = fx > 0.03;
    if (this.flame.visible) {
      const flick = 0.75 + Math.random() * 0.5;
      this.flame.scale.set(fx * (0.8 + Math.random() * 0.3), fx * flick, fx * (0.8 + Math.random() * 0.3));
    }
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

  syncObject() {
    this.object.position.set(this.pos.x, 0, this.pos.y);
    this.object.rotation.y = this.heading;
  }
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
  addObstacle(outline, name = '') {
    const bi = this.buildings.push({ name }) - 1;
    for (let i = 0; i < outline.length; i++) {
      const [x1, z1] = outline[i];
      const [x2, z2] = outline[(i + 1) % outline.length];
      this.addEdge([x1, z1, x2, z2, bi]);
    }
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
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.forEachEdge(pos.x, pos.y, radius, (e) => {
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

function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < xi + ((z - zi) * (xj - xi)) / (zj - zi)) inside = !inside;
  }
  return inside;
}
