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
// 외관 종류 (data/building-floors.csv "외관" 칸, 비우면 콘크리트) → 외벽색을 안 적었을 때의 기본색
const FACADE_COLORS = { 커튼월: '#e3edf4', 벽돌: '#a65a44', 타일: '#ece7dc', 석재: '#d8d2c4' };
const OUTSIDE_TINT = new THREE.Color('#eceef0');
const OUTSIDE_MIX = 0.45;

const FLOOR_M = 4; // 층 높이 (campus.json 높이 = 층수 × 4m + 난간 1m)
const BAY_M = 3;     // 창문 하나의 가로 폭
const BURY_M = 1.5;  // 벽을 가장 낮은 땅보다 더 내려 묻는 깊이
// 가벼운 앰비언트 오클루전(미리 구움): 벽 아래쪽은 땅·옆 건물에 가려 어둡게, 바닥 그림엔 건물 둘레 접지 그림자
const AO = { wallDark: 0.68, wallH: 6, groundAlpha: 0.3, groundBlur: 3.2 }; // 벽 바닥 밝기 비율, 어두워지는 높이(m), 바닥 그림자 진하기·번짐(m)

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
const MEDIAN_COLOR = '#6f8f5c';  // 가운데 분리대 (나무 띠)
const PARKING_COLOR = '#6b6e73'; // 주차장 바닥 (짙은 회색)
const MARK_COLOR = '#f6f6f0';    // 주차선·코트 라인
const WATER_COLOR = '#6cb8dc';
const WATER_EDGE_COLOR = '#b9b2a4'; // 연못 가장자리 돌
const BANK_COLOR = '#a99f86';     // 평평하게 고른 연못의 드러난 둑 (젖은 흙빛)
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

// 단계별로 켜는 장식 (밤샘 4단계에서 켬): treeKinds 나무 다양화, wallShade 벽 아래 음영·건물 둘레 접지 그림자
const LOOK = { treeKinds: true, wallShade: true };

export function buildMap(scene, campus, { anisotropy = 1, groundPx = 4096, terrainFar = 3000, drape = null, treeKinds = true, wallShade = true } = {}) {
  const group = new THREE.Group();
  if (drape) [DRAPE_STEP, DRAPE_FINE, DRAPE_DISC] = drape;
  Object.assign(LOOK, { treeKinds, wallShade });

  const ground = buildGround(campus, groundPx, anisotropy, terrainFar);
  group.add(ground.mesh);
  group.add(buildWater(campus.greens.filter((g) => g.kind === 'water')));
  group.add(...buildRoadMeshes(campus));

  const buildings = buildBuildings(campus.buildings, anisotropy);
  group.add(...buildings);

  const trees = buildTrees(campus);
  group.add(trees.group);

  const gate = buildGate();
  group.add(gate.group);

  freeAfterUpload(group); // 정점 배열은 GPU에 올린 뒤 램에서 해제 (나무 위치 행렬은 그대로)
  scene.add(group);
  return { group, trees, gateObstacles: gate.obstacles, ground, clock: clockTower };
}

// 메모리 절약: 바뀌지 않는 메시의 정점·색·uv·인덱스 배열을 GPU에 올린 직후 자바스크립트 쪽에서 버린다.
// (내장 그래픽은 GPU 메모리도 램을 쓰므로 같은 데이터가 두 번 램을 차지하던 것을 한 번으로)
// 경계 구는 미리 계산해 둔다. 나중에 정점을 다시 읽거나 고치는 메시에는 쓰지 않는다.
const dropArray = function () { this.array = null; };
export function freeAfterUpload(obj) {
  obj.traverse((o) => {
    const g = o.geometry;
    if (!g || g.userData.keepArrays) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    for (const a of Object.values(g.attributes)) a.onUpload(dropArray);
    if (g.index) g.index.onUpload(dropArray);
  });
  return obj;
}

// ---------- 지형 + 바닥 그림 ----------

function buildGround(campus, px, anisotropy, far) {
  const xs = campus.boundary.map((p) => p[0]), zs = campus.boundary.map((p) => p[1]);
  const bounds = {
    x0: Math.min(...xs) - GROUND_MARGIN, x1: Math.max(...xs) + GROUND_MARGIN,
    z0: Math.min(...zs) - GROUND_MARGIN, z1: Math.max(...zs) + GROUND_MARGIN,
  };
  const material = new THREE.MeshLambertMaterial();
  let painted = 0;
  const paint = (size) => {
    painted = size;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = Math.round((size * (bounds.z1 - bounds.z0)) / (bounds.x1 - bounds.x0));
    paintGround(canvas, campus, bounds);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    tex.userData.size = [canvas.width, canvas.height]; // 해제한 뒤에도 크기를 알 수 있게 (메모리 측정용)
    tex.onUpdate = () => { canvas.width = canvas.height = 1; }; // GPU에 올린 뒤 원본 캔버스(최대 55MB)를 해제
    material.map?.dispose();
    material.map = tex;
    material.needsUpdate = true;
  };
  paint(px);
  const mesh = new THREE.Mesh(buildTerrainGeometry(bounds, far), material);
  mesh.receiveShadow = true;
  return {
    mesh, bounds,
    // 품질을 바꾸면 바닥 그림 해상도도 바꾼다 (높음 4096, 낮음 2048)
    setResolution(size) {
      if (painted !== size) paint(size);
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
  paintLawns(P, campus.lawns);
  for (const w of campus.greens.filter((x) => x.kind === 'water')) {
    // 수면을 평평하게 고른 물(용지)은 물 메시가 따로 덮으므로, 수면보다 높은 둑이 드러나는 곳은 물빛 대신 물가 흙빛
    P.polygon(w.outline, w.level !== undefined ? BANK_COLOR : WATER_COLOR);
    P.ribbon([...w.outline, w.outline[0]], 1.1, WATER_EDGE_COLOR);
  }

  for (const o of campus.parking || []) P.polygon(o, PARKING_COLOR);
  for (const o of campus.parking || []) parkingLines(P, o, MARK_COLOR);
  for (const x of sorted) if ((x.kind === 'pitch' || x.kind === 'dirt') && Math.abs(area(x.outline)) > 150) courtLines(P, x, MARK_COLOR);

  for (const r of campus.roads) if (!r.car) P.ribbon(r.points, r.width, FOOT_COLOR);
  // 건물 둘레 접지 그림자 (앰비언트 오클루전): 외곽선을 조금 넓혀 흐리게 칠함. 건물 사이 좁은 곳은 겹쳐서 더 어두움
  if (LOOK.wallShade) {
  g.save();
  g.filter = `blur(${Math.max(1, AO.groundBlur * P.s)}px)`;
  g.globalAlpha = AO.groundAlpha;
  g.lineJoin = 'round';
  for (const b of campus.buildings) {
    if (b.style?.canopy) continue;
    P.path(b.outline, true);
    g.fillStyle = '#2a2a24';
    g.fill();
    g.lineWidth = AO.groundBlur * P.s;
    g.strokeStyle = '#2a2a24';
    g.stroke();
  }
  g.restore();
  }
  for (const r of campus.roads) if (r.car) P.ribbon(r.points, Math.max(1, r.width - 1), ASPHALT_COLOR);
  for (const r of campus.roads) if (r.type === 'steps') P.dashes(r.points, r.width, 0.3, 0.45, STEP_COLOR);

  // 가장자리를 땅 색으로 → 그림 밖 지형(텍스처 가장자리 색이 늘어남)도 땅 색
  g.strokeStyle = GROUND_COLOR;
  g.lineWidth = 6;
  g.strokeRect(0, 0, canvas.width, canvas.height);
}

// 정사영상에서 찾은 잔디밭(data/lawns.json, 2m 칸): 칸마다 조금씩 다른 초록 원을 겹쳐 칠해 미세한 얼룩과 부드러운 가장자리
const LAWN_BASE = [159, 208, 122]; // GREEN_COLORS.grass와 같은 색
function paintLawns(P, lawns) {
  if (!lawns) return;
  const { g, bounds: b, s } = P;
  const r = lawns.cell * 0.78 * s;
  for (const [i, j] of lawns.cells) {
    const x = lawns.x0 + (i + 0.5) * lawns.cell, z = lawns.z0 + (j + 0.5) * lawns.cell;
    const n = (hash(`${i},${j}`) % 1000) / 1000 - 0.5; // -0.5~0.5
    const k = 1 + n * 0.12;
    g.fillStyle = `rgb(${Math.round(LAWN_BASE[0] * k)},${Math.round(LAWN_BASE[1] * (1 + n * 0.08))},${Math.round(LAWN_BASE[2] * k)})`;
    g.beginPath();
    g.arc((x - b.x0) * s, (z - b.z0) * s, r, 0, Math.PI * 2);
    g.fill();
  }
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
// 지형을 따라가도록 나누는 간격 (m): 기본 5m(차도 위 땅을 부드럽게 고친 뒤, 삼각형 약 1/4), 급히 꺾이는 곳 2.5m, 둥근 이음 3m.
// buildMap의 drape 옵션으로 바꿀 수 있다 (예전 지형에서는 2.5 / 1 / 1.5)
let DRAPE_STEP = 5, DRAPE_FINE = 2.5, DRAPE_DISC = 3;
const JOINT_ANGLE = 0.14;                   // 이보다 많이 꺾이는 곳(약 8°)에만 둥근 이음

function buildRoadMeshes(campus) {
  const road = new DrapeBuilder(ROAD_LIFT), lane = new DrapeBuilder(LANE_LIFT), median = new DrapeBuilder(LANE_LIFT);
  for (const r of campus.roads) {
    if (!r.car) continue;
    const pts = r.points, h = r.width / 2;
    for (let i = 0; i < pts.length - 1; i++) road.strip(pts[i], pts[i + 1], h);
    pts.forEach((p, i) => {
      const end = i === 0 || i === pts.length - 1;
      if (end || turnAngle(pts[i - 1], p, pts[i + 1]) > JOINT_ANGLE) road.disc(p, h);
    });
    // 차선: 분리대가 있으면 분리대(나무 띠) + 각 방향 차로 사이 점선, 4차로면 가운데 + 양쪽 점선, 아니면 가운데 점선
    const m = r.median || 0;
    const offsets = m ? [-(m / 2 + (r.width - m) / 4), m / 2 + (r.width - m) / 4] : r.lanes >= 4 ? [-r.width / 4, 0, r.width / 4] : [0];
    for (const off of offsets) forEachDash(offsetLine(pts, off), 3, 4, (a, b) => lane.strip(a, b, 0.15));
    if (m) for (let i = 0; i < pts.length - 1; i++) median.strip(pts[i], pts[i + 1], m / 2);
  }
  const mat = (color, units) => new THREE.MeshLambertMaterial({
    color, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: units,
  });
  const roads = road.mesh(mat(ASPHALT_COLOR, -2));
  const lanes = lane.mesh(mat(LANE_COLOR, -4));
  const medians = median.mesh(mat(MEDIAN_COLOR, -4));
  roads.receiveShadow = lanes.receiveShadow = medians.receiveShadow = true;
  return [roads, lanes, medians];
}

export class DrapeBuilder {
  constructor(lift) {
    this.lift = lift;
    this.pos = [];
    this.index = [];
  }

  // 둘레 0.6m 안 가장 높은 땅 위에 (격자 대각선 꺾임 때문에 땅이 도로를 뚫고 올라오지 않게)
  vertex(x, z) {
    const y = Math.max(heightAt(x, z), heightAt(x + 0.6, z), heightAt(x - 0.6, z), heightAt(x, z + 0.6), heightAt(x, z - 0.6));
    this.pos.push(x, y + this.lift, z);
    return this.pos.length / 3 - 1;
  }

  // a→b 선분을 반폭 h로, 길이·폭 방향 모두 DRAPE_STEP 간격으로 나눈 띠
  strip(a, b, h) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) return;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const step = this.bends(a, ux, uz, len, h) ? DRAPE_FINE : DRAPE_STEP;
    const nu = Math.max(1, Math.ceil(len / step)), nv = Math.max(1, Math.ceil((2 * h) / step));
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

  // 띠 위에서 지형이 2.5m 칸 안에서 6cm 넘게 꺾이는지 (가운데·양 가장자리 선을 0.5m 간격으로 봄)
  bends(a, ux, uz, len, h) {
    for (const s of [-h, 0, h]) {
      const ox = a[0] - uz * s, oz = a[1] + ux * s;
      for (let t0 = 0; t0 < len; t0 += DRAPE_STEP) {
        const t1 = Math.min(len, t0 + DRAPE_STEP);
        const y0 = heightAt(ox + ux * t0, oz + uz * t0), y1 = heightAt(ox + ux * t1, oz + uz * t1);
        for (let t = t0 + 0.5; t < t1; t += 0.5) {
          const lin = y0 + ((y1 - y0) * (t - t0)) / (t1 - t0);
          if (Math.abs(heightAt(ox + ux * t, oz + uz * t) - lin) > 0.06) return true;
        }
      }
    }
    return false;
  }

  // 꺾이는 곳·끝을 메우는 둥근 판 (가운데에서 바깥으로 고리 몇 개)
  disc([x, z], r) {
    // 둘레·고리 간격 약 DRAPE_DISC m (넓은 도로 끝의 큰 판도 지형을 따라가게)
    const seg = Math.max(10, Math.ceil((2 * Math.PI * r) / DRAPE_DISC)), rings = Math.max(1, Math.ceil(r / DRAPE_DISC));
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

// 선을 옆으로 off m 옮긴 선 (+ = 진행 방향 왼쪽). 꺾이는 곳은 앞뒤 방향의 평균으로
function offsetLine(points, off) {
  if (!off) return points;
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / L) * off, p[1] + (dx / L) * off];
  });
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
  let level = null; // 평평하게 고른 수면 높이 (terrain.flattenWater). 없으면 땅을 따라감
  const add = (a, b, c) => {
    const L = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
    if (L > 4) { // 지형을 따라가도록 잘게 나눈다
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      add(a, ab, ca); add(ab, b, bc); add(ca, bc, c); add(ab, bc, ca);
      return;
    }
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    for (const p of cross < 0 ? [a, c, b] : [a, b, c]) pos.push(p[0], (level ?? heightAt(p[0], p[1])) + 0.08, p[1]);
  };
  for (const w of list) {
    level = w.level ?? null; // 물가 둑이 더 높은 곳은 땅이 수면을 덮는다
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
export function orientedRect(o) {
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
export function rectPoint(r, u, v) {
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

// 밤(T): 외관 텍스처의 창(푸르스름한 칸) 중 약 1/3만 따뜻하게 스스로 빛남. 조명·빛 번짐·새 텍스처 없이 셰이더에서
// 칸 번호(텍스처 반복 칸)로 고른다. NIGHT.value 0 = 낮(그대로), 1 = 밤
const NIGHT = { value: 0 };
export function setWindowGlow(v) { NIGHT.value = v; }
function nightWindows(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = NIGHT;
    shader.fragmentShader = 'uniform float uNight;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #ifdef USE_MAP
      if (uNight > 0.0) {
        float wmask = smoothstep(0.1, 0.16, sampledDiffuseColor.b - sampledDiffuseColor.r); // 창 유리 그림(b−r 약 0.18~0.2)만, 벽 재료 무늬는 빼고
        vec2 cell = floor(vMapUv + 0.001);
        float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453); // 칸 번호만 (벽 아래 음영 정점 색은 화소마다 바뀌어 반짝임이 생김)
        totalEmissiveRadiance += uNight * wmask * step(h, 0.32) * vec3(1.0, 0.78, 0.46) * (0.75 + 0.25 * fract(h * 7.0));
      }
      #endif`);
  };
  mat.customProgramCacheKey = () => 'night-windows';
  return mat;
}

// 외관 텍스처: 한 칸 = 가로 3m(bay) × 한 층. 재료 무늬 × 창 형태(개별창/띠창/전면유리) × 층 띠. 색은 정점 색(외벽색)과 곱해진다
const textureCache = new Map();
function facadeTexture(key, anisotropy) {
  if (textureCache.has(key)) return textureCache.get(key);
  const [material, windows, bands] = key.split('|');
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  if (material === '커튼월' || windows === '전면유리') drawGlass(g, S);
  else {
    drawMaterial(g, S, material);
    if (bands === '1') { g.fillStyle = '#bdbbb6'; g.fillRect(0, 0, S, 12); } // 층 띠 (슬래브 끝)
    if (windows === '띠창') drawRibbon(g, S);
    else drawWindow(g, 22, 36, 84, 62);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  textureCache.set(key, t);
  return t;
}

function drawWindow(g, x, y, w, h) {
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, '#7f9ab4');
  grad.addColorStop(1, '#4b6178');
  g.fillStyle = '#e8e8e8';
  g.fillRect(x - 3, y - 3, w + 6, h + 6);
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.fillStyle = '#e8e8e8'; // 가운데 창살
  g.fillRect(x + w / 2 - 2, y, 4, h);
}

// 띠창: 칸 전체를 가로지르는 유리 띠 + 얇은 세로 창살
function drawRibbon(g, S) {
  const grad = g.createLinearGradient(0, 40, 0, 96);
  grad.addColorStop(0, '#86a1ba');
  grad.addColorStop(1, '#4e647b');
  g.fillStyle = grad;
  g.fillRect(0, 40, S, 56);
  g.fillStyle = '#dfe2e5';
  g.fillRect(0, 38, S, 3);
  g.fillRect(0, 95, S, 3);
  for (const x of [0, 64]) g.fillRect(x, 40, 3, 56);
}

// 재료 무늬: 콘크리트(민무늬 + 층 줄), 벽돌(줄눈), 타일(네모 줄눈), 석재(큰 돌 판)
function drawMaterial(g, S, material) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  if (material === '벽돌') {
    g.fillStyle = '#d6cfc8';
    for (let y = 0, row = 0; y < S; y += 8, row++) {
      g.fillRect(0, y, S, 1.5);
      for (let x = (row % 2) * 8; x < S; x += 16) g.fillRect(x, y, 1.5, 8);
    }
  } else if (material === '타일') {
    g.fillStyle = '#dcdad5';
    for (let i = 0; i < S; i += 16) { g.fillRect(i, 0, 1, S); g.fillRect(0, i, S, 1); }
  } else if (material === '석재') {
    g.fillStyle = '#d9d4ca';
    for (let y = 0, row = 0; y < S; y += 32, row++) {
      g.fillRect(0, y, S, 2);
      for (let x = (row % 2) * 32; x < S; x += 64) g.fillRect(x, y, 2, 32);
    }
  } else {
    g.fillStyle = '#c9c9c9';
    g.fillRect(0, 0, S, 9);
  }
}

// 커튼월: 위는 밝은 하늘, 아래로 짙어지는 유리 + 얇은 세로 멀리언 + 층마다 가로 띠
function drawGlass(g, S) {
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#dcecf8');
  grad.addColorStop(0.55, '#8fb4d2');
  grad.addColorStop(1, '#5d7f9c');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(255,255,255,0.18)'; // 비스듬한 반사
  g.beginPath();
  g.moveTo(10, S); g.lineTo(50, 0); g.lineTo(70, 0); g.lineTo(30, S);
  g.fill();
  g.fillStyle = '#c9d0d6';
  for (const x of [0, 42, 85]) g.fillRect(x, 0, 3, S);
  g.fillStyle = '#7d8893';
  g.fillRect(0, 0, S, 7);
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
    let pts = [a, b, c], tuv = uvs, cols = Array.isArray(color) ? color : [color, color, color]; // 정점마다 색을 줄 수도 있음
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
      pts = [a, c, b];
      tuv = uvs && [uvs[0], uvs[2], uvs[1]];
      cols = [cols[0], cols[2], cols[1]];
    }
    pts.forEach((p, i) => {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(cols[i].r, cols[i].g, cols[i].b);
      if (this.uv) this.uv.push(tuv[i][0], tuv[i][1]);
    });
  }

  // 세로 벽 사각형 (p1→p2, 높이 y0~y1), 바깥 법선 n. 창문 층은 높이 base부터 센다.
  // 아래 AO.wallH m는 따로 나눠 땅 쪽으로 갈수록 어둡게(앰비언트 오클루전)
  wall(p1, p2, y0, y1, n, color, u1 = 0, base = null, floorH = FLOOR_M) {
    if (base === null || !LOOK.wallShade) return this.wallPart(p1, p2, y0, y1, n, color, u1, LOOK.wallShade ? null : base, floorH); // 입구·옥상 구조물: 그늘 없음
    const ym = Math.min(y1, base + AO.wallH);
    if (ym > y0 + 0.1 && ym < y1 - 0.1) {
      this.wallPart(p1, p2, y0, ym, n, color, u1, base, floorH);
      this.wallPart(p1, p2, ym, y1, n, color, u1, base, floorH);
    } else this.wallPart(p1, p2, y0, y1, n, color, u1, base, floorH);
  }

  wallPart(p1, p2, y0, y1, n, color, u1, base, floorH) {
    const a = [p1[0], y0, p1[1]], b = [p2[0], y0, p2[1]], c = [p2[0], y1, p2[1]], d = [p1[0], y1, p1[1]];
    const v0 = (y0 - (base ?? 0)) / floorH, v1 = (y1 - (base ?? 0)) / floorH;
    const shade = (y) => {
      if (base === null || !LOOK.wallShade) return color;
      const k = Math.min(1, Math.max(0, (y - base) / AO.wallH));
      return color.clone().multiplyScalar(AO.wallDark + (1 - AO.wallDark) * Math.sqrt(k));
    };
    const lo = shade(y0), hi = shade(y1);
    this.tri(a, b, c, n, [lo, lo, hi], [[0, v0], [u1, v0], [u1, v1]]);
    this.tri(a, c, d, n, [lo, hi, hi], [[0, v0], [u1, v1], [0, v1]]);
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

// 벽(외관 텍스처 종류마다 한 메시)과 지붕·입구·옥상 구조물(텍스처 없음)을 각각 합친다.
// 지붕을 텍스처 메시에 넣으면 멀리서 밉맵 평균 때문에 창문색이 섞여 어두워진다.
// 외관 우선순위: data/building-styles.json(b.style) > csv "직접" > csv 추정(b.facade 등) > 건물마다 정해진 기본값.
function buildBuildings(list, anisotropy) {
  const walls = new Map(); // 텍스처 키 → MeshBuilder
  const wallsFor = (key) => {
    if (!walls.has(key)) walls.set(key, new MeshBuilder(true));
    return walls.get(key);
  };
  const plain = new MeshBuilder(false);
  const entrance = new THREE.Color(ENTRANCE_COLOR);
  const clocks = []; // 시계탑 (옥상 구조물 clock: true)

  for (const b of list) {
    const o = b.outline;
    if (o.length < 3) continue;
    const st = b.style || {};
    const k = hash(b.id);
    const want = st.facade || b.facade;
    const facade = FACADE_COLORS[want] || want === '콘크리트' ? want : '콘크리트';
    const tint = (c) => (b.inCampus ? c : c.lerp(OUTSIDE_TINT, OUTSIDE_MIX));
    const wall = tint(new THREE.Color(st.wallColor || b.wallColor || FACADE_COLORS[facade] || WALL_COLORS[k % WALL_COLORS.length]));
    const roof = tint(new THREE.Color(st.roofColor || b.roofColor || ROOF_COLORS[(k >> 4) % ROOF_COLORS.length]));
    const look = { facade, windows: st.windows || (facade === '커튼월' ? '전면유리' : '개별창'), bands: st.bands !== false, bay: st.bay || BAY_M };
    // 외곽선 안 가장 낮은 땅에서 시작하고, 벽은 그보다 더 내려 비탈 쪽이 뜨지 않게 묻는다
    const base = heightRange(o).lo;
    b.base = base;
    const mainH = st.mainFloors ? st.mainFloors * FLOOR_M + 1 : b.height;
    let top = 0;

    // 지붕만 있는 차양(도로를 덮는 지붕 등): 기둥 + 얇은 지붕판, 벽·입구 없음
    if (st.canopy) {
      const ch = st.canopyH || 5;
      box(plain, o, base + ch - 0.4, base + ch, roof);
      for (const [x, z] of o) box(plain, circleOutline([x, z], 0.25, 6), base - BURY_M, base + ch - 0.4, wall);
      b.height = ch;
      continue;
    }
    if (!st.skipMain) {
      const longest = extrude(o, base, base + mainH, look, wall, roof, { wallsFor, plain, roof: st.roof, roofH: st.roofH, holes: b.holes });
      top = mainH + (st.roof === 'hip' ? st.roofH || 3 : 0);
      // 가장 긴 벽 가운데 1층에 어두운 입구
      if (longest && longest.len >= 6 && mainH >= 3.5) {
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
    // 따로 세우는 덩어리 (저층부·고층부, 원통, 유리 아트리움, 우진각 지붕 동 등)
    for (const part of st.parts || []) {
      const po = part.circle ? circleOutline(part.circle.c, part.circle.r) : part.outline;
      const fh = part.floorHeight || FLOOR_M;
      const h = part.floors * fh + 1;
      const pf = part.facade || facade;
      const plook = { facade: pf, windows: part.windows || (pf === '커튼월' ? '전면유리' : look.windows), bands: look.bands, bay: look.bay, floorH: fh };
      const pw = part.wallColor ? tint(new THREE.Color(part.wallColor)) : (pf === facade ? wall : tint(new THREE.Color(FACADE_COLORS[pf] || '#d9d6cc')));
      const pr = tint(new THREE.Color(part.roofColor || st.roofColor || b.roofColor || '#c3c5c1'));
      const longest = extrude(po, base, base + h, plook, pw, pr, { wallsFor, plain, roof: part.roof, roofH: part.roofH });
      top = Math.max(top, h + (part.roof === 'hip' ? part.roofH || 3 : 0));
      if (st.skipMain && longest && !b.entrance) {
        const { p1, p2, n } = longest;
        const ex = (p1[0] + p2[0]) / 2, ez = (p1[1] + p2[1]) / 2;
        b.entrance = { x: ex, z: ez, nx: n[0], nz: n[2], y: heightAt(ex, ez) };
      }
    }
    // 모서리 세로 띠 (생활관 계단실처럼 다른 색): 외곽선 꼭짓점 몇 곳에 1.8m 폭 기둥
    if (st.accent) {
      const ac = tint(new THREE.Color(st.accent.color));
      const stepI = Math.max(1, Math.round(o.length / st.accent.every));
      o.forEach(([x, z], i) => {
        if (i % stepI === 0) box(plain, circleOutline([x, z], 0.9, 6), base - BURY_M, base + mainH + 0.6, ac);
      });
    }
    // 옥상 구조물 (옥탑, 원형 단, 태양광 판 등)
    for (const f of st.features || []) {
      if (f.type === 'solar') {
        solarPanels(plain, f.outline || o, base + mainH, f.share || 1, tint(new THREE.Color('#2f4b6b')), f.outline ? [] : b.holes || []);
        continue;
      }
      const fo = f.type === 'cylinder' ? circleOutline(f.c, f.r) : f.outline;
      const on = f.on === 'main' ? mainH : 0;
      box(plain, fo, base + on - 0.2, base + on + f.h, tint(new THREE.Color(f.color)));
      top = Math.max(top, on + f.h);
      if (f.clock) clocks.push({ outline: fo, top: base + on + f.h });
    }
    b.height = top || b.height; // 이름표·미니맵이 쓰는 가장 높은 곳
  }

  const meshes = [...walls.entries()].map(([key, w]) => {
    const glass = key.startsWith('커튼월') || key.includes('전면유리');
    const map = facadeTexture(key, anisotropy);
    // 커튼월: 유리 격자에 하늘이 비치는 그러데이션 + 반짝임
    const mat = nightWindows(glass ? new THREE.MeshPhongMaterial({ vertexColors: true, map, shininess: 90, specular: '#ffffff' })
      : new THREE.MeshLambertMaterial({ vertexColors: true, map }));
    return new THREE.Mesh(w.geometry(), mat);
  });
  meshes.push(new THREE.Mesh(plain.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true })));
  if (clocks.length) meshes.push(...clockFaces(clocks));
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  return meshes;
}

// 시계탑 네 면의 둥근 시계판: 흰 바탕 + 짙은 테두리 + 시곗바늘 2개 (시각은 임의: 8시 58분, 지각 직전)
const CLOCK = { r: 0.32, ring: 0.06, below: 0.3, time: [8, 58] }; // r·ring은 면 폭 비율, below는 꼭대기에서 아래로(면 폭 비율)
// 시계판(움직이지 않음)은 한 메시, 바늘은 시침·분침 InstancedMesh 둘(면마다 하나씩)이라 시각을 바꿀 수 있다.
// 돌려줌: { meshes, setTime(시, 분, 초) } — 지각 모드는 게임 시각(8:57 → 9:00), 자유 주행은 실제 지금 시각 (main.js)
let clockTower = null;
function clockFaces(list) {
  const pos = [], nor = [], col = [];
  const faces = []; // 바늘을 놓을 면: 가운데·오른쪽·바깥 방향·반지름
  const white = new THREE.Color('#f4f2ea'), dark = new THREE.Color('#2b2e33');
  for (const { outline: o, top } of list) {
    const sign = area(o) > 0 ? 1 : -1;
    for (let i = 0; i < o.length; i++) {
      const p1 = o[i], p2 = o[(i + 1) % o.length];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (len < 2) continue;
      const nx = ((p2[1] - p1[1]) / len) * sign, nz = (-(p2[0] - p1[0]) / len) * sign;
      const ux = nz, uz = -nx; // 밖에서 볼 때 오른쪽
      const R = len * CLOCK.r, cy = top - len * CLOCK.below;
      const cx = (p1[0] + p2[0]) / 2, cz = (p1[1] + p2[1]) / 2;
      // 면 위 점 (u 오른쪽, v 위, d 바깥으로 띄움)
      const P = (u, v, d) => [cx + ux * u + nx * d, cy + v, cz + uz * u + nz * d];
      const tri = (a, b, c, color) => {
        for (const q of [a, b, c]) { pos.push(...q); nor.push(nx, 0, nz); col.push(color.r, color.g, color.b); }
      };
      const disc = (r0, r1, d, color, n = 40) => {
        for (let k = 0; k < n; k++) {
          const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
          const o0 = P(Math.cos(a0) * r1, Math.sin(a0) * r1, d), o1 = P(Math.cos(a1) * r1, Math.sin(a1) * r1, d);
          if (r0 === 0) tri(P(0, 0, d), o1, o0, color);
          else {
            const i0 = P(Math.cos(a0) * r0, Math.sin(a0) * r0, d), i1 = P(Math.cos(a1) * r0, Math.sin(a1) * r0, d);
            tri(i0, o1, o0, color);
            tri(i0, i1, o1, color);
          }
        }
      };
      const bar = (ang, L, w, d, color) => { // 가운데에서 시계 방향 ang(12시 = 0) 쪽으로 길이 L
        const sx = Math.sin(ang), sy = Math.cos(ang), px = -sy * w / 2, py = sx * w / 2;
        const a = P(px - sx * L * 0.12, py - sy * L * 0.12, d), b = P(-px - sx * L * 0.12, -py - sy * L * 0.12, d);
        const c = P(-px + sx * L, -py + sy * L, d), e = P(px + sx * L, py + sy * L, d);
        tri(a, c, b, color);
        tri(a, e, c, color);
      };
      disc(0, R, 0.05, white);
      disc(R, R + len * CLOCK.ring, 0.06, dark);
      for (let h = 0; h < 12; h++) { // 시 눈금
        const a = (h / 12) * Math.PI * 2, r0 = R * 0.82;
        const sx = Math.sin(a), sy = Math.cos(a), w = R * 0.035;
        tri(P(sx * r0 - sy * w, sy * r0 + sx * w, 0.07), P(sx * R * 0.95 + sy * w, sy * R * 0.95 - sx * w, 0.07), P(sx * R * 0.95 - sy * w, sy * R * 0.95 + sx * w, 0.07), dark);
        tri(P(sx * r0 - sy * w, sy * r0 + sx * w, 0.07), P(sx * r0 + sy * w, sy * r0 - sx * w, 0.07), P(sx * R * 0.95 + sy * w, sy * R * 0.95 - sx * w, 0.07), dark);
      }
      disc(0, R * 0.07, 0.1, dark, 12);
      faces.push({ c: P(0, 0, 0.085), u: [ux, 0, uz], n: [nx, 0, nz], R });
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  // 바늘: 판 기준 +y(12시) 쪽으로 뻗은 얇은 판 (반지름 1 기준, 면마다 R배)
  const handMat = new THREE.MeshBasicMaterial({ color: dark, side: THREE.DoubleSide });
  const handGeo = (L, w) => new THREE.PlaneGeometry(w, L * 1.12).translate(0, L * 0.44, 0);
  const hour = new THREE.InstancedMesh(handGeo(0.55, 0.09), handMat, faces.length);
  const minute = new THREE.InstancedMesh(handGeo(0.85, 0.06), handMat, faces.length);
  const m = new THREE.Matrix4(), basis = new THREE.Matrix4(), rot = new THREE.Matrix4(), sc = new THREE.Matrix4();
  const X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3();
  const setHand = (inst, i, f, ang, lift) => {
    X.set(...f.u); Z.set(...f.n);
    basis.makeBasis(X, Y, Z).setPosition(f.c[0] + f.n[0] * lift, f.c[1], f.c[2] + f.n[2] * lift);
    rot.makeRotationZ(-ang); // 밖에서 볼 때 시계 방향
    sc.makeScale(f.R, f.R, 1);
    inst.setMatrixAt(i, m.copy(basis).multiply(rot).multiply(sc));
  };
  const setTime = (h, mi, se = 0) => {
    const mm = mi + se / 60;
    faces.forEach((f, i) => {
      setHand(hour, i, f, (((h % 12) + mm / 60) / 12) * Math.PI * 2, 0);
      setHand(minute, i, f, (mm / 60) * Math.PI * 2, 0.01);
    });
    hour.instanceMatrix.needsUpdate = minute.instanceMatrix.needsUpdate = true;
  };
  setTime(...CLOCK.time);
  clockTower = { setTime };
  return [mesh, hour, minute];
}

// 외곽선을 y0~y1로 세움: 벽(외관 텍스처) + 지붕(평지붕 또는 우진각). 가장 긴 벽 정보를 돌려줌
function extrude(o, base, y1, look, wallColor, roofColor, { wallsFor, plain, roof = 'flat', roofH = 3, holes = [] }) {
  const wb = wallsFor(`${look.facade}|${look.windows}|${look.bands ? 1 : 0}`);
  const floorH = look.floorH || FLOOR_M;
  let longest = null;
  // 바깥 고리는 바깥으로, 중정 고리는 중정 쪽으로 법선
  for (const [ring, outward] of [[o, 1], ...holes.map((h) => [h, -1])]) {
    const sign = (area(ring) > 0 ? 1 : -1) * outward;
    for (let i = 0; i < ring.length; i++) {
      const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (len < 1e-6) continue;
      // 바깥쪽 법선 (면적이 +면 (dz, -dx) 쪽이 바깥)
      const n = [((p2[1] - p1[1]) / len) * sign, 0, (-(p2[0] - p1[0]) / len) * sign];
      // 변마다 창문이 딱 맞게 들어가도록 칸 수를 정수로
      wb.wall(p1, p2, base - BURY_M, y1, n, wallColor, Math.max(1, Math.round(len / look.bay)), base, floorH);
      if (outward > 0 && (!longest || len > longest.len)) longest = { p1, p2, n, len };
    }
  }
  if (roof === 'hip') hipRoof(plain, o, y1, roofH, roofColor);
  else flatTop(plain, o, y1, roofColor, holes);
  return longest;
}

function flatTop(plain, o, y, color, holes = []) {
  const contour = o.map(([x, z]) => new THREE.Vector2(x, z));
  const hv = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  const pts = [o, ...holes].flat();
  for (const [i, j, m] of THREE.ShapeUtils.triangulateShape(contour, hv)) {
    plain.tri([pts[i][0], y, pts[i][1]], [pts[j][0], y, pts[j][1]], [pts[m][0], y, pts[m][1]], [0, 1, 0], color);
  }
}

// 텍스처 없는 덩어리 (옥상 구조물·모서리 띠): 옆면 + 윗면
function box(plain, o, y0, y1, color) {
  const sign = area(o) > 0 ? 1 : -1;
  for (let i = 0; i < o.length; i++) {
    const p1 = o[i], p2 = o[(i + 1) % o.length];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (len < 1e-6) continue;
    plain.wall(p1, p2, y0, y1, [((p2[1] - p1[1]) / len) * sign, 0, (-(p2[0] - p1[0]) / len) * sign], color);
  }
  flatTop(plain, o, y1, color);
}

// 우진각 지붕: 외곽선을 감싸는 회전 사각형 위에, 긴 변 방향 용마루(높이 h)
function hipRoof(plain, o, y, h, color) {
  const r = orientedRect(o);
  const P = (u, v, yy) => { const [x, z] = rectPoint(r, u, v); return [x, yy, z]; };
  const L = r.L / 2, W = r.W / 2, ridge = Math.max(0, L - W);
  const a = P(-L, -W, y), b = P(L, -W, y), c = P(L, W, y), d = P(-L, W, y);
  const e = P(-ridge, 0, y + h), f = P(ridge, 0, y + h);
  for (const [p, q, s] of [[a, b, f], [a, f, e], [c, d, e], [c, e, f], [b, c, f], [d, a, e]]) {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = s[0] - p[0], vy = s[1] - p[1], vz = s[2] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } // 바깥(위)을 보게
    const l = Math.hypot(nx, ny, nz) || 1;
    plain.tri(p, q, s, [nx / l, ny / l, nz / l], color);
  }
}

// 옥상 태양광 판: 건물 긴 변 방향으로 줄지어(3.4m × 2.3m 간격, 판 3×1.8m), 가장자리에서 2.5m 안쪽.
// share: 줄의 몇 할을 채울지 (사진에서 지붕 일부만 덮인 건물)
function solarPanels(plain, o, y, share, color, holes = []) {
  const r = orientedRect(o);
  const edge = (x, z) => {
    let d = Infinity;
    for (const ring of [o, ...holes]) {
      for (let i = 0; i < ring.length; i++) d = Math.min(d, distToSegment(x, z, [...ring[i], ...ring[(i + 1) % ring.length]]));
    }
    return d;
  };
  const rows = Math.floor((r.W - 5) / 2.3);
  for (let rw = 0; rw <= rows; rw++) {
    if (rw / Math.max(1, rows) > share + 0.001) break;
    const v = -r.W / 2 + 2.5 + rw * 2.3;
    for (let u = -r.L / 2 + 2.5; u <= r.L / 2 - 2.5; u += 3.4) {
      const [x, z] = rectPoint(r, u, v);
      if (!pointInPolygon(x, z, o) || holes.some((h) => pointInPolygon(x, z, h)) || edge(x, z) < 2.4) continue;
      const q = (du, dv) => rectPoint(r, u + du, v + dv);
      flatTop(plain, [q(-1.5, -0.9), q(1.5, -0.9), q(1.5, 0.9), q(-1.5, 0.9)], y + 0.35, color); // 윗면만 (옆면은 멀리서 안 보여 삼각형 절약)
    }
  }
}

function circleOutline([cx, cz], r, n = 40) {
  return Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cz + Math.sin((i / n) * Math.PI * 2) * r]);
}

// ---------- 나무 ----------

const TREE = {
  roadSpacing: 11,   // 차도 옆 나무 간격 (m)
  roadGap: 2.5,      // 차도 가장자리에서 떨어진 거리
  perArea: { forest: 80, park: 260, grass: 450 }, // 나무 한 그루당 넓이 (m²)
  max: 7000,
};
// 계절 수관 색 (null = 여름 색 그대로). 침엽수는 겨울에만 눈 빛을 섞음
const SEASON = {
  spring: { broad: ['#f6b8cc', '#f9d0dc', '#f2a9c0', null, '#a8d46e', null, '#b5dc7c'] },
  autumn: { broad: ['#e0802b', '#d4562a', '#e8b232', '#c8692e', '#b84a2a', '#a8a03a', '#e39a2c'] },
  winter: { broad: ['#e9eef2', '#dfe6ea', '#a39888', '#e4eaee', '#9c8f84'], conifer: ['#eef3f6', '#e2e9ee', null] },
};
const seasonColor = new THREE.Color();
const seasonRand = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
const CROWN_COLORS = ['#5f9e4a', '#6fae52', '#4f8c42', '#7db85a', '#5a9550', '#86b85e', '#4a7f3e', '#6a9a48'];
// 나무 종류 (모양·크기·색 변형, 근거 없음: 시각적 다양성용 임의 비율). 진입로 가로수는 landscape.js에서 따로
// [이름, 차도 옆 비율, 공원·잔디 비율, 숲 비율]
const TREE_KINDS = [
  ['round', 0.5, 0.35, 0.2],   // 둥근 활엽수 (지금까지의 나무)
  ['broad', 0.3, 0.3, 0.15],   // 넓게 퍼진 활엽수 (낮고 넓은 수관)
  ['shrub', 0.1, 0.2, 0.1],    // 관목 (줄기 없이 낮은 덤불)
  ['cone', 0.07, 0.1, 0.3],    // 원뿔 침엽수
  ['slim', 0.03, 0.05, 0.25],  // 가늘고 키 큰 침엽수
];

// 차도 양옆과 녹지 안에 저폴리 나무를 InstancedMesh로 심는다.
// 순서를 섞어 두어서, 개수(count)를 절반으로 줄이면 골고루 절반만 보인다.
function buildTrees(campus) {
  const rand = mulberry32(20261025);
  const blocked = makeTreeBlocker(campus);
  const spots = []; // [x, z, 크기, 종류]

  const [gx, gz] = campus.spawn.gate;
  const gateClear = 22; // 정문 루버 지붕(동쪽 끝까지 약 19m) 둘레
  // where: 1 = 차도 옆, 2 = 공원·잔디, 3 = 숲 (TREE_KINDS의 비율 칸)
  const pick = (where) => {
    if (!LOOK.treeKinds) return 'round';
    let t = rand() * TREE_KINDS.reduce((a, k) => a + k[where], 0);
    for (const k of TREE_KINDS) { t -= k[where]; if (t <= 0) return k[0]; }
    return 'round';
  };
  const add = (x, z, where) => {
    if (spots.length >= TREE.max || blocked(x, z) || Math.hypot(x - gx, z - gz) < gateClear) return;
    spots.push([x, z, 0.72 + rand() * 0.7, pick(where)]);
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
        add(x - uz * off, z + ux * off, 1);
        add(x + uz * off, z - ux * off, 1);
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
      add(x, z, g.kind === 'forest' ? 3 : 2);
      if (spots.length > before) placed++;
    }
  }

  // 섞기
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 5).translate(0, 1.2, 0);
  const crowns = {
    round: new THREE.IcosahedronGeometry(2.1, 0).translate(0, 3.9, 0),
    // 넓은 활엽수·관목은 둥근 나무와 같은 20면체를 납작하게 (12면체 36삼각형 → 20삼각형, 나무 수가 많아 삼각형을 아낌)
    broad: new THREE.IcosahedronGeometry(2.05, 0).scale(1.45, 0.72, 1.45).translate(0, 3.4, 0),
    shrub: new THREE.IcosahedronGeometry(1.05, 0).scale(1.2, 0.75, 1.2).translate(0, 0.65, 0),
    cone: new THREE.ConeGeometry(1.9, 5.2, 7).translate(0, 4.6, 0),
    slim: new THREE.ConeGeometry(1.15, 7.0, 6).translate(0, 5.2, 0),
  };
  // 줄기 크기 비율 [굵기, 높이] (관목은 줄기 없음)
  const TRUNK = { round: [1, 1], broad: [1.3, 0.85], cone: [0.9, 1.05], slim: [0.75, 1.25] };
  const crownMat = new THREE.MeshLambertMaterial({ flatShading: true });
  const withTrunk = spots.filter((t) => t[3] !== 'shrub');
  const meshes = [[new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#8a6a4f' }), withTrunk.length), withTrunk]];
  for (const [kind, geo] of Object.entries(crowns)) {
    const list = spots.filter((t) => t[3] === kind);
    meshes.push([new THREE.InstancedMesh(geo, crownMat, list.length), list]);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), color = new THREE.Color();
  const group = new THREE.Group();
  for (const [mesh, list] of meshes) {
    const trunk = mesh.material !== crownMat;
    list.forEach(([x, z, size, kind], i) => {
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      const [tw, th] = trunk ? TRUNK[kind] : [1, 1];
      m.compose(p.set(x, heightAt(x, z) - 0.2, z), q, s.set(size * tw, size * th * (trunk ? 1 : 0.9 + rand() * 0.25), size * tw));
      mesh.setMatrixAt(i, m);
      if (!trunk) {
        color.set(CROWN_COLORS[Math.floor(rand() * CROWN_COLORS.length)]);
        if (kind === 'cone' || kind === 'slim') color.offsetHSL(0.02, 0, -0.06); // 침엽수는 조금 더 짙고 푸르게
        mesh.setColorAt(i, color);
      }
    });
    mesh.castShadow = true;
    mesh.userData.total = list.length;
    group.add(mesh);
  }

  // 줄기는 한 메시라, 보이는 수관(종류마다 앞에서부터 density만큼, 가벼운 모드면 둥근 것만)과 같은 나무만 보이게 행렬로 고른다
  const trunkMesh = meshes[0][0];
  const trunkSaved = trunkMesh.instanceMatrix.array.slice();
  const kindIndex = new Map(), kindTotal = {};
  for (const [, list] of meshes.slice(1)) list.forEach((t, i) => { kindIndex.set(t, i); kindTotal[t[3]] = list.length; });
  let density = 1, variety = true;
  const refresh = () => {
    for (const [mesh, list] of meshes.slice(1)) {
      mesh.count = Math.floor(mesh.userData.total * density);
      mesh.visible = variety || list[0]?.[3] === 'round';
    }
    // 보이는 줄기만 앞으로 모아 개수(count)를 줄인다 (숨긴 줄기를 크기 0으로 그리지 않게). 줄기는 색이 하나라 순서는 상관없음
    const arr = trunkMesh.instanceMatrix.array;
    let n = 0;
    withTrunk.forEach((t, i) => {
      const show = (variety || t[3] === 'round') && kindIndex.get(t) < Math.floor(kindTotal[t[3]] * density);
      if (!show || trunkSaved[i * 16 + 15] === 0) return; // 숨김 또는 clearAround로 지운 나무
      arr.set(trunkSaved.subarray(i * 16, i * 16 + 16), n * 16);
      n++;
    });
    trunkMesh.count = n;
    trunkMesh.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    count: spots.length,
    // 1 = 전부, 0.5 = 절반
    setDensity(f) { density = f; refresh(); },
    // 가벼운 모드: 둥근 활엽수만 남기고 다른 종류(넓은 활엽수·관목·침엽수)와 그 줄기는 숨김
    setVariety(on) { variety = on; refresh(); },
    // 계절(Y): 수관 색만 바꿈. spring 벚꽃(활엽수 일부 분홍) | summer 원래 | autumn 단풍 | winter 눈 덮인 가지
    setSeason(name) {
      for (const [mesh, list] of meshes.slice(1)) {
        if (!mesh.instanceColor) continue;
        if (!mesh.userData.summer) mesh.userData.summer = mesh.instanceColor.array.slice();
        const base = mesh.userData.summer, arr = mesh.instanceColor.array;
        list.forEach((t, i) => {
          const conifer = t[3] === 'cone' || t[3] === 'slim', r = seasonRand(t[0], t[1]);
          color.setRGB(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);
          const pal = SEASON[name];
          if (pal && !(conifer && name !== 'winter')) {
            const c = conifer ? pal.conifer : pal.broad;
            const pick = c[Math.floor(r * c.length)];
            if (pick) color.lerp(seasonColor.set(pick), conifer ? 0.45 : 0.9);
          }
          arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b;
        });
        mesh.instanceColor.needsUpdate = true;
      }
    },
    // (x, z) 둘레 r 안의 나무를 없앤다 (연출 카메라를 가리지 않게)
    clearAround(x, z, r) {
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (const [mesh, list] of meshes) {
        list.forEach(([tx, tz], i) => {
          if (Math.hypot(tx - x, tz - z) >= r) return;
          if (mesh === trunkMesh) trunkSaved.fill(0, i * 16, i * 16 + 16);
          else mesh.setMatrixAt(i, zero);
        });
        mesh.instanceMatrix.needsUpdate = true;
      }
      refresh();
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
    putRange(insides, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), 0, { o, holes: b.holes || [] });
  }
  for (const r of campus.roads) {
    const clear = r.width / 2 + (r.car ? 1.5 : 0.6);
    for (let i = 0; i < r.points.length - 1; i++) {
      const [xa, za] = r.points[i], [xb, zb] = r.points[i + 1];
      putRange(roads, xa, za, xb, zb, clear, [xa, za, xb, zb, clear]);
    }
  }
  const waters = campus.greens.filter((g) => g.kind === 'water').map((g) => g.outline);
  for (const o of campus.parking || []) waters.push(o); // 주차장에도 심지 않음 (주차 차량 자리)

  return (x, z) => {
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    for (const e of edges.get(k) || []) if (distToSegment(x, z, e) < 3) return true;
    for (const e of roads.get(k) || []) if (distToSegment(x, z, e) < e[4]) return true;
    for (const { o, holes } of insides.get(k) || []) if (pointInPolygon(x, z, o) && !holes.some((h) => pointInPolygon(x, z, h))) return true;
    for (const o of waters) if (pointInPolygon(x, z, o)) return true;
    return false;
  };
}

// ---------- 정문 ----------

// 실제 정문 (근거: 국토지리정보원 정사영상 2025 — 위치·평면, 위키미디어 공용 사진 "정문사진 01.jpg"(전남대학교, CC BY-SA 4.0,
// 바깥에서 본 정면)·"Chonnam National University Front Gate.jpg"(Gunarta, CC BY-SA 4.0, 동쪽 글자 벽) — 모양·재료·색):
// 진입로 양쪽에 짙은 철제 관을 나란히 얹은 지붕. 서쪽(나가는 쪽)은 도로 쪽 끝에 높은 화강석 틀 기둥(두 기둥 + 위 덮개),
// 바깥 끝에 화강석 기둥. 동쪽(들어오는 쪽)은 양 끝 화강석 기둥, 그 아래 흰 경비실 앞면에 흰 세로 핀과 "전남대학교" 글자.
// 높이는 사진 원근으로 잰 추정값(도로 차선 폭을 자로 씀). 글자는 실제 대문에 있는 "전남대학교"만, 로고·엠블럼은 넣지 않음.
export const REAL_GATE = {
  center: [24.0, 446.0],      // 진입로 가운데 선(노란 중앙선)과 정문이 만나는 곳
  // [서쪽 끝, 동쪽 끝, 도로 방향 폭(m), 지붕 높이(m)] 게임 좌표. 평면은 정사영상, 높이는 사진 추정
  spans: {
    west: [[12.1, 440.2], [19.6, 443.7], 3.6, 6.2],
    east: [[26.8, 445.3], [42.4, 452.0], 4.2, 5.0],
  },
  pylon: { height: 15, width: 3.6, depth: 1.6 }, // 서쪽 도로 쪽 높은 틀 기둥 (사진 추정)
  pier: [1.6, 1.6],                              // 화강석 기둥 가로·세로
  guardHouse: { c: [41.9, 447.5], size: [11.2, 9.8], h: 3.6 }, // 수치지도 "경비실" 외곽 크기, 높이는 사진 추정
  colors: { granite: '#b7b9b7', steel: '#2a313e', wall: '#c8cccf', letters: '#a8874a' }, // 사진 픽셀에서 뽑은 색 (글자색은 눈으로)
};

// 진입로 위 철제 관 지붕 + 화강석 기둥·틀 기둥 + 경비실 글자 벽. 기둥·경비실은 충돌용 사각형(obstacles)으로도 돌려준다.
function buildGate() {
  const G = REAL_GATE;
  const group = new THREE.Group();
  const mat = (color) => new THREE.MeshLambertMaterial({ color });
  const granite = mat(G.colors.granite), steel = mat(G.colors.steel), wallMat = mat(G.colors.wall);
  const obstacles = [];

  // a→b 방향을 로컬 +x, 바깥(남쪽)을 로컬 +z로 둔 무리
  const frame = ([a, b]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const yaw = Math.atan2(ux, uz) - Math.PI / 2;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const ground = Math.min(heightAt(...a), heightAt(...b), heightAt(mx, mz));
    const g = new THREE.Group();
    g.position.set(mx, ground, mz);
    g.rotation.y = yaw;
    group.add(g);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const world = (lx, lz) => [mx + lx * c + lz * s, mz - lx * s + lz * c];
    const toLocal = (x, z) => [(x - mx) * c - (z - mz) * s, (x - mx) * s + (z - mz) * c];
    const add = (geo, m, x, y, z) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    // 충돌 사각형 (로컬 x·z 범위)
    const block = (x0, x1, z0, z1) => obstacles.push([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => world(x, z)));
    return { len, add, block, g, toLocal };
  };

  // 지붕: 길이 방향 철제 관 6개 + 양쪽 테두리 보
  const roof = (f, depth, h) => {
    for (let i = 0; i < 6; i++) {
      const z = -depth / 2 + (depth * (i + 0.5)) / 6;
      f.add(new THREE.CylinderGeometry(0.24, 0.24, f.len + 0.6, 10).rotateZ(Math.PI / 2), steel, 0, h - 0.3, z);
    }
    for (const z of [-depth / 2, depth / 2]) f.add(new THREE.BoxGeometry(f.len + 0.8, 0.45, 0.3), steel, 0, h - 0.05, z);
  };
  const pier = (f, x, h, depth) => {
    const [pw] = G.pier;
    f.add(new THREE.BoxGeometry(pw, h + 2, depth + 0.6), granite, x, h / 2 - 1, 0);
    f.block(x - pw / 2, x + pw / 2, -depth / 2 - 0.3, depth / 2 + 0.3);
  };

  // 서쪽: 바깥 끝 화강석 기둥 + 도로 쪽 높은 틀 기둥(두 기둥 사이가 비고 위를 덮개로 이음, 위쪽 틈에 짙은 세로 판)
  {
    const [a, b, depth, h] = G.spans.west;
    const f = frame([a, b]);
    roof(f, depth, h);
    pier(f, -f.len / 2, h, depth);
    const P = G.pylon, colW = (P.width - 1.2) / 2, x = f.len / 2;
    for (const sx of [-1, 1]) f.add(new THREE.BoxGeometry(colW, P.height + 2, P.depth), granite, x + sx * (0.6 + colW / 2), P.height / 2 - 1, 0);
    f.add(new THREE.BoxGeometry(P.width, 1.0, P.depth), granite, x, P.height - 0.5, 0);
    f.add(new THREE.BoxGeometry(0.5, P.height * 0.32, P.depth * 0.6), steel, x, P.height * 0.72, 0);
    f.block(x - P.width / 2, x + P.width / 2, -P.depth / 2, P.depth / 2);
  }

  // 동쪽: 양 끝 화강석 기둥 + 흰 경비실(앞면 흰 세로 핀과 "전남대학교" 글자)
  {
    const [a, b, depth, h] = G.spans.east;
    const f = frame([a, b]);
    roof(f, depth, h);
    pier(f, -f.len / 2, h, depth);
    pier(f, f.len / 2, h, depth);
    // 경비실: 수치지도 경비실 중심을 지붕 무리 좌표로
    const [gx, gz] = G.guardHouse.c, [sw, sd] = G.guardHouse.size, gh = G.guardHouse.h;
    const [hx, hz] = f.toLocal(gx, gz);
    f.add(new THREE.BoxGeometry(sw, gh + 1.5, sd), wallMat, hx, (gh + 1.5) / 2 - 1.5, hz);
    f.block(hx - sw / 2, hx + sw / 2, hz - sd / 2, hz + sd / 2);
    // 앞면(바깥, 로컬 +z): 사진 순서대로 왼쪽부터 흰 세로 핀 → 글자 판 → 동쪽 끝 화강석 기둥
    const front = hz + sd / 2;
    const textX = f.len / 2 - G.pier[0] / 2 - 0.4 - 2.3;
    for (let i = 0; i < 5; i++) f.add(new THREE.BoxGeometry(0.35, gh, 0.5), wallMat, textX - 2.3 - 0.6 - i * 0.85, gh / 2, front + 0.25);
    const text = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 0.95),
      new THREE.MeshLambertMaterial({ map: lettersTexture('전남대학교', G.colors.letters), transparent: true }),
    );
    text.position.set(textX, gh * 0.62, front + 0.03);
    f.g.add(text);
  }
  return { group: mergeByMaterial(group), obstacles };
}

// 같은 재질의 여러 메시를 한 메시로 합친다 (정문: 관·기둥·핀 30개 → 재질 수만큼, draw call 절약). 지도(텍스처) 메시는 그대로
export function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const lists = new Map(), keep = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material.map) { keep.push(o); return; }
    if (!lists.has(o.material)) lists.set(o.material, []);
    lists.get(o.material).push(o);
  });
  const out = new THREE.Group();
  for (const [material, meshes] of lists) {
    const pos = [], nor = [];
    for (const m of meshes) {
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      pos.push(...g.attributes.position.array);
      nor.push(...g.attributes.normal.array);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = mesh.receiveShadow = true;
    out.add(mesh);
  }
  for (const m of keep) { m.matrixWorld.decompose(m.position, m.quaternion, m.scale); out.add(m); }
  return out;
}

// 투명 바탕에 금속색 글자 (정문 글자 벽)
function lettersTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 106;
  const g = canvas.getContext('2d');
  g.fillStyle = color;
  g.font = '800 80px "Pretendard", "Malgun Gothic", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.split('').join(' '), 256, 56);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 출발 위치를 실제 정문 남쪽 25m, 들어오는 차로(동쪽) 위로. 연출(굴착기 앞·옆·뒤)도 여기서
export function placeSpawnAtGate(campus) {
  const [cx, cz] = REAL_GATE.center;
  const entry = campus.roads.find((r) => r.id === 'w256927670');
  let ux = 0.34, uz = -0.94; // 진입로 방향(북쪽으로)
  if (entry) {
    // 정문에 가장 가까운 진입로 선분의 방향
    let best = Infinity;
    for (let i = 0; i < entry.points.length - 1; i++) {
      const [x1, z1] = entry.points[i], [x2, z2] = entry.points[i + 1];
      const d = Math.hypot((x1 + x2) / 2 - cx, (z1 + z2) / 2 - cz);
      const L = Math.hypot(x2 - x1, z2 - z1);
      if (d < best && L > 1) { best = d; ux = (x2 - x1) / L; uz = (z2 - z1) / L; }
    }
    if (uz > 0) { ux = -ux; uz = -uz; }
  }
  const ex = -uz, ez = ux; // 진행 방향의 오른쪽(동쪽) = 들어오는 차로
  campus.spawn.gate = [cx, cz];
  // 동쪽 지붕 안쪽 기둥(가운데 선에서 약 2.4m)을 피해 가운데 선에서 5m 오른쪽
  campus.spawn.position = [cx - ux * 25 + ex * 5, cz - uz * 25 + ez * 5];
  campus.spawn.dir = [ux, uz];
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
