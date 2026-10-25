// 생동감: 순환 도로를 천천히 도는 셔틀버스 1~2대(굴착기·걷는 황소가 다가오면 멈춤). 브랜드·로고 없음.
// 주차 차량·걷는 학생은 넣지 않는다(밤샘 4단계: 가볍게). 버스는 한 모양을 두 메시가 같이 씀.
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { freeAfterUpload } from './map.js';

const BUS = { speed: 6.5, accel: 2.5, stopAhead: 16, stopNear: 9, len: 9, wid: 2.4, h: 3.0, loop: [900, 4000], best: 2000 };

// stopPoints가 있는 곳(교수님 등장 자리 등) 둘레에서는 버스를 숨긴다
export function buildShuttles(scene, campus) {
  const group = new THREE.Group();
  scene.add(group);
  const route = findLoop(campus);
  const buses = buildBuses(route);
  group.add(buses.group);
  freeAfterUpload(group);
  return {
    group,
    stat: { busRoute: Math.round(route?.length || 0), buses: buses.list.length },
    setCount(n) { buses.setCount(n); },
    // car: 굴착기, walker: 걷는 황소(내렸을 때만), hide: 이 점들 둘레의 버스는 숨김 (연출 중 교수님·굴착기 둘레)
    update(dt, car, walker, hide = []) {
      if (!group.visible) return;
      buses.update(dt, car, walker, hide);
    },
  };
}

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

function buildBuses(route) {
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
  // (x, z)에 있는 버스에 대해 다가오는 것(굴착기·황소)이 앞쪽 가까이 있으면 멈춤
  const blocks = (px, pz, x, z, p) => {
    const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz);
    return ((dx * p.ux + dz * p.uz) > 0 && d < BUS.stopAhead) || d < BUS.stopNear;
  };
  return {
    group, list,
    setCount(n) { list.forEach((b, i) => { b.on = i < n; b.mesh.visible = b.on; }); },
    update(dt, car, walker, hide) {
      for (const b of list) {
        if (!b.on) continue;
        const p = path.at(b.s), ahead = path.at(b.s + 6);
        // 오른쪽 차로로 (진행 방향 오른쪽 = (-uz, ux))
        const off = 1.9, x = p.x - p.uz * off, z = p.z + p.ux * off;
        const stop = blocks(car.pos.x, car.pos.y, x, z, p) || (walker && blocks(walker.pos.x, walker.pos.y, x, z, p));
        const want = stop ? 0 : BUS.speed;
        b.v += Math.sign(want - b.v) * Math.min(Math.abs(want - b.v), BUS.accel * 2.2 * dt);
        b.s = (b.s + b.v * dt) % path.length;
        const ax = ahead.x - ahead.uz * off, az = ahead.z + ahead.ux * off;
        const y = heightAt(x, z), ya = heightAt(ax, az);
        b.mesh.position.set(x, y, z);
        fwd.set(ax - x, ya - y, az - z).normalize();
        b.mesh.rotation.set(0, Math.atan2(fwd.x, fwd.z), 0);
        b.mesh.rotateX(-Math.asin(THREE.MathUtils.clamp(fwd.y, -0.3, 0.3)));
        b.mesh.visible = !hide.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < 30);
        // 굴착기·황소가 버스 안으로 들어오지 않게 밀어냄 (소리·흔들림 없이)
        const yaw = Math.atan2(ax - x, az - z);
        pushOutOfBox(car, x, z, yaw, BUS.wid / 2 + 1.7, BUS.len / 2 + 1.7);
        if (walker) pushOutOfBox(walker, x, z, yaw, BUS.wid / 2 + 0.35, BUS.len / 2 + 0.35);
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

