// 귀여운 저폴리 차, 아케이드 주행, 건물 충돌.
// 차의 앞은 로컬 +z. heading h일 때 앞 방향 = (sin h, cos h) (x 동쪽, z 남쪽).
import * as THREE from 'three';

export const DRIVE = {
  maxSpeed: 60 / 3.6,    // 기본 최고 속도 (m/s)
  boostSpeed: 85 / 3.6,  // Shift 부스트 최고 속도
  reverseSpeed: 20 / 3.6,
  accel: 9,              // m/s²
  boostAccel: 14,
  brake: 22,
  coastDrag: 3.5,
  handbrake: 9,
  steerRate: 2.3,        // rad/s (저속 기준 최대 회전 속도)
  grip: 10,              // 옆 미끄러짐이 사라지는 빠르기
  driftGrip: 1.6,        // Space 누를 때
  radius: 1.6,           // 충돌 원 반지름 (m)
  wallMargin: 40,        // 캠퍼스 경계 밖으로 나갈 수 있는 거리 (m)
};

const WHEEL_R = 0.38;

export class Car {
  constructor(color = '#ff7b7b') {
    this.object = new THREE.Group();
    this.body = new THREE.Group();
    this.object.add(this.body);
    this.wheels = [];
    this.frontPivots = [];
    this.buildModel(color);

    this.pos = new THREE.Vector2();
    this.vel = new THREE.Vector2();
    this.heading = 0;
    this.steer = 0;
    this.forwardSpeed = 0;
    this.braking = false;
    this.drifting = false;
    this.boosting = false;
    this.hitTimer = 0;
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
    const glass = mat('#4f6f94');
    const dark = mat('#3a3f48');
    const white = mat('#fbfbf6');

    box(1.84, 0.62, 3.5, this.paint, 0, 0.7, 0);          // 차체
    this.cabin = [
      box(1.6, 0.58, 1.85, glass, 0, 1.28, -0.25),        // 유리 부분
      box(1.66, 0.14, 1.95, this.paint, 0, 1.62, -0.25),  // 지붕
    ];
    box(1.9, 0.26, 0.3, dark, 0, 0.5, 1.72);              // 앞 범퍼
    box(1.9, 0.26, 0.3, dark, 0, 0.5, -1.72);             // 뒤 범퍼
    for (const x of [-0.6, 0.6]) box(0.36, 0.18, 0.06, white, x, 0.82, 1.76); // 전조등

    this.brakeMat = mat('#c0262c', { emissive: '#ff2020', emissiveIntensity: 0.15 });
    for (const x of [-0.65, 0.65]) box(0.4, 0.16, 0.06, this.brakeMat, x, 0.84, -1.76);

    const tireGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 14).rotateZ(Math.PI / 2);
    const hubGeo = new THREE.BoxGeometry(0.32, 0.08, 0.5);
    const tireMat = mat('#2c2f36');
    const hubMat = mat('#d9dde3');
    for (const [x, z, front] of [[0.86, 1.15, true], [-0.86, 1.15, true], [0.86, -1.15, false], [-0.86, -1.15, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, WHEEL_R, z);
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, hubMat); // 돌아가는 게 보이도록 바퀴 휠에 막대
      hub.position.x = Math.sign(x) * 0.12;
      wheel.add(tire, hub);
      pivot.add(wheel);
      this.object.add(pivot);
      this.wheels.push(wheel);
      if (front) this.frontPivots.push(pivot);
    }
  }

  setColor(color) {
    this.paint.color.set(color);
  }

  // 운전석 시점에서는 유리와 지붕을 숨겨 앞이 보이게
  setCockpitView(on) {
    for (const m of this.cabin) m.visible = !on;
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
    const f = this.forward();
    const r = new THREE.Vector2(f.y, -f.x); // 옆 방향 (차 기준 왼쪽)
    let fs = this.vel.dot(f);
    let lat = this.vel.dot(r);

    this.boosting = input.boost && input.up;
    const top = this.boosting ? D.boostSpeed : D.maxSpeed;
    this.braking = false;

    if (input.up) {
      if (fs < -0.5) { fs += D.brake * dt; this.braking = true; }
      else if (fs < top) fs = Math.min(top, fs + (this.boosting ? D.boostAccel : D.accel) * dt);
      else fs = Math.max(top, fs - D.coastDrag * dt); // 부스트 끝나면 천천히 줄어듦
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
      const n = collider.resolve(this.pos, D.radius);
      if (n) {
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

  animate(dt) {
    const spin = (this.forwardSpeed * dt) / WHEEL_R;
    for (const w of this.wheels) w.rotation.x += spin;
    for (const p of this.frontPivots) p.rotation.y = this.steer * 0.45;
    // 차체가 살짝 기울어 귀엽게
    const roll = THREE.MathUtils.clamp(-this.lateralSpeed * 0.02 + this.steer * this.forwardSpeed * 0.004, -0.12, 0.12);
    this.body.rotation.z += (roll - this.body.rotation.z) * Math.min(1, dt * 6);
    const pitch = this.braking ? 0.05 : (this.boosting ? -0.04 : 0);
    this.body.rotation.x += (pitch - this.body.rotation.x) * Math.min(1, dt * 6);
    this.brakeMat.emissiveIntensity = this.braking ? 2.5 : 0.15;
  }

  syncObject() {
    this.object.position.set(this.pos.x, 0, this.pos.y);
    this.object.rotation.y = this.heading;
  }
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
