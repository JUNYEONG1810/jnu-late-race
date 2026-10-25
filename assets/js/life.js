// 생동감: 주차장의 주차 차량(충돌 있음), 순환 도로를 천천히 도는 셔틀버스(굴착기가 다가오면 멈춤),
// 보행로를 걷는 학생(굴착기가 다가오면 미리 비켜서 절대 닿지 않음). 브랜드·로고 없음.
// 모두 InstancedMesh로 몇 번의 그리기 호출만 쓴다. 기본은 꺼짐(설정 "사람·차"로 켬), 품질 낮음에서는 학생·버스 수를 줄인다.
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { orientedRect, rectPoint, pointInPolygon, mulberry32, freeAfterUpload } from './map.js';

const PARK = { fill: 0.35, stall: 2.5, depth: 5, len: 4.3, wid: 1.8, clear: 14 }; // 주차 칸에 차가 있을 비율(임의), 칸 크기, 차 크기, 미션 장소·출발점 둘레 비움
const CAR_COLORS = ['#f4f4f2', '#f4f4f2', '#c9ccd0', '#c9ccd0', '#2b2e33', '#5b6068', '#3a5a8c', '#9b2f2f', '#d8d2c2'];
const BUS = { speed: 6.5, accel: 2.5, stopAhead: 16, stopNear: 9, len: 9, wid: 2.4, h: 3.0, loop: [900, 4000], best: 2000 };
const STU = { high: 24, low: 10, speed: 1.25, dodge: 12, look: 2.0, side: 5.0, sideSpeed: 6.5, safe: 3.4, missionClear: 9 }; // 비키기: 굴착기 앞 look초 경로가 dodge m 안이면 옆으로 side m, 마지막 안전 거리 safe m
const SHIRTS = ['#e85d4a', '#3f7fd9', '#f2b632', '#3fae6a', '#8e5bd1', '#f08ab0', '#ffffff', '#2fb5b0'];
const PANTS = ['#2f3a56', '#3b3b3b', '#6b5a48', '#4a6b8c'];
const HAIR = ['#2a211c', '#3b2a20', '#1d1a19', '#5a3b22'];
const BAGS = ['#2d4f8f', '#c4473a', '#2f2f2f', '#3d7a4a', '#d9a531'];
const SKIN = '#f2cfae';

export function buildLife(scene, campus, collider, { avoidPoints = [] } = {}) {
  const rand = mulberry32(31337);
  const group = new THREE.Group();
  scene.add(group);
  const avoid = (x, z, r) => avoidPoints.some(([ax, az]) => Math.hypot(ax - x, az - z) < r);

  const parked = buildParkedCars(campus, collider, rand, avoid);
  group.add(parked.mesh);

  const route = findLoop(campus);
  const buses = buildBuses(route, rand);
  group.add(buses.group);

  const students = buildStudents(campus, rand, avoid);
  group.add(students.group);

  freeAfterUpload(group); // 모양 정점 배열은 GPU에 올린 뒤 해제 (위치 행렬은 그대로)
  return {
    group,
    stat: { parked: parked.count, busRoute: Math.round(route?.length || 0), buses: buses.list.length, students: students.list.length },
    // 켜고 끄기: 끄면 안 보이고 주차 차량 충돌도 빠짐
    setVisible(on) {
      group.visible = on;
      collider.setEnabled(parked.ids, on);
    },
    setQuality(high) {
      students.setCount(high ? STU.high : STU.low);
      buses.setCount(high ? 2 : 1);
    },
    // hide: 이 점들 둘레의 학생·버스는 숨김 (연출 중 교수님·굴착기 둘레)
    update(dt, car, hide = []) {
      buses.update(dt, car, hide);
      students.update(dt, car, hide);
    },
  };
}

// ---------- 주차 차량 ----------

function buildParkedCars(campus, collider, rand, avoid) {
  const spots = [];
  for (const o of campus.parking || []) {
    if (Math.abs(area(o)) < 60) continue;
    const r = orientedRect(o);
    if (r.W < 5.5) continue;
    for (const side of r.W >= 13 ? [-1, 1] : [-1]) {
      const v = side * (r.W / 2 - 0.3 - PARK.depth / 2);
      for (let u = -r.L / 2 + 1.5; u + PARK.stall <= r.L / 2 - 1.5 + 1e-6; u += PARK.stall) {
        if (rand() > PARK.fill) continue;
        const [x, z] = rectPoint(r, u + PARK.stall / 2, v);
        const a = rectPoint(r, u + PARK.stall / 2, v - PARK.len / 2), b = rectPoint(r, u + PARK.stall / 2, v + PARK.len / 2);
        if (!pointInPolygon(...a, o) || !pointInPolygon(...b, o) || avoid(x, z, PARK.clear)) continue;
        // 차 앞(+z 지역축)이 칸 안쪽(통로 반대)을 보게: 지역 z = 주차장 v 방향
        const fx = -r.uz * side, fz = r.ux * side;
        spots.push({ x, z, yaw: Math.atan2(fx, fz) + (rand() < 0.15 ? Math.PI : 0), color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)] });
      }
    }
  }
  const geo = carGeometry();
  const ids = [];
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
  spots.forEach((s, i) => {
    m.compose(new THREE.Vector3(s.x, heightAt(s.x, s.z), s.z), q.setFromAxisAngle(up, s.yaw), one);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(s.color));
    // 충돌: 차 크기 사각형 (부딪히면 건물처럼 튕김·소리)
    const cs = Math.cos(s.yaw), sn = Math.sin(s.yaw), hw = PARK.wid / 2 + 0.05, hl = PARK.len / 2 + 0.05;
    ids.push(collider.addObstacle([[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([lx, lz]) => [s.x + lx * cs + lz * sn, s.z - lx * sn + lz * cs])));
  });
  mesh.receiveShadow = true; // 그림자는 받기만 (그림자 그리기 비용 절약)
  return { mesh, count: spots.length, ids };
}

// 승용차 한 대 (지역 +z가 앞): 몸체(흰색 → 인스턴스 색), 유리, 바퀴, 불빛. 로고·글자 없음
function carGeometry() {
  const P = [];
  const box = (sx, sy, sz, x, y, z, col) => P.push([new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), col]);
  box(1.8, 0.62, 4.3, 0, 0.55, 0, '#ffffff');            // 아래 몸체
  box(1.6, 0.5, 2.2, 0, 1.1, -0.25, '#ffffff');           // 지붕 쪽 몸체
  box(1.62, 0.36, 2.0, 0, 1.08, -0.25, '#2a3440');        // 옆·앞뒤 유리 띠
  box(1.5, 0.06, 2.1, 0, 1.36, -0.25, '#ffffff');         // 지붕판
  for (const [x, z] of [[-0.82, 1.35], [0.82, 1.35], [-0.82, -1.35], [0.82, -1.35]]) {
    P.push([new THREE.CylinderGeometry(0.33, 0.33, 0.24, 6).rotateZ(Math.PI / 2).translate(x, 0.33, z), '#1c1c1e']);
  }
  box(1.5, 0.12, 0.04, 0, 0.66, 2.16, '#f6f1d0');         // 앞 불빛
  box(1.5, 0.12, 0.04, 0, 0.66, -2.16, '#c4362e');        // 뒤 불빛
  return mergeColored(P);
}

// ---------- 셔틀버스 ----------

// 차도 그래프에서 길이 BUS.loop 안의 고리(순환로)를 찾는다: 간선을 하나 빼고 반대쪽까지의 최단 경로 + 그 간선
function findLoop(campus) {
  const roads = campus.roads.filter((r) => r.car && r.width >= 4.5); // 주차장 통로 같은 좁은 길은 빼고
  const id = new Map(), pts = [], adj = [];
  const node = ([x, z]) => {
    const k = `${Math.round(x)},${Math.round(z)}`;
    if (!id.has(k)) { id.set(k, pts.length); pts.push([x, z]); adj.push([]); }
    return id.get(k);
  };
  const edges = [];
  for (const r of roads) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = node(r.points[i]), b = node(r.points[i + 1]);
      if (a === b) continue;
      const w = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) * (r.type === 'service' ? 1.4 : 1); // 간선 도로를 더 좋아함
      adj[a].push([b, w]); adj[b].push([a, w]);
      edges.push([a, b, w]);
    }
  }
  let best = null;
  const target = BUS.best;
  for (let e = 0; e < edges.length; e += Math.max(1, Math.floor(edges.length / 150))) {
    const [a, b, w] = edges[e];
    const path = shortest(adj, b, a, [a, b]);
    if (!path) continue;
    const L = path.dist + w;
    if (L < BUS.loop[0] || L > BUS.loop[1]) continue;
    if (!best || Math.abs(L - target) < Math.abs(best.length - target)) best = { nodes: path.nodes, length: L };
  }
  if (!best) return null;
  const line = best.nodes.map((n) => pts[n]);
  return { points: line, length: best.length };
}

// 다익스트라 (skip: 처음 간선 a→b는 쓰지 않음)
function shortest(adj, from, to, [sa, sb]) {
  const dist = new Float64Array(adj.length).fill(Infinity), prev = new Int32Array(adj.length).fill(-1);
  const heap = [[0, from]];
  dist[from] = 0;
  while (heap.length) {
    const [d, u] = heapPop(heap);
    if (d > dist[u]) continue;
    if (u === to) break;
    for (const [v, w] of adj[u]) {
      if ((u === sb && v === sa) || (u === sa && v === sb)) continue;
      if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; heapPush(heap, [d + w, v]); }
    }
  }
  if (!isFinite(dist[to])) return null;
  const nodes = [];
  for (let u = to; u !== -1; u = prev[u]) nodes.push(u);
  return { nodes: nodes.reverse(), dist: dist[to] };
}

function heapPush(h, x) {
  h.push(x);
  for (let i = h.length - 1; i > 0;) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    for (let i = 0; ;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

function buildBuses(route, rand) {
  const group = new THREE.Group();
  const list = [];
  if (!route) return { group, list, update() {}, setCount() {} };
  const path = makePath(route.points, true);
  const geo = busGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (let k = 0; k < 2; k++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    group.add(mesh);
    list.push({ mesh, s: (path.length * k) / 2, v: BUS.speed, on: true });
  }
  const fwd = new THREE.Vector3();
  return {
    group, list,
    setCount(n) { list.forEach((b, i) => { b.on = i < n; b.mesh.visible = b.on; }); },
    update(dt, car, hide) {
      for (const b of list) {
        if (!b.on) continue;
        const p = path.at(b.s), ahead = path.at(b.s + 6);
        // 오른쪽 차로로 (진행 방향 오른쪽 = (-uz, ux))
        const off = 1.9, x = p.x - p.uz * off, z = p.z + p.ux * off;
        const dx = car.pos.x - x, dz = car.pos.y - z, d = Math.hypot(dx, dz);
        const front = (dx * p.ux + dz * p.uz) > 0;
        const want = (front && d < BUS.stopAhead) || d < BUS.stopNear ? 0 : BUS.speed; // 굴착기가 다가오면 멈춤
        b.v += Math.sign(want - b.v) * Math.min(Math.abs(want - b.v), BUS.accel * 2.2 * dt);
        b.s = (b.s + b.v * dt) % path.length;
        const ax = ahead.x - ahead.uz * off, az = ahead.z + ahead.ux * off;
        const y = heightAt(x, z), ya = heightAt(ax, az);
        b.mesh.position.set(x, y, z);
        fwd.set(ax - x, ya - y, az - z).normalize();
        b.mesh.rotation.set(0, Math.atan2(fwd.x, fwd.z), 0);
        b.mesh.rotateX(-Math.asin(THREE.MathUtils.clamp(fwd.y, -0.3, 0.3)));
        b.mesh.visible = !hide.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < 30);
        // 굴착기가 버스 안으로 들어오지 않게 밀어냄 (소리·흔들림 없이)
        pushOutOfBox(car, x, z, Math.atan2(ax - x, az - z), BUS.wid / 2 + 1.7, BUS.len / 2 + 1.7);
      }
    },
  };
}

// 굴착기(원)를 회전 사각형 밖으로 밀고 안쪽으로 향하던 속도를 없앰
function pushOutOfBox(car, cx, cz, yaw, hw, hl) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const dx = car.pos.x - cx, dz = car.pos.y - cz;
  const lx = dx * c - dz * s, lz = dx * s + dz * c; // 지역 좌표 (lz = 버스 앞 방향)
  if (Math.abs(lx) >= hw || Math.abs(lz) >= hl) return;
  const px = hw - Math.abs(lx), pz = hl - Math.abs(lz);
  let nx, nz;
  if (px < pz) { nx = Math.sign(lx) * c; nz = -Math.sign(lx) * s; car.pos.x += nx * px; car.pos.y += nz * px; }
  else { nx = Math.sign(lz) * s; nz = Math.sign(lz) * c; car.pos.x += nx * pz; car.pos.y += nz * pz; }
  const vn = car.vel.x * nx + car.vel.y * nz;
  if (vn < 0) { car.vel.x -= nx * vn; car.vel.y -= nz * vn; car.vel.multiplyScalar(0.5); }
}

// 셔틀버스 (지역 +z가 앞): 흰 몸체 + 파란 띠 + 유리창 띠 + 바퀴. 글자·로고 없음
function busGeometry() {
  const P = [];
  const box = (sx, sy, sz, x, y, z, col) => P.push([new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), col]);
  box(BUS.wid, BUS.h - 0.5, BUS.len, 0, 0.5 + (BUS.h - 0.5) / 2, 0, '#f3f4f1');
  box(BUS.wid + 0.02, 0.28, BUS.len + 0.02, 0, 1.05, 0, '#2f6fb5');
  box(BUS.wid + 0.03, 0.85, BUS.len - 1.6, 0, 2.05, -0.3, '#25303b');
  box(BUS.wid - 0.3, 1.0, 0.04, 0, 2.0, BUS.len / 2 + 0.01, '#25303b');  // 앞 유리
  box(BUS.wid - 0.2, 0.1, BUS.len - 0.4, 0, BUS.h + 0.05, 0, '#d9dbd8');  // 지붕
  for (const [x, z] of [[-1.05, 2.9], [1.05, 2.9], [-1.05, -2.9], [1.05, -2.9]]) {
    P.push([new THREE.CylinderGeometry(0.48, 0.48, 0.3, 8).rotateZ(Math.PI / 2).translate(x, 0.48, z), '#1c1c1e']);
  }
  return mergeColored(P);
}

// ---------- 학생 ----------

function buildStudents(campus, rand, avoid) {
  const paths = campus.roads
    .filter((r) => !r.car && ['footway', 'path', 'pedestrian'].includes(r.type))
    .map((r) => makePath(r.points, false))
    .filter((p) => p.length > 30 && !p.samples.some(([x, z]) => avoid(x, z, STU.missionClear)));
  const list = [];
  for (let i = 0; i < STU.high && paths.length; i++) {
    const path = paths[Math.floor(rand() * paths.length)];
    list.push({
      path, s: rand() * path.length, dir: rand() < 0.5 ? 1 : -1, speed: STU.speed * (0.8 + rand() * 0.4),
      lat: 0, wantLat: 0, phase: rand() * 6.28, x: 0, z: 0, yaw: 0,
      colors: [SHIRTS[i % SHIRTS.length], PANTS[Math.floor(rand() * PANTS.length)], HAIR[Math.floor(rand() * HAIR.length)], BAGS[Math.floor(rand() * BAGS.length)]],
    });
  }
  // 부위별 InstancedMesh (지역 +z가 앞, 키 약 1.45m: 큰 머리의 귀여운 비율)
  const lam = (opts = {}) => new THREE.MeshLambertMaterial(opts);
  const parts = {
    torso: [new THREE.CapsuleGeometry(0.2, 0.28, 2, 7).scale(1, 1, 0.8), 0],
    head: [new THREE.IcosahedronGeometry(0.24, 1), SKIN],
    hair: [new THREE.SphereGeometry(0.255, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), 2],
    bag: [new THREE.BoxGeometry(0.3, 0.34, 0.14), 3],
    legL: [new THREE.CapsuleGeometry(0.075, 0.3, 2, 5).translate(0, -0.22, 0), 1],
    legR: [new THREE.CapsuleGeometry(0.075, 0.3, 2, 5).translate(0, -0.22, 0), 1],
    eyeL: [new THREE.SphereGeometry(0.032, 5, 4), '#1b1b1b'],
    eyeR: [new THREE.SphereGeometry(0.032, 5, 4), '#1b1b1b'],
  };
  const group = new THREE.Group();
  const meshes = {};
  const c = new THREE.Color();
  for (const [k, [geo, col]] of Object.entries(parts)) {
    const fixed = typeof col === 'string';
    const mesh = new THREE.InstancedMesh(geo, lam(fixed ? { color: col } : {}), Math.max(1, list.length));
    if (!fixed) list.forEach((s, i) => mesh.setColorAt(i, c.set(s.colors[col])));
    mesh.castShadow = k !== 'eyeL' && k !== 'eyeR';
    mesh.frustumCulled = false;
    meshes[k] = mesh;
    group.add(mesh);
  }
  let count = list.length;
  const M = new THREE.Matrix4(), B = new THREE.Matrix4(), L = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const set = (k, i, base, x, y, z, rx = 0) => {
    L.makeRotationFromEuler(e.set(rx, 0, 0)).setPosition(x, y, z);
    meshes[k].setMatrixAt(i, M.multiplyMatrices(base, L));
  };
  return {
    group, list,
    setCount(n) { count = Math.min(n, list.length); for (const m of Object.values(meshes)) m.count = count; },
    update(dt, car, hide) {
      const cv = car.vel, cx = car.pos.x, cz = car.pos.y;
      for (let i = 0; i < count; i++) {
        const s = list[i];
        const p = s.path.at(s.s);
        // 굴착기의 앞으로 STU.look초 경로에서 가장 가까운 거리 → 가까우면 멈추고 옆으로 비킴
        let near = Infinity, side = 0;
        for (let t = 0; t <= STU.look; t += 0.2) {
          const fx = cx + cv.x * t, fz = cz + cv.y * t;
          const d = Math.hypot(s.x - fx, s.z - fz);
          if (d < near) { near = d; side = Math.sign((s.x - fx) * -p.uz + (s.z - fz) * p.ux) || 1; }
        }
        const danger = near < STU.dodge;
        if (danger) s.wantLat = side * STU.side;
        else if (Math.hypot(s.x - cx, s.z - cz) > STU.dodge * 1.6) s.wantLat = 0;
        s.lat += Math.sign(s.wantLat - s.lat) * Math.min(Math.abs(s.wantLat - s.lat), STU.sideSpeed * dt);
        const walking = !danger;
        if (walking) {
          s.s += s.dir * s.speed * dt;
          if (s.s < 0 || s.s > s.path.length) { s.dir *= -1; s.s = THREE.MathUtils.clamp(s.s, 0, s.path.length); }
          s.phase += dt * s.speed * 5.5;
        }
        const q2 = s.path.at(s.s);
        s.x = q2.x - q2.uz * s.lat; s.z = q2.z + q2.ux * s.lat;
        // 마지막 안전장치: 굴착기 둘레 STU.safe m 안으로는 절대 들어가지 않게 바로 밀어냄
        const dx = s.x - cx, dz = s.z - cz, d = Math.hypot(dx, dz);
        if (d < STU.safe) { const k = STU.safe / (d || 1); s.x = cx + dx * k; s.z = cz + dz * k; }
        const hideMe = hide.some(([hx, hz]) => Math.hypot(hx - s.x, hz - s.z) < 30);
        const targetYaw = danger ? Math.atan2(-dx, -dz) : Math.atan2(q2.ux * s.dir, q2.uz * s.dir); // 비킬 땐 굴착기 쪽을 봄
        s.yaw += Math.atan2(Math.sin(targetYaw - s.yaw), Math.cos(targetYaw - s.yaw)) * Math.min(1, dt * 8);
        if (hideMe) { for (const m of Object.values(meshes)) m.setMatrixAt(i, hidden); continue; }
        const bob = walking ? Math.abs(Math.sin(s.phase)) * 0.04 : 0, swing = walking ? Math.sin(s.phase) * 0.5 : 0;
        B.compose(new THREE.Vector3(s.x, heightAt(s.x, s.z) + bob, s.z), q.setFromEuler(e.set(0, s.yaw, 0)), new THREE.Vector3(1, 1, 1));
        set('legL', i, B, -0.09, 0.52, 0, swing);
        set('legR', i, B, 0.09, 0.52, 0, -swing);
        set('torso', i, B, 0, 0.78, 0);
        set('bag', i, B, 0, 0.8, -0.2);
        set('head', i, B, 0, 1.2, 0.01);
        set('hair', i, B, 0, 1.22, -0.01, -0.25);
        set('eyeL', i, B, -0.085, 1.22, 0.215);
        set('eyeR', i, B, 0.085, 1.22, 0.215);
      }
      for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- 도우미 ----------

// 선 위 거리 s의 점·방향 (loop면 한 바퀴 이음)
function makePath(points, loop) {
  const pts = loop ? [...points, points[0]] : points;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = cum.at(-1);
  const samples = [];
  for (let s = 0; s < length; s += 5) samples.push(pointOn(s));
  function pointOn(s) {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const L = cum[i] - cum[i - 1] || 1, t = Math.min(1, Math.max(0, (s - cum[i - 1]) / L));
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, (pts[i][0] - pts[i - 1][0]) / L, (pts[i][1] - pts[i - 1][1]) / L];
  }
  return {
    length, samples,
    at(s) {
      const v = loop ? ((s % length) + length) % length : Math.min(length, Math.max(0, s));
      const [x, z, ux, uz] = pointOn(v);
      return { x, z, ux, uz };
    },
  };
}

function mergeColored(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const [g0, color] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    c.set(color);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function area(o) {
  let s = 0;
  for (let i = 0; i < o.length; i++) s += o[i][0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * o[i][1];
  return s / 2;
}
