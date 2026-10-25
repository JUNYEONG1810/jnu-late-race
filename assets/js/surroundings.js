// 캠퍼스 바깥 풍경 (data/surroundings.json): 먼 지형(±15km, 150m 격자, 무등산 능선 포함)과 둘레 OSM 건물 덩어리.
// 충돌 없음, 그림자 없음. 가까운 지형 격자(terrain.json) 안쪽은 먼 지형을 그 아래로 내려 겹치지 않게 한다.
import * as THREE from 'three';
import { heightAt, terrainBounds } from './terrain.js';

const LOW = new THREE.Color('#c9c5bc');     // 낮은 땅(시가지): 가까운 바닥 그림 바깥 땅 색과 같게
const FIELD = new THREE.Color('#a9b48f');   // 들·낮은 언덕
const FOREST = new THREE.Color('#5f7f4f');  // 산 (높거나 가파른 곳)
const BLD_COLORS = ['#d9d4c8', '#cfcabe', '#e3ded3', '#c4c2bc', '#d6cbbb'].map((c) => new THREE.Color(c)); // 임의 (창·재질 없음)
const SINK = [2.5, 40, 300]; // 가까운 지형 안쪽에서 먼 지형을 내리는 깊이: 가장자리 2.5m → 안쪽 300m부터 40m (150m 칸이 움푹한 땅 위로 튀어나오지 않게)

export function buildSurroundings(scene, data) {
  const group = new THREE.Group();
  const far = decodeFar(data.far);
  group.add(farTerrainMesh(far));
  const blds = buildingBlocks(data.buildings, far);
  group.add(blds);
  scene.add(group);
  return {
    group, buildings: blds,
    count: data.buildings.length,
  };
}

function decodeFar(f) {
  const bin = atob(f.data);
  const h = new Float32Array(f.n * f.n);
  for (let i = 0; i < h.length; i++) {
    const v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    h[i] = (v >= 32768 ? v - 65536 : v) * f.unit;
  }
  const at = (x, z) => { // 이중 선형 보간
    const u = Math.min(f.n - 1.001, Math.max(0, (x - f.x0) / f.step)), v = Math.min(f.n - 1.001, Math.max(0, (z - f.z0) / f.step));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * f.n + i;
    return (h[k] * (1 - fu) + h[k + 1] * fu) * (1 - fv) + (h[k + f.n] * (1 - fu) + h[k + f.n + 1] * fu) * fv;
  };
  return { ...f, h, at };
}

// 가까운 지형 격자 안쪽인지 (안쪽이면 그 높이를 씀)
function nearHeight(x, z, nb) {
  return x > nb.x0 && x < nb.x1 && z > nb.z0 && z < nb.z1 ? heightAt(x, z) : null;
}

function farTerrainMesh(far) {
  const nb = terrainBounds();
  const { n, step, x0, z0, h } = far;
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
  const c = new THREE.Color();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, x = x0 + i * step, z = z0 + j * step;
      const near = nearHeight(x, z, nb);
      const edge = near !== null ? Math.min(x - nb.x0, nb.x1 - x, z - nb.z0, nb.z1 - z) : 0;
      const y = near !== null ? near - SINK[0] - (SINK[1] - SINK[0]) * Math.min(1, edge / SINK[2]) : h[k];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      // 높이·경사로 색: 낮은 시가지 → 들 → 산
      const sx = (h[j * n + Math.min(n - 1, i + 1)] - h[j * n + Math.max(0, i - 1)]) / (2 * step);
      const sz = (h[Math.min(n - 1, j + 1) * n + i] - h[Math.max(0, j - 1) * n + i]) / (2 * step);
      const slope = Math.hypot(sx, sz);
      const t = THREE.MathUtils.smoothstep(Math.max(h[k] / 160, slope / 0.18), 0.25, 1);
      c.copy(LOW).lerp(FIELD, THREE.MathUtils.smoothstep(h[k], 8, 40)).lerp(FOREST, t);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
  }
  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  let m = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
      index[m++] = a; index[m++] = cc; index[m++] = b;
      index[m++] = b; index[m++] = cc; index[m++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.renderOrder = -1;
  return mesh;
}

// 둘레 건물: 외곽선을 세운 단순한 덩어리(벽 + 평지붕) 한 메시
function buildingBlocks(list, far) {
  const nb = terrainBounds();
  const pos = [], nor = [], col = [];
  const push = (p, nrm, cl) => { pos.push(p[0], p[1], p[2]); nor.push(...nrm); col.push(cl.r, cl.g, cl.b); };
  list.forEach((b, bi) => {
    const o = b.o;
    let lo = Infinity;
    for (const [x, z] of o) lo = Math.min(lo, nearHeight(x, z, nb) ?? far.at(x, z));
    const y0 = lo - 2, y1 = lo + b.h;
    const wall = BLD_COLORS[bi % BLD_COLORS.length];
    const shade = wall.clone().multiplyScalar(0.8);
    const ar = signedArea(o) > 0 ? 1 : -1;
    for (let i = 0; i < o.length; i++) {
      const [x1, z1] = o[i], [x2, z2] = o[(i + 1) % o.length];
      const L = Math.hypot(x2 - x1, z2 - z1) || 1;
      const nrm = [((z2 - z1) / L) * ar, 0, (-(x2 - x1) / L) * ar];
      const a = [x1, y0, z1], bb = [x2, y0, z2], c = [x2, y1, z2], d = [x1, y1, z1];
      // 바깥을 보도록 감기 (n·(b−a)×(c−a) > 0)
      const flip = ((bb[1] - a[1]) * (c[2] - a[2]) - (bb[2] - a[2]) * (c[1] - a[1])) * nrm[0]
        + ((bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0])) * nrm[2] < 0;
      const tri = (p, q, r) => (flip ? [p, r, q] : [p, q, r]);
      for (const [p, q, r] of [tri(a, bb, c), tri(a, c, d)]) {
        push(p, nrm, p[1] === y0 ? shade : wall); push(q, nrm, q[1] === y0 ? shade : wall); push(r, nrm, r[1] === y0 ? shade : wall);
      }
    }
    const roof = wall.clone().multiplyScalar(0.92);
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(o.map(([x, z]) => new THREE.Vector2(x, z)), [])) {
      const t = [[o[i][0], y1, o[i][1]], [o[j][0], y1, o[j][1]], [o[k][0], y1, o[k][1]]];
      const up = ((t[1][2] - t[0][2]) * (t[2][0] - t[0][0]) - (t[1][0] - t[0][0]) * (t[2][2] - t[0][2])) > 0;
      for (const p of up ? t : [t[0], t[2], t[1]]) push(p, [0, 1, 0], roof);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

function signedArea(o) {
  let s = 0;
  for (let i = 0; i < o.length; i++) {
    const [x1, z1] = o[i], [x2, z2] = o[(i + 1) % o.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}
