// 조경 소품: 벤치·자전거 보관소·버스정류장, 조형물·기념물, 가로등.
// 소품과 조형물은 종류마다 한 메시로 합치고(정점 색), 가로등은 InstancedMesh.
// 기념물은 인물 모양을 만들지 않고 단정한 비석·받침대·탑으로만 표현한다.
import * as THREE from 'three';
import { mulberry32, distToSegment, pointInPolygon } from './map.js';

const LAMP = {
  spacing: 30,   // 같은 쪽 가로등 간격 (m)
  gap: 1.0,      // 차도 가장자리에서 떨어진 거리
  height: 6.2,
  minRoadLen: 80, // service 도로는 이보다 긴 것만 (주차장 통로 등 제외)
};
const STONE = '#c9c3b6', GRANITE = '#55585c', DARK_STONE = '#77746f', BRONZE = '#8a6c48';
const MONUMENT_LABEL_DIST = 70; // 이만큼 가까이 와야 이름표가 보인다

export function buildLandscape(scene, campus) {
  const group = new THREE.Group();
  const roads = makeRoadIndex(campus.roads);
  const parts = new PartBuilder();
  const obstacles = [];
  const labels = [];

  for (const p of campus.props || []) {
    const [x, z] = p.p;
    const near = roads.nearest(x, z, p.type === 'bus' ? 25 : 15, p.type === 'bus');
    // 앞(+z)이 가까운 도로를 보도록
    const yaw = near ? Math.atan2(near.x - x, near.z - z) : hashAngle(x, z);
    if (p.type === 'bench') bench(parts, x, z, yaw);
    else if (p.type === 'bike') bikeRack(parts, x, z, yaw);
    else if (p.type === 'bus') busShelter(parts, x, z, yaw);
  }

  for (const m of campus.monuments || []) {
    const [x, z] = m.p;
    const near = roads.nearest(x, z, 30, false);
    const yaw = near ? Math.atan2(near.x - x, near.z - z) : 0;
    const { top, half } = monument(parts, m.shape, x, z, yaw);
    obstacles.push(square(x, z, half, yaw));
    if (m.name) labels.push({ text: m.name, x, y: top + 1.2, z, maxDist: m.shape === 'tower' ? 160 : MONUMENT_LABEL_DIST });
  }

  const propMesh = parts.mesh();
  propMesh.castShadow = propMesh.receiveShadow = true;
  group.add(propMesh);

  const lamps = buildLamps(campus, roads);
  group.add(lamps);

  scene.add(group);
  return { group, lamps, obstacles, labels };
}

// ---------- 소품 ----------

function bench(b, x, z, yaw) {
  const T = b.frame(x, z, yaw);
  const wood = '#a8784c', metal = '#4b4f55';
  b.box(T, 0, 0.45, 0, 1.8, 0.07, 0.45, wood);
  b.box(T, 0, 0.78, -0.22, 1.8, 0.32, 0.06, wood);
  for (const sx of [-0.75, 0.75]) b.box(T, sx, 0.22, -0.05, 0.07, 0.44, 0.5, metal);
}

function bikeRack(b, x, z, yaw) {
  const T = b.frame(x, z, yaw);
  const metal = '#9aa1a8';
  b.box(T, 0, 0.03, 0, 3.4, 0.06, 0.12, metal);
  for (let i = 0; i < 5; i++) {
    const u = -1.4 + i * 0.7;
    b.box(T, u, 0.45, -0.25, 0.05, 0.9, 0.05, metal);
    b.box(T, u, 0.45, 0.25, 0.05, 0.9, 0.05, metal);
    b.box(T, u, 0.9, 0, 0.05, 0.05, 0.55, metal);
  }
}

// 버스정류장: 뒤판(유리) + 기둥 + 지붕 + 의자 + 표지판. 앞(+z)이 도로 쪽
function busShelter(b, x, z, yaw) {
  const T = b.frame(x, z, yaw);
  const glass = '#a9c6d4', frame = '#3d4652', sign = '#2f6fb5';
  b.box(T, 0, 1.3, -0.7, 3.6, 2.2, 0.08, glass);
  for (const sx of [-1.8, 1.8]) for (const sz of [-0.7, 0.6]) b.box(T, sx, 1.25, sz, 0.1, 2.5, 0.1, frame);
  b.box(T, 0, 2.55, -0.05, 4.0, 0.12, 1.7, frame);
  b.box(T, 0, 0.45, -0.45, 2.6, 0.08, 0.4, '#b08a5c');
  b.box(T, 2.4, 1.3, 0.6, 0.08, 2.6, 0.08, frame);
  b.box(T, 2.4, 2.45, 0.6, 0.6, 0.5, 0.06, sign);
}

// 기념물·조형물. 돌려주는 값: 꼭대기 높이, 충돌 사각형 반 폭
function monument(b, shape, x, z, yaw) {
  const T = b.frame(x, z, yaw);
  switch (shape) {
    case 'tower': { // 용봉탑: 넓은 단 + 위로 좁아지는 사각 탑 + 머릿돌
      b.box(T, 0, 0.3, 0, 7, 0.6, 7, STONE);
      b.box(T, 0, 0.9, 0, 4.6, 0.6, 4.6, STONE);
      b.prism(T, 0, 1.2, 0, 1.5, 0.75, 15, 4, '#e2ddd2');
      b.prism(T, 0, 16.2, 0, 0.9, 0.05, 2.2, 4, '#e2ddd2');
      return { top: 18.4, half: 3.5 };
    }
    case 'pedestal': // 흉상·동상 자리: 인물 없이 2단 받침대 + 반듯한 머릿돌
      b.box(T, 0, 0.25, 0, 1.6, 0.5, 1.6, STONE);
      b.box(T, 0, 1.15, 0, 1.0, 1.3, 1.0, DARK_STONE);
      b.box(T, 0, 1.9, 0, 0.75, 0.2, 0.75, GRANITE);
      return { top: 2.0, half: 0.8 };
    case 'sculpture': // 추상 조형물: 받침 + 둥근 돌
      b.box(T, 0, 0.3, 0, 1.4, 0.6, 1.4, STONE);
      b.ball(T, 0, 1.25, 0, 0.6, BRONZE);
      return { top: 1.9, half: 0.7 };
    case 'wall': // 벽화 자리: 낮고 반듯한 벽
      b.box(T, 0, 1.2, 0, 6, 2.4, 0.35, '#cbbd9f');
      b.box(T, 0, 2.47, 0, 6.2, 0.14, 0.45, DARK_STONE);
      return { top: 2.6, half: 3.0 };
    default: // 비석: 받침돌 + 검은 화강암 비 + 머릿돌
      b.box(T, 0, 0.2, 0, 1.8, 0.4, 0.9, STONE);
      b.box(T, 0, 1.2, 0, 1.2, 1.6, 0.26, GRANITE);
      b.box(T, 0, 2.06, 0, 1.32, 0.12, 0.34, DARK_STONE);
      return { top: 2.1, half: 0.9 };
  }
}

// ---------- 가로등 ----------

// 주요 차도(짧은 service 도로 제외) 양쪽에 약 30m 간격. 품질 "낮음"에서는 숨긴다
function buildLamps(campus, roads) {
  const rand = mulberry32(530);
  const spots = []; // [x, z, 도로 쪽 각도]
  const grid = new Map();
  const tooClose = (x, z) => {
    const gx = Math.floor(x / 10), gz = Math.floor(z / 10);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const [px, pz] of grid.get(`${gx + i},${gz + j}`) || []) if (Math.hypot(px - x, pz - z) < 8) return true;
    }
    return false;
  };
  const blocked = makeLampBlocker(campus);
  for (const r of campus.roads) {
    if (!r.car) continue;
    const len = polylineLength(r.points);
    if (r.type === 'service' && len < LAMP.minRoadLen) continue;
    const off = r.width / 2 + LAMP.gap;
    for (const side of [-1, 1]) {
      let t = rand() * LAMP.spacing;
      walk(r.points, (x, z, ux, uz, s) => {
        if (s < t) return;
        t += LAMP.spacing;
        const lx = x - uz * off * side, lz = z + ux * off * side;
        if (blocked(lx, lz) || roads.onRoad(lx, lz) || tooClose(lx, lz)) return;
        spots.push([lx, lz, Math.atan2(x - lx, z - lz)]);
        const k = `${Math.floor(lx / 10)},${Math.floor(lz / 10)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([lx, lz]);
      });
    }
  }

  // 기둥+팔은 한 도형, 등은 따로 (밝은 색)
  const H = LAMP.height;
  const pole = new THREE.CylinderGeometry(0.07, 0.11, H, 6).translate(0, H / 2, 0);
  const arm = new THREE.BoxGeometry(0.08, 0.08, 1.3).translate(0, H - 0.1, 0.6);
  const poleGeo = mergeSimple([pole, arm]);
  const headGeo = new THREE.BoxGeometry(0.3, 0.14, 0.6).translate(0, H - 0.2, 1.2);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: '#5d636b' }), spots.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ color: '#fff6d8', emissive: '#7a6f4e' }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  spots.forEach(([x, z, a], i) => {
    m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(up, a), one);
    poles.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
  });
  const group = new THREE.Group();
  group.add(poles, heads);
  group.userData.count = spots.length;
  return group;
}

function makeLampBlocker(campus) {
  const cell = 20, insides = new Map();
  for (const b of campus.buildings) {
    const xs = b.outline.map((p) => p[0]), zs = b.outline.map((p) => p[1]);
    for (let x = Math.floor((Math.min(...xs) - 2) / cell); x <= Math.floor((Math.max(...xs) + 2) / cell); x++) {
      for (let z = Math.floor((Math.min(...zs) - 2) / cell); z <= Math.floor((Math.max(...zs) + 2) / cell); z++) {
        const k = `${x},${z}`;
        if (!insides.has(k)) insides.set(k, []);
        insides.get(k).push(b.outline);
      }
    }
  }
  const waters = campus.greens.filter((g) => g.kind === 'water').map((g) => g.outline);
  return (x, z) => {
    for (const o of insides.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) || []) if (pointInPolygon(x, z, o)) return true;
    return waters.some((o) => pointInPolygon(x, z, o));
  };
}

// ---------- 도로 찾기 ----------

function makeRoadIndex(list) {
  const cell = 20, grid = new Map();
  for (const r of list) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const [xa, za] = r.points[i], [xb, zb] = r.points[i + 1];
      const seg = [xa, za, xb, zb, r.width / 2, r.car];
      for (let x = Math.floor(Math.min(xa, xb) / cell) - 1; x <= Math.floor(Math.max(xa, xb) / cell) + 1; x++) {
        for (let z = Math.floor(Math.min(za, zb) / cell) - 1; z <= Math.floor(Math.max(za, zb) / cell) + 1; z++) {
          const k = `${x},${z}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(seg);
        }
      }
    }
  }
  const around = (x, z, R) => {
    const out = new Set();
    const n = Math.ceil(R / cell);
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (const s of grid.get(`${gx + i},${gz + j}`) || []) out.add(s);
    return out;
  };
  return {
    // R 안에서 가장 가까운 도로 위 점 {x, z}
    nearest(x, z, R, carOnly) {
      let best = null, bestD = R;
      for (const s of around(x, z, R)) {
        if (carOnly && !s[5]) continue;
        const d = distToSegment(x, z, s);
        if (d < bestD) {
          const [x1, z1, x2, z2] = s, dx = x2 - x1, dz = z2 - z1, L = dx * dx + dz * dz;
          const t = L ? Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L)) : 0;
          best = { x: x1 + dx * t, z: z1 + dz * t };
          bestD = d;
        }
      }
      return best;
    },
    // 차도 위(가장자리 0.4m 여유)인지
    onRoad(x, z) {
      for (const s of around(x, z, 0)) if (s[5] && distToSegment(x, z, s) < s[4] + 0.4) return true;
      return false;
    },
  };
}

// 선을 따라 1m마다 cb(x, z, 방향 ux, uz, 시작부터 거리)
function walk(points, cb) {
  let s = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, z1] = points[i], [x2, z2] = points[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
    for (let t = 0; t < len; t += 1) cb(x1 + ux * t, z1 + uz * t, ux, uz, s + t);
    s += len;
  }
}

function polylineLength(points) {
  let s = 0;
  for (let i = 0; i < points.length - 1; i++) s += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  return s;
}

// ---------- 도형 합치기 ----------

class PartBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.col = [];
    this.m = new THREE.Matrix4();
  }

  // 소품 하나의 좌표계: (x, z)에 놓고 yaw만큼 돌림
  frame(x, z, yaw) {
    return new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
  }

  add(geo, T, color) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(T);
    const c = new THREE.Color(color);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { this.pos.push(p[i]); this.nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) this.col.push(c.r, c.g, c.b);
  }

  box(T, x, y, z, sx, sy, sz, color) {
    this.add(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), T, color);
  }

  // 각진 기둥(sides=4면 사각, 45° 돌려 면이 앞을 보게): 바닥 반지름 r0, 위 r1, 높이 h
  prism(T, x, y, z, r0, r1, h, sides, color) {
    const g = new THREE.CylinderGeometry(r1, r0, h, sides).rotateY(Math.PI / sides).translate(x, y + h / 2, z);
    g.computeVertexNormals();
    this.add(g, T, color);
  }

  ball(T, x, y, z, r, color) {
    this.add(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), T, color);
  }

  mesh() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  }
}

function mergeSimple(geos) {
  const pos = [], nor = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

function square(x, z, h, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) => [x + a * c + b * s, z - a * s + b * c]);
}

function hashAngle(x, z) {
  return ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * Math.PI * 2;
}
