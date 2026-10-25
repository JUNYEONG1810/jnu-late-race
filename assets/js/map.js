// campus.json → 지형 위의 바닥 그림·건물·나무·정문 3D.
// 땅·녹지·도로·차선·주차장·보행로·운동장은 위에서 내려다본 큰 캔버스 한 장(품질 높음 4096px, 낮음 2048px)에
// 그려서 지형 메시의 텍스처로 입힌다 → 언덕 뒤 도로가 비쳐 보이거나 겹친 층이 깜빡이지 않는다.
// 건물은 성능을 위해 종류마다 한 덩어리(메시 하나)로 합치고, 색은 정점 색으로 넣는다.
import * as THREE from 'three';
import { heightAt, heightRange, buildTerrainGeometry } from './terrain.js';

// 벽: 밝은 베이지, 흰색, 연회색, 붉은 벽돌 중 건물마다 하나
const WALL_COLORS = ['#ece0c6', '#f5f3ee', '#d7d9db', '#b86b52'];
// 지붕: 옥상 방수 페인트 초록, 회색, 연갈색
const ROOF_COLORS = ['#8fb79c', '#c3c5c1', '#b3aa9c'];
const ENTRANCE_COLOR = '#3a3f47';
const OUTSIDE_TINT = new THREE.Color('#eceef0');
const OUTSIDE_MIX = 0.45;

const FLOOR_M = 4; // 층 높이 (campus.json 높이 = 층수 × 4m + 난간 1m)
const BAY_M = 3;     // 창문 하나의 가로 폭
const BURY_M = 1.5;  // 벽을 가장 낮은 땅보다 더 내려 묻는 깊이

const GROUND_COLOR = '#c9c5bc';
const CAMPUS_COLOR = '#dbd7cd'; // 따뜻한 연회색 포장면 (눈부시지 않게)
const GROUND_MARGIN = 80;       // 바닥 그림이 덮는 범위: 캠퍼스 경계 사각형 + 80m
// park(광장·조경 구역)는 칠하지 않는다 → 포장면 위에 나무만
const GREEN_COLORS = {
  grass: '#9fd07a', pitch: '#7cc46a', forest: '#5e9e4f',
  farm: '#c4a676', dirt: '#d9bf92', track: '#c9735a', water: '#8fd0ee',
};
const FOOT_COLOR = '#dcd2c2';    // 밝은 보도블록
const STEP_COLOR = '#b5a993';    // 계단 줄무늬
const ASPHALT_COLOR = '#5b5f66';
const LANE_COLOR = '#f2f2ec';
const PARKING_COLOR = '#6b6e73'; // 주차장 바닥 (짙은 회색)
const MARK_COLOR = '#f6f6f0';    // 주차선·코트 라인
const WATER_COLOR = '#6cb8dc';
const WATER_EDGE_COLOR = '#b9b2a4'; // 연못 가장자리 돌
// 운동장 종류별 바닥색 [잔디·우레탄 등, 흙]
const SPORT_COLORS = {
  soccer: ['#5aa94f', '#d2b384'], futsal: ['#4f9e62', '#d2b384'], baseball: ['#62ad55', '#d2b384'],
  multi: ['#5aa66a', '#d4b98c'], tennis: ['#3f7fa6', '#c8744f'], basketball: ['#c47f52', '#cfae80'],
  volleyball: ['#4a85a6', '#cfae80'],
};

export async function loadCampus(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export function buildMap(scene, campus, { anisotropy = 1, groundPx = 4096 } = {}) {
  const group = new THREE.Group();

  const ground = buildGround(campus, groundPx, anisotropy);
  group.add(ground.mesh);
  group.add(buildWater(campus.greens.filter((g) => g.kind === 'water')));
  group.add(...buildRoadMeshes(campus));

  const buildings = buildBuildings(campus.buildings, anisotropy);
  group.add(...buildings);

  const trees = buildTrees(campus);
  group.add(trees.group);

  const gate = buildGate(campus.spawn);
  group.add(gate.group);

  scene.add(group);
  return { group, trees, gateObstacles: gate.obstacles, ground };
}

// ---------- 지형 + 바닥 그림 ----------

function buildGround(campus, px, anisotropy) {
  const xs = campus.boundary.map((p) => p[0]), zs = campus.boundary.map((p) => p[1]);
  const bounds = {
    x0: Math.min(...xs) - GROUND_MARGIN, x1: Math.max(...xs) + GROUND_MARGIN,
    z0: Math.min(...zs) - GROUND_MARGIN, z1: Math.max(...zs) + GROUND_MARGIN,
  };
  const material = new THREE.MeshLambertMaterial();
  const paint = (size) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = Math.round((size * (bounds.z1 - bounds.z0)) / (bounds.x1 - bounds.x0));
    paintGround(canvas, campus, bounds);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    material.map?.dispose();
    material.map = tex;
    material.needsUpdate = true;
  };
  paint(px);
  const mesh = new THREE.Mesh(buildTerrainGeometry(bounds), material);
  mesh.receiveShadow = true;
  return {
    mesh, bounds,
    // 품질을 바꾸면 바닥 그림 해상도도 바꾼다 (높음 4096, 낮음 2048)
    setResolution(size) {
      if (material.map.image.width !== size) paint(size);
    },
  };
}

// 바닥 그림 순서: 땅 → 캠퍼스 포장면 → 녹지·운동장(큰 것부터) → 물 → 주차장 → 주차선·코트 라인 → 보행로 → 차도 → 계단
// 차도는 지형 메시(buildRoadMeshes)가 위를 덮으므로 가장자리 계단이 삐져나오지 않게 조금 좁게 칠하고, 차선은 메시로만 그린다.
function paintGround(canvas, campus, bounds) {
  const g = canvas.getContext('2d');
  const P = new GroundPainter(g, bounds, canvas.width / (bounds.x1 - bounds.x0));
  g.fillStyle = GROUND_COLOR;
  g.fillRect(0, 0, canvas.width, canvas.height);
  P.polygon(campus.boundary, CAMPUS_COLOR);

  const sorted = campus.greens.filter((x) => GREEN_COLORS[x.kind] && x.kind !== 'water')
    .sort((a, b) => Math.abs(area(b.outline)) - Math.abs(area(a.outline)));
  for (const x of sorted) P.polygon(x.outline, groundColor(x));
  for (const w of campus.greens.filter((x) => x.kind === 'water')) {
    P.polygon(w.outline, WATER_COLOR);
    P.ribbon([...w.outline, w.outline[0]], 1.1, WATER_EDGE_COLOR);
  }

  for (const o of campus.parking || []) P.polygon(o, PARKING_COLOR);
  for (const o of campus.parking || []) parkingLines(P, o, MARK_COLOR);
  for (const x of sorted) if ((x.kind === 'pitch' || x.kind === 'dirt') && Math.abs(area(x.outline)) > 150) courtLines(P, x, MARK_COLOR);

  for (const r of campus.roads) if (!r.car) P.ribbon(r.points, r.width, FOOT_COLOR);
  for (const r of campus.roads) if (r.car) P.ribbon(r.points, Math.max(1, r.width - 1), ASPHALT_COLOR);
  for (const r of campus.roads) if (r.type === 'steps') P.dashes(r.points, r.width, 0.3, 0.45, STEP_COLOR);

  // 가장자리를 땅 색으로 → 그림 밖 지형(텍스처 가장자리 색이 늘어남)도 땅 색
  g.strokeStyle = GROUND_COLOR;
  g.lineWidth = 6;
  g.strokeRect(0, 0, canvas.width, canvas.height);
}

// 바닥 좌표(m)로 캔버스에 그리는 붓. 아주 가는 선도 1픽셀 이상으로
class GroundPainter {
  constructor(g, bounds, scale) {
    Object.assign(this, { g, bounds, s: scale });
  }

  path(points, close) {
    const { g, bounds: b, s } = this;
    g.beginPath();
    points.forEach(([x, z], i) => {
      if (i) g.lineTo((x - b.x0) * s, (z - b.z0) * s);
      else g.moveTo((x - b.x0) * s, (z - b.z0) * s);
    });
    if (close) g.closePath();
  }

  polygon(outline, color) {
    this.path(outline, true);
    this.g.fillStyle = color;
    this.g.fill();
  }

  // 폭 width(m)의 띠, 꺾이는 곳과 끝은 둥글게
  ribbon(points, width, color) {
    const { g } = this;
    this.path(points, false);
    g.lineWidth = Math.max(1, width * this.s);
    g.lineJoin = g.lineCap = 'round';
    g.strokeStyle = color;
    g.stroke();
  }

  // (x1, z1)→(x2, z2) 선분을 반폭 h(m)로
  quad(x1, z1, x2, z2, h, color) {
    const { g } = this;
    this.path([[x1, z1], [x2, z2]], false);
    g.lineWidth = Math.max(1, 2 * h * this.s);
    g.lineCap = 'butt';
    g.strokeStyle = color;
    g.stroke();
  }

  // 선을 따라 dash m 칠하고 gap m 비우는 점선 (폭 width m)
  dashes(points, width, dash, gap, color) {
    const { g, s } = this;
    this.path(points, false);
    g.setLineDash([dash * s, gap * s]);
    g.lineWidth = Math.max(1.2, width * s);
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    g.strokeStyle = color;
    g.stroke();
    g.setLineDash([]);
  }
}

// ---------- 차도·차선 (지형을 따라 휘는 메시) ----------

// 바닥 그림은 1픽셀이 약 0.4m라 가까이서 도로 가장자리가 계단처럼 보인다.
// 차도와 차선만 지형 위에 얇게 얹은 메시로 다시 그린다. 깊이 테스트를 켜서 언덕 뒤에선 가려지고,
// polygonOffset + 살짝 띄운 높이로 바닥 위에 그려 깜빡이지 않는다. (바닥 그림의 차도는 조금 좁게 칠해 밑에 깔아 둠)
const ROAD_LIFT = 0.07, LANE_LIFT = 0.11; // 땅에서 띄우는 높이 (m)
const DRAPE_STEP = 2.5;                     // 지형을 따라가도록 나누는 간격 (m)
const JOINT_ANGLE = 0.14;                   // 이보다 많이 꺾이는 곳(약 8°)에만 둥근 이음

function buildRoadMeshes(campus) {
  const road = new DrapeBuilder(ROAD_LIFT), lane = new DrapeBuilder(LANE_LIFT);
  for (const r of campus.roads) {
    if (!r.car) continue;
    const pts = r.points, h = r.width / 2;
    for (let i = 0; i < pts.length - 1; i++) road.strip(pts[i], pts[i + 1], h);
    pts.forEach((p, i) => {
      const end = i === 0 || i === pts.length - 1;
      if (end || turnAngle(pts[i - 1], p, pts[i + 1]) > JOINT_ANGLE) road.disc(p, h);
    });
    forEachDash(pts, 3, 4, (a, b) => lane.strip(a, b, 0.15));
  }
  const mat = (color, units) => new THREE.MeshLambertMaterial({
    color, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: units,
  });
  const roads = road.mesh(mat(ASPHALT_COLOR, -2));
  const lanes = lane.mesh(mat(LANE_COLOR, -4));
  roads.receiveShadow = lanes.receiveShadow = true;
  return [roads, lanes];
}

class DrapeBuilder {
  constructor(lift) {
    this.lift = lift;
    this.pos = [];
    this.index = [];
  }

  vertex(x, z) {
    this.pos.push(x, heightAt(x, z) + this.lift, z);
    return this.pos.length / 3 - 1;
  }

  // a→b 선분을 반폭 h로, 길이·폭 방향 모두 DRAPE_STEP 간격으로 나눈 띠
  strip(a, b, h) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) return;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const nu = Math.max(1, Math.ceil(len / DRAPE_STEP)), nv = Math.max(1, Math.ceil((2 * h) / DRAPE_STEP));
    const first = this.pos.length / 3;
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const t = (len * i) / nu, s = -h + (2 * h * j) / nv;
        this.vertex(a[0] + ux * t - uz * s, a[1] + uz * t + ux * s);
      }
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const k = first + i * (nv + 1) + j;
        this.quad(k, k + nv + 1, k + nv + 2, k + 1);
      }
    }
  }

  // 꺾이는 곳·끝을 메우는 둥근 판 (가운데에서 바깥으로 고리 몇 개)
  disc([x, z], r) {
    const seg = 12, rings = Math.max(1, Math.ceil(r / DRAPE_STEP));
    const center = this.vertex(x, z);
    const ring = (k) => Array.from({ length: seg }, (_, i) => {
      const a = (i / seg) * Math.PI * 2, rr = (r * k) / rings;
      return this.vertex(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
    });
    let prev = ring(1);
    for (let i = 0; i < seg; i++) this.tri(center, prev[i], prev[(i + 1) % seg]);
    for (let k = 2; k <= rings; k++) {
      const cur = ring(k);
      for (let i = 0; i < seg; i++) this.quad(prev[i], cur[i], cur[(i + 1) % seg], prev[(i + 1) % seg]);
      prev = cur;
    }
  }

  // 위(+y)를 보도록 감기 방향을 맞춘 삼각형
  tri(a, b, c) {
    const P = this.pos;
    const cross = (P[b * 3 + 2] - P[a * 3 + 2]) * (P[c * 3] - P[a * 3]) - (P[b * 3] - P[a * 3]) * (P[c * 3 + 2] - P[a * 3 + 2]);
    if (cross < 0) this.index.push(a, c, b);
    else this.index.push(a, b, c);
  }

  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  mesh(material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setIndex(this.index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, material);
  }
}

function turnAngle(a, b, c) {
  const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]), a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  return Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
}

// 선을 따라 dash m 칠하고 gap m 비우는 점선의 칠하는 구간마다 cb(시작점, 끝점)
function forEachDash(points, dash, gap, cb) {
  let phase = 0; // 지금 칸(dash+gap) 안에서 간 거리
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, z1] = points[i], [x2, z2] = points[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
    let t = 0;
    while (t < len) {
      const step = Math.min(len - t, (phase < dash ? dash : dash + gap) - phase);
      if (phase < dash) cb([x1 + ux * t, z1 + uz * t], [x1 + ux * (t + step), z1 + uz * (t + step)]);
      t += step;
      phase = (phase + step) % (dash + gap);
    }
  }
}

// ---------- 물·주차장·운동장 ----------

function groundColor(g) {
  const sport = SPORT_COLORS[g.sport];
  if (sport) return sport[g.kind === 'dirt' ? 1 : 0];
  return GREEN_COLORS[g.kind];
}

// 연못: 바닥 그림의 물 위에, 지형을 따라 얹은 살짝 반짝이는 수면(잔물결 텍스처가 천천히 흐름)
function buildWater(list) {
  const pos = [];
  const add = (a, b, c) => {
    const L = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
    if (L > 4) { // 지형을 따라가도록 잘게 나눈다
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      add(a, ab, ca); add(ab, b, bc); add(ca, bc, c); add(ab, bc, ca);
      return;
    }
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    for (const p of cross < 0 ? [a, c, b] : [a, b, c]) pos.push(p[0], heightAt(p[0], p[1]) + 0.08, p[1]);
  };
  for (const w of list) {
    const contour = w.outline.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) add(w.outline[i], w.outline[j], w.outline[k]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) { uv[j] = pos[i] / 9; uv[j + 1] = pos[i + 2] / 9; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const tex = makeRippleTexture();
  const surface = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
    color: WATER_COLOR, map: tex, shininess: 80, specular: '#cfe6f2',
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  }));
  surface.onBeforeRender = () => {
    const t = performance.now() / 1000;
    tex.offset.set(t * 0.012, t * 0.007);
  };
  return surface;
}

function mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function makeRippleTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  g.fillStyle = '#e4eef4';
  g.fillRect(0, 0, S, S);
  const rand = mulberry32(7);
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = rand() * S, y = rand() * S, w = 10 + rand() * 26;
    g.strokeStyle = rand() < 0.5 ? 'rgba(255,255,255,0.95)' : 'rgba(120,160,190,0.75)';
    g.lineWidth = 1.5 + rand() * 2;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { // 이음매 없이 반복되게
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.quadraticCurveTo(x + dx + w / 2, y + dy - 3, x + dx + w, y + dy);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 다각형을 가장 작게 감싸는 회전 사각형: 중심, 긴 변 방향(u), 길이 L(긴 변)·W(짧은 변)
function orientedRect(o) {
  let best = null;
  for (let i = 0; i < o.length; i++) {
    const [x1, z1] = o[i], [x2, z2] = o[(i + 1) % o.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of o) {
      const u = x * ux + z * uz, v = -x * uz + z * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const a = (u1 - u0) * (v1 - v0);
    if (!best || a < best.a) best = { a, ux, uz, u0, u1, v0, v1 };
  }
  let { ux, uz, u0, u1, v0, v1 } = best;
  if (v1 - v0 > u1 - u0) { // u를 긴 변으로 (축을 90° 돌림: 새 u = 옛 v, 새 v = -옛 u)
    [ux, uz] = [-uz, ux];
    [u0, u1, v0, v1] = [v0, v1, -u1, -u0];
  }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ux, uz, L: u1 - u0, W: v1 - v0 };
}

// 회전 사각형의 (u, v) 좌표 → 바닥 좌표
function rectPoint(r, u, v) {
  return [r.cx + u * r.ux - v * r.uz, r.cz + u * r.uz + v * r.ux];
}

// 주차 칸: 긴 변을 따라 2.5m 간격, 깊이 5m 선 (넓으면 양쪽 줄)
function parkingLines(b, o, color) {
  if (Math.abs(area(o)) < 60) return;
  const r = orientedRect(o);
  if (r.W < 5.5) return;
  const rows = r.W >= 13 ? [-1, 1] : [-1];
  for (const side of rows) {
    const v0 = side * (r.W / 2 - 0.3), v1 = side * (r.W / 2 - 5.3);
    for (let u = -r.L / 2 + 1.5; u <= r.L / 2 - 1.5; u += 2.5) {
      const a = rectPoint(r, u, v0), c = rectPoint(r, u, v1);
      if (pointInPolygon(...a, o) && pointInPolygon(...c, o)) b.quad(...a, ...c, 0.07, color);
    }
  }
}

// 운동장 라인: 종류별로 단순한 코트 그림. 큰 테니스장·농구장은 여러 면으로 나눈다
function courtLines(b, g, color) {
  const r = orientedRect(g.outline);
  if (r.W < 6) return;
  const w = 0.09; // 선 굵기의 절반
  const line = (u1, v1, u2, v2) => b.quad(...rectPoint(r, u1, v1), ...rectPoint(r, u2, v2), w, color);
  const box = (L, W, du = 0, dv = 0) => {
    const a = L / 2, c = W / 2;
    line(du - a, dv - c, du + a, dv - c); line(du + a, dv - c, du + a, dv + c);
    line(du + a, dv + c, du - a, dv + c); line(du - a, dv + c, du - a, dv - c);
  };
  const arc = (cu, cv, rad, from = 0, to = Math.PI * 2) => {
    const n = Math.max(8, Math.round((rad * 4 * (to - from)) / Math.PI));
    for (let i = 0; i < n; i++) {
      const a0 = from + ((to - from) * i) / n, a1 = from + ((to - from) * (i + 1)) / n;
      line(cu + Math.cos(a0) * rad, cv + Math.sin(a0) * rad, cu + Math.cos(a1) * rad, cv + Math.sin(a1) * rad);
    }
  };
  // 한 면의 크기(바깥 여유 포함)로 몇 면이 들어가는지 정하고, 면마다 draw(du, dv, s) 호출
  const tile = (cellL, cellW, draw) => {
    const nu = Math.max(1, Math.round(r.L / cellL)), nv = Math.max(1, Math.round(r.W / cellW));
    const s = Math.min(1, r.L / nu / cellL, r.W / nv / cellW);
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) draw(-r.L / 2 + (i + 0.5) * (r.L / nu), -r.W / 2 + (j + 0.5) * (r.W / nv), s);
    }
  };
  switch (g.sport) {
    case 'tennis':
      tile(36, 18, (du, dv, s) => {
        box(23.77 * s, 10.97 * s, du, dv);
        line(du, dv - 6.4 * s, du, dv + 6.4 * s); // 네트
        for (const k of [-1, 1]) {
          line(du - 11.88 * s, dv + k * 4.11 * s, du + 11.88 * s, dv + k * 4.11 * s); // 단식 사이드라인
          line(du + k * 6.4 * s, dv - 4.11 * s, du + k * 6.4 * s, dv + 4.11 * s);     // 서비스 라인
        }
        line(du - 6.4 * s, dv, du + 6.4 * s, dv);
      });
      break;
    case 'basketball':
      tile(32, 19, (du, dv, s) => {
        box(28 * s, 15 * s, du, dv);
        line(du, dv - 7.5 * s, du, dv + 7.5 * s);
        arc(du, dv, 1.8 * s);
        for (const k of [-1, 1]) {
          const end = du + k * 14 * s;
          box(5.8 * s, 4.9 * s, end - k * 2.9 * s, dv);
          // 3점 라인: 골대 쪽에서 코트 안쪽으로 열린 반원
          arc(end - k * 1.6 * s, dv, 6.75 * s, k > 0 ? Math.PI / 2 : -Math.PI / 2, k > 0 ? Math.PI * 1.5 : Math.PI / 2);
        }
      });
      break;
    case 'volleyball':
      tile(24, 15, (du, dv, s) => {
        box(18 * s, 9 * s, du, dv);
        line(du, dv - 4.5 * s, du, dv + 4.5 * s);
        for (const k of [-1, 1]) line(du + k * 3 * s, dv - 4.5 * s, du + k * 3 * s, dv + 4.5 * s);
      });
      break;
    default: { // 축구·풋살·다목적·종류 없음: 테두리, 가운데 선과 원, 양쪽 골 구역
      const L = r.L - 2.5, W = r.W - 2.5;
      box(L, W);
      line(0, -W / 2, 0, W / 2);
      arc(0, 0, Math.min(9.15, W * 0.14));
      for (const k of [-1, 1]) {
        const pd = Math.min(16.5, L * 0.15), pw = Math.min(40, W * 0.6);
        box(pd, pw, k * (L / 2 - pd / 2), 0);
        box(pd / 3, pw / 2.2, k * (L / 2 - pd / 6), 0);
      }
    }
  }
}

// ---------- 건물 ----------

// 한 칸 = 가로 3m × 한 층 3.5m. 흰 벽 + 층 사이 가로줄 + 창문. 벽 색은 정점 색과 곱해진다.
function makeWindowTexture(anisotropy) {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#c9c9c9'; // 층 사이 가로줄 (슬래브)
  g.fillRect(0, 0, S, 9);
  const grad = g.createLinearGradient(0, 34, 0, 100);
  grad.addColorStop(0, '#7f9ab4');
  grad.addColorStop(1, '#4b6178');
  g.fillStyle = '#e2e5e8'; // 창틀
  g.fillRect(16, 32, 96, 70);
  g.fillStyle = grad;
  g.fillRect(20, 36, 88, 62);
  g.fillStyle = '#e2e5e8'; // 가운데 창살
  g.fillRect(62, 36, 4, 62);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

class MeshBuilder {
  constructor(withUv) {
    this.pos = []; this.nor = []; this.col = []; this.uv = withUv ? [] : null;
  }

  // 삼각형의 면 방향이 n과 같도록 감기 방향을 맞춘다
  tri(a, b, c, n, color, uvs) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    let pts = [a, b, c], tuv = uvs;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
      pts = [a, c, b];
      tuv = uvs && [uvs[0], uvs[2], uvs[1]];
    }
    pts.forEach((p, i) => {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
      if (this.uv) this.uv.push(tuv[i][0], tuv[i][1]);
    });
  }

  // 세로 벽 사각형 (p1→p2, 높이 y0~y1), 바깥 법선 n. 창문 층은 높이 base부터 센다
  wall(p1, p2, y0, y1, n, color, u1 = 0, base = 0) {
    const a = [p1[0], y0, p1[1]], b = [p2[0], y0, p2[1]], c = [p2[0], y1, p2[1]], d = [p1[0], y1, p1[1]];
    const v0 = (y0 - base) / FLOOR_M, v1 = (y1 - base) / FLOOR_M;
    this.tri(a, b, c, n, color, [[0, v0], [u1, v0], [u1, v1]]);
    this.tri(a, c, d, n, color, [[0, v0], [u1, v1], [0, v1]]);
  }

  geometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.computeBoundingSphere();
    return geo;
  }
}

// 벽(창문 텍스처)과 지붕·입구(텍스처 없음)를 각각 한 메시로.
// 지붕을 텍스처 메시에 넣으면 멀리서 밉맵 평균 때문에 창문색이 섞여 어두워진다.
function buildBuildings(list, anisotropy) {
  const walls = new MeshBuilder(true);
  const plain = new MeshBuilder(false);
  const entrance = new THREE.Color(ENTRANCE_COLOR);

  for (const b of list) {
    const o = b.outline;
    if (o.length < 3) continue;
    const k = hash(b.id);
    const wall = new THREE.Color(WALL_COLORS[k % WALL_COLORS.length]);
    const roof = new THREE.Color(ROOF_COLORS[(k >> 4) % ROOF_COLORS.length]);
    if (!b.inCampus) {
      wall.lerp(OUTSIDE_TINT, OUTSIDE_MIX);
      roof.lerp(OUTSIDE_TINT, OUTSIDE_MIX);
    }
    // 외곽선 안 가장 낮은 땅에서 시작하고, 벽은 그보다 더 내려 비탈 쪽이 뜨지 않게 묻는다
    const base = heightRange(o).lo;
    b.base = base;
    const h = base + b.height;
    const sign = area(o) > 0 ? 1 : -1;
    let longest = null;

    for (let i = 0; i < o.length; i++) {
      const p1 = o[i], p2 = o[(i + 1) % o.length];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (len < 1e-6) continue;
      // 바깥쪽 법선 (면적이 +면 (dz, -dx) 쪽이 바깥)
      const n = [((p2[1] - p1[1]) / len) * sign, 0, (-(p2[0] - p1[0]) / len) * sign];
      // 변마다 창문이 딱 맞게 들어가도록 칸 수를 정수로
      walls.wall(p1, p2, base - BURY_M, h, n, wall, Math.max(1, Math.round(len / BAY_M)), base);
      if (!longest || len > longest.len) longest = { p1, p2, n, len };
    }

    const contour = o.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [i, j, m] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      plain.tri([o[i][0], h, o[i][1]], [o[j][0], h, o[j][1]], [o[m][0], h, o[m][1]], [0, 1, 0], roof);
    }

    // 가장 긴 벽 가운데 1층에 어두운 입구
    if (longest && longest.len >= 6 && b.height >= 3.5) {
      const { p1, p2, n, len } = longest;
      const w = Math.min(6, len * 0.4) / 2 / len;
      const off = 0.06;
      const q = (t) => [p1[0] + (p2[0] - p1[0]) * t + n[0] * off, p1[1] + (p2[1] - p1[1]) * t + n[2] * off];
      // 입구는 그 자리 땅 높이에서 (언덕 쪽이면 그만큼 위에)
      const gy = heightAt(...q(0.5));
      plain.wall(q(0.5 - w), q(0.5 + w), gy - 0.3, gy + 3, n, entrance);
      // 연출(교수님 등장)에서 쓰도록 입구 위치와 바깥 방향을 기록
      b.entrance = { x: (p1[0] + p2[0]) / 2, z: (p1[1] + p2[1]) / 2, nx: n[0], nz: n[2], y: gy };
    }
  }

  const wallMesh = new THREE.Mesh(walls.geometry(), new THREE.MeshLambertMaterial({
    vertexColors: true, map: makeWindowTexture(anisotropy),
  }));
  const plainMesh = new THREE.Mesh(plain.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  for (const m of [wallMesh, plainMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  return [wallMesh, plainMesh];
}

// ---------- 나무 ----------

const TREE = {
  roadSpacing: 11,   // 차도 옆 나무 간격 (m)
  roadGap: 2.5,      // 차도 가장자리에서 떨어진 거리
  perArea: { forest: 80, park: 260, grass: 450 }, // 나무 한 그루당 넓이 (m²)
  max: 7000,
};
const CROWN_COLORS = ['#5f9e4a', '#6fae52', '#4f8c42', '#7db85a', '#5a9550'];

// 차도 양옆과 녹지 안에 저폴리 나무를 InstancedMesh로 심는다.
// 순서를 섞어 두어서, 개수(count)를 절반으로 줄이면 골고루 절반만 보인다.
function buildTrees(campus) {
  const rand = mulberry32(20261025);
  const blocked = makeTreeBlocker(campus);
  const spots = []; // [x, z, 크기, 원뿔형?]

  const [gx, gz] = campus.spawn.gate;
  const gateClear = Math.max(GATE.minOpening, campus.spawn.gateRoadWidth || 0) / 2 + GATE.pillar + 4;
  const add = (x, z, coniferChance) => {
    if (spots.length >= TREE.max || blocked(x, z) || Math.hypot(x - gx, z - gz) < gateClear) return;
    spots.push([x, z, 0.8 + rand() * 0.5, rand() < coniferChance]);
  };

  for (const r of campus.roads) {
    if (!r.car) continue;
    const off = r.width / 2 + TREE.roadGap;
    let carry = rand() * TREE.roadSpacing;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [x1, z1] = r.points[i], [x2, z2] = r.points[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1e-6) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      for (let t = carry; t < len; t += TREE.roadSpacing) {
        const x = x1 + ux * t, z = z1 + uz * t;
        add(x - uz * off, z + ux * off, 0.15);
        add(x + uz * off, z - ux * off, 0.15);
      }
      carry = (carry - len) % TREE.roadSpacing;
      if (carry < 0) carry += TREE.roadSpacing;
    }
  }

  for (const g of campus.greens) {
    const per = TREE.perArea[g.kind];
    if (!per) continue;
    const o = g.outline;
    const n = Math.round(Math.abs(area(o)) / per);
    const xs = o.map((p) => p[0]), zs = o.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    let placed = 0;
    for (let tries = 0; placed < n && tries < n * 6; tries++) {
      const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0);
      if (!pointInPolygon(x, z, o)) continue;
      const before = spots.length;
      add(x, z, g.kind === 'forest' ? 0.4 : 0.15);
      if (spots.length > before) placed++;
    }
  }

  // 섞기
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 5).translate(0, 1.2, 0);
  const roundGeo = new THREE.IcosahedronGeometry(2.1, 0).translate(0, 3.9, 0);
  const coneGeo = new THREE.ConeGeometry(1.9, 5.2, 7).translate(0, 4.6, 0);
  const crownMat = new THREE.MeshLambertMaterial({ flatShading: true });
  const round = spots.filter((s) => !s[3]), cone = spots.filter((s) => s[3]);
  const meshes = [
    [new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#8a6a4f' }), spots.length), spots],
    [new THREE.InstancedMesh(roundGeo, crownMat, round.length), round],
    [new THREE.InstancedMesh(coneGeo, crownMat, cone.length), cone],
  ];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), color = new THREE.Color();
  const group = new THREE.Group();
  for (const [mesh, list] of meshes) {
    list.forEach(([x, z, size], i) => {
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      m.compose(p.set(x, heightAt(x, z) - 0.2, z), q, s.set(size, size * (0.9 + rand() * 0.25), size));
      mesh.setMatrixAt(i, m);
      if (mesh.material === crownMat) mesh.setColorAt(i, color.set(CROWN_COLORS[Math.floor(rand() * CROWN_COLORS.length)]));
    });
    mesh.castShadow = true;
    mesh.userData.total = list.length;
    group.add(mesh);
  }

  return {
    group,
    count: spots.length,
    // 1 = 전부, 0.5 = 절반
    setDensity(f) {
      for (const [mesh] of meshes) mesh.count = Math.floor(mesh.userData.total * f);
    },
    // (x, z) 둘레 r 안의 나무를 없앤다 (연출 카메라를 가리지 않게)
    clearAround(x, z, r) {
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (const [mesh, list] of meshes) {
        list.forEach(([tx, tz], i) => { if (Math.hypot(tx - x, tz - z) < r) mesh.setMatrixAt(i, zero); });
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

// 나무를 심으면 안 되는 곳: 건물 안·가까이, 도로 위, 물 위
function makeTreeBlocker(campus) {
  const cell = 20;
  const edges = new Map(), roads = new Map(), insides = new Map();
  const put = (map, x, z, item) => {
    const k = `${x},${z}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  };
  const putRange = (map, xa, za, xb, zb, pad, item) => {
    for (let x = Math.floor((Math.min(xa, xb) - pad) / cell); x <= Math.floor((Math.max(xa, xb) + pad) / cell); x++) {
      for (let z = Math.floor((Math.min(za, zb) - pad) / cell); z <= Math.floor((Math.max(za, zb) + pad) / cell); z++) put(map, x, z, item);
    }
  };

  for (const b of campus.buildings) {
    const o = b.outline;
    o.forEach((p, i) => { const q = o[(i + 1) % o.length]; putRange(edges, p[0], p[1], q[0], q[1], 3, [p[0], p[1], q[0], q[1]]); });
    const xs = o.map((p) => p[0]), zs = o.map((p) => p[1]);
    putRange(insides, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), 0, o);
  }
  for (const r of campus.roads) {
    const clear = r.width / 2 + (r.car ? 1.5 : 0.6);
    for (let i = 0; i < r.points.length - 1; i++) {
      const [xa, za] = r.points[i], [xb, zb] = r.points[i + 1];
      putRange(roads, xa, za, xb, zb, clear, [xa, za, xb, zb, clear]);
    }
  }
  const waters = campus.greens.filter((g) => g.kind === 'water').map((g) => g.outline);

  return (x, z) => {
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    for (const e of edges.get(k) || []) if (distToSegment(x, z, e) < 3) return true;
    for (const e of roads.get(k) || []) if (distToSegment(x, z, e) < e[4]) return true;
    for (const o of insides.get(k) || []) if (pointInPolygon(x, z, o)) return true;
    for (const o of waters) if (pointInPolygon(x, z, o)) return true;
    return false;
  };
}

// ---------- 정문 ----------

const GATE = { height: 9, pillar: 1.8, beamH: 1.8, depth: 1.6, minOpening: 14, text: '전남대학교' };

// 양쪽 기둥 + 위 가로 보 + "전남대학교" 글자. 로고·엠블럼은 넣지 않는다.
// 로컬 +z = 캠퍼스 안쪽 방향. 기둥은 충돌용 사각형(obstacles)으로도 돌려준다.
function buildGate(spawn) {
  const [gx, gz] = spawn.gate;
  const [dx, dz] = spawn.dir;
  const half = Math.max(GATE.minOpening, spawn.gateRoadWidth || 0) / 2 + 1;
  const px = half + GATE.pillar / 2; // 기둥 중심까지 거리

  const group = new THREE.Group();
  const lx = Math.cos(Math.atan2(dx, dz)), lz = -Math.sin(Math.atan2(dx, dz));
  group.position.set(gx, Math.min(heightAt(gx + lx * px, gz + lz * px), heightAt(gx - lx * px, gz - lz * px)), gz);
  group.rotation.y = Math.atan2(dx, dz);

  const stone = new THREE.MeshLambertMaterial({ color: '#d4cdbf' });
  const navy = new THREE.MeshLambertMaterial({ color: '#2f3d5c' });
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(GATE.pillar, GATE.height + 2, GATE.pillar), stone);
    pillar.position.set(sx * px, GATE.height / 2 - 1, 0);
    pillar.castShadow = pillar.receiveShadow = true;
    group.add(pillar);
  }
  const beamLen = 2 * (half + GATE.pillar) + 1;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(beamLen, GATE.beamH, GATE.depth), navy);
  beam.position.y = GATE.height - GATE.beamH / 2;
  beam.castShadow = true;
  group.add(beam);

  const textMat = new THREE.MeshBasicMaterial({ map: makeTextTexture(GATE.text), transparent: true, fog: true });
  const textGeo = new THREE.PlaneGeometry(beamLen * 0.6, GATE.beamH * 0.8);
  for (const side of [-1, 1]) {
    const plane = new THREE.Mesh(textGeo, textMat);
    plane.position.set(0, beam.position.y, side * (GATE.depth / 2 + 0.02));
    if (side < 0) plane.rotation.y = Math.PI; // 바깥(출발 쪽)에서도 바로 읽히게
    group.add(plane);
  }

  // 기둥 외곽선 (월드 좌표)
  const rx = [Math.cos(group.rotation.y), -Math.sin(group.rotation.y)]; // 로컬 +x의 월드 방향 (x, z)
  const obstacles = [-1, 1].map((sx) => {
    const cx = gx + rx[0] * sx * px, cz = gz + rx[1] * sx * px;
    const h = GATE.pillar / 2;
    return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) => [cx + rx[0] * a + dx * b, cz + rx[1] * a + dz * b]);
  });
  return { group, obstacles };
}

function makeTextTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.font = '800 72px "Pretendard", "Malgun Gothic", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.split('').join(' '), 256, 52);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- 도우미 ----------

export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function distToSegment(px, pz, [x1, z1, x2, z2]) {
  const dx = x2 - x1, dz = z2 - z1;
  const L = dx * dx + dz * dz;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L));
  return Math.hypot(px - x1 - t * dx, pz - z1 - t * dz);
}

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < xi + ((z - zi) * (xj - xi)) / (zj - zi)) inside = !inside;
  }
  return inside;
}

export function area(o) {
  let s = 0;
  for (let i = 0; i < o.length; i++) {
    const [x1, z1] = o[i];
    const [x2, z2] = o[(i + 1) % o.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
