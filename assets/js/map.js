// campus.json → 바닥·녹지·도로·건물 3D.
// 성능을 위해 종류마다 한 덩어리(메시 하나)로 합치고, 색은 정점 색으로 넣는다.
import * as THREE from 'three';

const WALL_COLORS = ['#f7c6c7', '#fde3a7', '#c9e7c4', '#bcd9f2', '#dacbf2', '#f8d5b5', '#c4ece7', '#f9dcec'];
const ROOF_COLORS = ['#e8848a', '#f2b45c', '#86c47c', '#7fb0e0', '#a98fdc', '#e59a6a', '#6fc5ba', '#e79ac0'];
const OUTSIDE_TINT = new THREE.Color('#eceef0');
const OUTSIDE_MIX = 0.6;

const GROUND_COLOR = '#d9d8d2';
const CAMPUS_COLOR = '#ecebe6';
const GREEN_COLORS = {
  grass: '#b5dd8a', park: '#a6d77a', pitch: '#c8e6a0',
  forest: '#6fae5a', farm: '#c9a877', water: '#8fd0ee',
};
// 보행로 → 일반 → 주도로 순서로 그려서 큰 길이 위에 오게
const ROAD_STYLE = [
  { test: (w) => w <= 3, color: '#d3cec4' },
  { test: (w) => w > 3 && w < 8, color: '#a7aab0' },
  { test: (w) => w >= 8, color: '#8f9399' },
];

export async function loadCampus(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export function buildMap(scene, campus) {
  const group = new THREE.Group();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
    flatMaterial({ color: GROUND_COLOR }),
  );
  ground.renderOrder = -4;
  ground.receiveShadow = true;
  group.add(ground);

  const campusArea = new FlatBuilder();
  campusArea.polygon(campus.boundary, new THREE.Color(CAMPUS_COLOR));
  group.add(campusArea.mesh(-3));

  // 큰 녹지를 먼저, 작은 녹지를 나중에 (겹치면 작은 것이 위에 보이도록)
  const greens = new FlatBuilder();
  const sorted = [...campus.greens].sort((a, b) => Math.abs(area(b.outline)) - Math.abs(area(a.outline)));
  for (const g of sorted) greens.polygon(g.outline, new THREE.Color(GREEN_COLORS[g.kind] || GREEN_COLORS.grass));
  group.add(greens.mesh(-2));

  const roads = new FlatBuilder();
  for (const style of ROAD_STYLE) {
    const color = new THREE.Color(style.color);
    for (const r of campus.roads) if (style.test(r.width)) roads.ribbon(r.points, r.width, color);
  }
  group.add(roads.mesh(-1));

  const buildings = buildBuildings(campus.buildings);
  group.add(buildings);

  scene.add(group);
  return { group, buildings };
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

  polygon(outline, color) {
    const contour = outline.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      this.tri(outline[i], outline[j], outline[k], color);
    }
  }

  ribbon(points, width, color) {
    const h = width / 2;
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, z1] = points[i];
      const [x2, z2] = points[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1e-6) continue;
      const nx = (-(z2 - z1) / len) * h;
      const nz = ((x2 - x1) / len) * h;
      const a = [x1 + nx, z1 + nz], b = [x2 + nx, z2 + nz];
      const c = [x2 - nx, z2 - nz], d = [x1 - nx, z1 - nz];
      this.tri(a, b, c, color);
      this.tri(a, c, d, color);
    }
    // 꺾이는 곳과 끝을 둥글게 메운다
    for (const p of points) this.disc(p, h, color);
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

function buildBuildings(list) {
  const pos = [], nor = [], col = [];

  const push = (pts, n, c) => {
    for (const p of pts) {
      pos.push(p[0], p[1], p[2]);
      nor.push(n[0], n[1], n[2]);
      col.push(c.r, c.g, c.b);
    }
  };
  // 삼각형의 면 방향이 n과 같도록 감기 방향을 맞춘다
  const tri = (a, b, c, n, color) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) push([a, c, b], n, color);
    else push([a, b, c], n, color);
  };

  for (const b of list) {
    const o = b.outline;
    if (o.length < 3) continue;
    const k = hash(b.id);
    const wall = new THREE.Color(WALL_COLORS[k % WALL_COLORS.length]);
    const roof = new THREE.Color(ROOF_COLORS[(k >> 3) % ROOF_COLORS.length]);
    if (!b.inCampus) {
      wall.lerp(OUTSIDE_TINT, OUTSIDE_MIX);
      roof.lerp(OUTSIDE_TINT, OUTSIDE_MIX);
    }
    const h = b.height;
    const sign = area(o) > 0 ? 1 : -1;

    for (let i = 0; i < o.length; i++) {
      const [x1, z1] = o[i];
      const [x2, z2] = o[(i + 1) % o.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1e-6) continue;
      // 바깥쪽 법선 (면적이 +면 (dz, -dx) 쪽이 바깥)
      const n = [((z2 - z1) / len) * sign, 0, (-(x2 - x1) / len) * sign];
      const p1b = [x1, 0, z1], p2b = [x2, 0, z2], p2t = [x2, h, z2], p1t = [x1, h, z1];
      tri(p1b, p2b, p2t, n, wall);
      tri(p1b, p2t, p1t, n, wall);
    }

    const contour = o.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [i, j, m] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      tri([o[i][0], h, o[i][1]], [o[j][0], h, o[j][1]], [o[m][0], h, o[m][1]], [0, 1, 0], roof);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- 도우미 ----------

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
