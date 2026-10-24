// campus.json → 바닥·녹지·도로·건물 3D.
// 성능을 위해 종류마다 한 덩어리(메시 하나)로 합치고, 색은 정점 색으로 넣는다.
import * as THREE from 'three';

// 벽: 밝은 베이지, 흰색, 연회색, 붉은 벽돌 중 건물마다 하나
const WALL_COLORS = ['#ece0c6', '#f5f3ee', '#d7d9db', '#b86b52'];
// 지붕: 옥상 방수 페인트 초록, 회색, 연갈색
const ROOF_COLORS = ['#8fb79c', '#c3c5c1', '#b3aa9c'];
const ENTRANCE_COLOR = '#3a3f47';
const OUTSIDE_TINT = new THREE.Color('#eceef0');
const OUTSIDE_MIX = 0.45;

const FLOOR_M = 3.5; // 층 높이
const BAY_M = 3;     // 창문 하나의 가로 폭

const GROUND_COLOR = '#d3d2cd';
const CAMPUS_COLOR = '#e4e3de'; // 연한 회색 포장면
// park(광장·조경 구역)는 칠하지 않는다 → 포장면 위에 나무만
const GREEN_COLORS = {
  grass: '#9fd07a', pitch: '#7cc46a', forest: '#5e9e4f',
  farm: '#c4a676', dirt: '#d9bf92', track: '#c9735a', water: '#8fd0ee',
};
const FOOT_COLOR = '#d9c8b2';    // 보도블록
const ASPHALT_COLOR = '#5b5f66';
const LANE_COLOR = '#f2f2ec';

export async function loadCampus(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export function buildMap(scene, campus, { anisotropy = 1 } = {}) {
  const group = new THREE.Group();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
    flatMaterial({ color: GROUND_COLOR }),
  );
  ground.renderOrder = -5;
  ground.receiveShadow = true;
  group.add(ground);

  const campusArea = new FlatBuilder();
  campusArea.polygon(campus.boundary, new THREE.Color(CAMPUS_COLOR));
  group.add(campusArea.mesh(-4));

  // 큰 녹지를 먼저, 작은 녹지를 나중에 (겹치면 작은 것이 위에 보이도록)
  const greens = new FlatBuilder();
  const sorted = campus.greens.filter((g) => GREEN_COLORS[g.kind])
    .sort((a, b) => Math.abs(area(b.outline)) - Math.abs(area(a.outline)));
  for (const g of sorted) greens.polygon(g.outline, new THREE.Color(GREEN_COLORS[g.kind]));
  group.add(greens.mesh(-3));

  // 보행로를 먼저, 차도를 위에
  const roads = new FlatBuilder();
  const foot = new THREE.Color(FOOT_COLOR), asphalt = new THREE.Color(ASPHALT_COLOR);
  for (const r of campus.roads) if (!r.car) roads.ribbon(r.points, r.width, foot);
  for (const r of campus.roads) if (r.car) roads.ribbon(r.points, r.width, asphalt);
  group.add(roads.mesh(-2));

  const lanes = new FlatBuilder();
  const lane = new THREE.Color(LANE_COLOR);
  for (const r of campus.roads) if (r.car) lanes.dashes(r.points, 0.3, 3, 4, lane);
  group.add(lanes.mesh(-1));

  const buildings = buildBuildings(campus.buildings, anisotropy);
  group.add(...buildings);

  const trees = buildTrees(campus);
  group.add(trees.group);

  const gate = buildGate(campus.spawn);
  group.add(gate.group);

  scene.add(group);
  return { group, trees, gateObstacles: gate.obstacles };
}

// ---------- 바닥에 붙은 납작한 층 (녹지, 도로) ----------

// 바닥 층들은 깊이를 쓰지 않고 renderOrder 순서대로 덮어 그린다 → 겹쳐도 깜빡이지 않음
function flatMaterial(opts) {
  return new THREE.MeshLambertMaterial({ ...opts, depthWrite: false });
}

class FlatBuilder {
  constructor() {
    this.pos = [];
    this.col = [];
  }

  tri(a, b, c, color) {
    // 위(+y)를 보도록 감기 방향을 맞춘다
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (cross < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      this.pos.push(p[0], 0, p[1]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  quad(x1, z1, x2, z2, h, color) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) return;
    const nx = (-(z2 - z1) / len) * h, nz = ((x2 - x1) / len) * h;
    const a = [x1 + nx, z1 + nz], b = [x2 + nx, z2 + nz];
    const c = [x2 - nx, z2 - nz], d = [x1 - nx, z1 - nz];
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  polygon(outline, color) {
    const contour = outline.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      this.tri(outline[i], outline[j], outline[k], color);
    }
  }

  ribbon(points, width, color) {
    for (let i = 0; i < points.length - 1; i++) {
      this.quad(...points[i], ...points[i + 1], width / 2, color);
    }
    // 꺾이는 곳과 끝을 둥글게 메운다
    const n = width > 6 ? 12 : 8;
    for (const p of points) this.disc(p, width / 2, color, n);
  }

  // 선을 따라 dash m 칠하고 gap m 비우는 점선
  dashes(points, width, dash, gap, color) {
    let phase = 0; // 지금 칸(dash+gap) 안에서 간 거리
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, z1] = points[i], [x2, z2] = points[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1e-6) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      let t = 0;
      while (t < len) {
        const step = Math.min(len - t, (phase < dash ? dash : dash + gap) - phase);
        if (phase < dash) this.quad(x1 + ux * t, z1 + uz * t, x1 + ux * (t + step), z1 + uz * (t + step), width / 2, color);
        t += step;
        phase = (phase + step) % (dash + gap);
      }
    }
  }

  disc([x, z], r, color, n = 8) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      this.tri([x, z], [x + Math.cos(a0) * r, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, z + Math.sin(a1) * r], color);
    }
  }

  mesh(renderOrder) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const normals = new Float32Array(this.pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const mesh = new THREE.Mesh(geo, flatMaterial({ vertexColors: true }));
    mesh.renderOrder = renderOrder;
    mesh.receiveShadow = true;
    return mesh;
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

  // 세로 벽 사각형 (p1→p2, 높이 y0~y1), 바깥 법선 n
  wall(p1, p2, y0, y1, n, color, u1 = 0) {
    const a = [p1[0], y0, p1[1]], b = [p2[0], y0, p2[1]], c = [p2[0], y1, p2[1]], d = [p1[0], y1, p1[1]];
    const v0 = y0 / FLOOR_M, v1 = y1 / FLOOR_M;
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
    const h = b.height;
    const sign = area(o) > 0 ? 1 : -1;
    let longest = null;

    for (let i = 0; i < o.length; i++) {
      const p1 = o[i], p2 = o[(i + 1) % o.length];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (len < 1e-6) continue;
      // 바깥쪽 법선 (면적이 +면 (dz, -dx) 쪽이 바깥)
      const n = [((p2[1] - p1[1]) / len) * sign, 0, (-(p2[0] - p1[0]) / len) * sign];
      // 변마다 창문이 딱 맞게 들어가도록 칸 수를 정수로
      walls.wall(p1, p2, 0, h, n, wall, Math.max(1, Math.round(len / BAY_M)));
      if (!longest || len > longest.len) longest = { p1, p2, n, len };
    }

    const contour = o.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [i, j, m] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      plain.tri([o[i][0], h, o[i][1]], [o[j][0], h, o[j][1]], [o[m][0], h, o[m][1]], [0, 1, 0], roof);
    }

    // 가장 긴 벽 가운데 1층에 어두운 입구
    if (longest && longest.len >= 6 && h >= 3.5) {
      const { p1, p2, n, len } = longest;
      const w = Math.min(6, len * 0.4) / 2 / len;
      const off = 0.06;
      const q = (t) => [p1[0] + (p2[0] - p1[0]) * t + n[0] * off, p1[1] + (p2[1] - p1[1]) * t + n[2] * off];
      plain.wall(q(0.5 - w), q(0.5 + w), 0, 3, n, entrance);
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
      m.compose(p.set(x, 0, z), q, s.set(size, size * (0.9 + rand() * 0.25), size));
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
  group.position.set(gx, 0, gz);
  group.rotation.y = Math.atan2(dx, dz);

  const stone = new THREE.MeshLambertMaterial({ color: '#d4cdbf' });
  const navy = new THREE.MeshLambertMaterial({ color: '#2f3d5c' });
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(GATE.pillar, GATE.height, GATE.pillar), stone);
    pillar.position.set(sx * px, GATE.height / 2, 0);
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

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToSegment(px, pz, [x1, z1, x2, z2]) {
  const dx = x2 - x1, dz = z2 - z1;
  const L = dx * dx + dz * dz;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L));
  return Math.hypot(px - x1 - t * dx, pz - z1 - t * dz);
}

function pointInPolygon(x, z, poly) {
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

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
