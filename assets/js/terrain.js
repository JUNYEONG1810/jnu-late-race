// 지형 높이: data/terrain.json(5m 격자, 정문 앞 출발점 = 0m)을 읽어 heightAt(x, z)로 돌려준다.
// 지형 메시와 같은 삼각형으로 보간해서, 굴착기·건물·소품이 화면의 땅과 정확히 맞는다.
// 불러오기 전에는 0(평평한 땅).
import * as THREE from 'three';

let T = null; // { step, x0, z0, nx, nz, h: Float32Array }

export async function loadTerrain(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const j = await res.json();
  const bin = atob(j.data);
  const h = new Float32Array(j.nx * j.nz);
  for (let i = 0; i < h.length; i++) {
    h[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) / 100 + j.offsetCm / 100;
  }
  T = { step: j.step, x0: j.x0, z0: j.z0, nx: j.nx, nz: j.nz, h };
  return T;
}

export function hasTerrain() {
  return T !== null;
}

// 지형 격자가 덮는 사각형 (바깥 풍경이 그 안쪽을 비켜 가도록)
export function terrainBounds() {
  const { step, x0, z0, nx, nz } = T;
  return { x0, z0, x1: x0 + (nx - 1) * step, z1: z0 + (nz - 1) * step };
}

// 격자 칸 (i, j)를 대각선 (i, j+1)–(i+1, j)로 나눈 두 삼각형 (메시와 같은 방식)
export function heightAt(x, z) {
  if (!T) return 0;
  const { step, x0, z0, nx, nz, h } = T;
  let u = (x - x0) / step, v = (z - z0) / step;
  u = Math.min(nx - 1.0001, Math.max(0, u));
  v = Math.min(nz - 1.0001, Math.max(0, v));
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const k = j * nx + i;
  const a = h[k], b = h[k + 1], c = h[k + nx], d = h[k + nx + 1];
  return fu + fv <= 1
    ? a + (b - a) * fu + (c - a) * fv
    : d + (c - d) * (1 - fu) + (b - d) * (1 - fv);
}

// 다각형 안(꼭짓점, 변 위 점, 안쪽 격자점)의 가장 낮은 땅 높이와 가장 높은 땅 높이
export function heightRange(outline, spacing = 4) {
  let lo = Infinity, hi = -Infinity;
  const see = (x, z) => { const y = heightAt(x, z); if (y < lo) lo = y; if (y > hi) hi = y; };
  for (let i = 0; i < outline.length; i++) {
    const [x1, z1] = outline[i], [x2, z2] = outline[(i + 1) % outline.length];
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / spacing));
    for (let s = 0; s < n; s++) see(x1 + ((x2 - x1) * s) / n, z1 + ((z2 - z1) * s) / n);
  }
  const xs = outline.map((p) => p[0]), zs = outline.map((p) => p[1]);
  for (let x = Math.min(...xs) + spacing / 2; x < Math.max(...xs); x += spacing) {
    for (let z = Math.min(...zs) + spacing / 2; z < Math.max(...zs); z += spacing) {
      if (inside(x, z, outline)) see(x, z);
    }
  }
  return { lo, hi };
}

// 지형 메시: 격자 그대로 + 바깥 테두리를 멀리(far m)까지 같은 높이로 늘린 띠(지평선까지 땅이 이어지게).
// uv는 bounds(바닥 그림이 덮는 사각형) 기준 0~1. 그 밖은 텍스처 가장자리 색으로 채워진다.
export function buildTerrainGeometry(bounds, far = 3000) {
  const { step, x0, z0, nx, nz, h } = T;
  // 바깥 띠를 위해 앞뒤로 한 줄씩 더 둔 (nx+2)×(nz+2) 격자
  const W = nx + 2, H = nz + 2;
  const pos = new Float32Array(W * H * 3), uv = new Float32Array(W * H * 2);
  const gx = (i) => (i === 0 ? x0 - far : i === W - 1 ? x0 + (nx - 1) * step + far : x0 + (i - 1) * step);
  const gz = (j) => (j === 0 ? z0 - far : j === H - 1 ? z0 + (nz - 1) * step + far : z0 + (j - 1) * step);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const x = gx(i), z = gz(j);
      const hi = Math.min(nx - 1, Math.max(0, i - 1)), hj = Math.min(nz - 1, Math.max(0, j - 1));
      pos[k * 3] = x; pos[k * 3 + 1] = h[hj * nx + hi]; pos[k * 3 + 2] = z;
      uv[k * 2] = (x - bounds.x0) / (bounds.x1 - bounds.x0);
      uv[k * 2 + 1] = 1 - (z - bounds.z0) / (bounds.z1 - bounds.z0);
    }
  }
  const index = new Uint32Array((W - 1) * (H - 1) * 6);
  let n = 0;
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      // heightAt과 같은 대각선 (b–c). 위(+y)를 보도록 감기 방향
      index[n++] = a; index[n++] = c; index[n++] = b;
      index[n++] = b; index[n++] = c; index[n++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// 연못(용지): 지형 자료(등고선)에는 물이 따로 없어 물 안쪽 땅이 5m 넘게 기울어 있다. 물 안쪽 격자점을
// 물가 높이의 아래쪽 1/4값 하나로 평평하게 해서 수면이 구겨져 보이지 않게 한다 (지형 메시·heightAt 모두).
export function flattenWater(outlines, { quantile = 0.25 } = {}) {
  if (!T) return [];
  const { step, x0, z0, nx, nz, h } = T;
  const levels = [];
  for (const o of outlines) {
    const edge = [];
    for (let i = 0; i < o.length; i++) {
      const [x1, z1] = o[i], [x2, z2] = o[(i + 1) % o.length];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 2));
      for (let s = 0; s < n; s++) edge.push(heightAt(x1 + ((x2 - x1) * s) / n, z1 + ((z2 - z1) * s) / n));
    }
    edge.sort((a, b) => a - b);
    const level = edge[Math.floor(edge.length * quantile)];
    const xs = o.map((p) => p[0]), zs = o.map((p) => p[1]);
    for (let j = Math.max(0, Math.floor((Math.min(...zs) - z0) / step)); j <= Math.min(nz - 1, Math.ceil((Math.max(...zs) - z0) / step)); j++) {
      for (let i = Math.max(0, Math.floor((Math.min(...xs) - x0) / step)); i <= Math.min(nx - 1, Math.ceil((Math.max(...xs) - x0) / step)); i++) {
        if (inside(x0 + i * step, z0 + j * step, o)) h[j * nx + i] = level;
      }
    }
    levels.push(level);
  }
  return levels;
}

function inside(x, z, poly) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < xi + ((z - zi) * (xj - xi)) / (zj - zi)) r = !r;
  }
  return r;
}
