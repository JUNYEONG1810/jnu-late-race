// 캠퍼스 바깥 풍경: 먼 지형(data/far-terrain.json, ±15km, 300m 격자 약 27KB, 무등산 능선 포함)만.
// 둘레 건물은 넣지 않는다(밤샘 2단계: 메모리·draw call 절약). 충돌 없음, 그림자 없음. 가까운 지형 격자(terrain.json) 안쪽은 먼 지형을 그 아래로 내려 겹치지 않게 한다.
// 정점 배열은 GPU에 올린 뒤 해제(freeAfterUpload).
import * as THREE from 'three';
import { heightAt, terrainBounds } from './terrain.js';
import { freeAfterUpload } from './map.js';

const LOW = new THREE.Color('#c9c5bc');     // 낮은 땅(시가지): 가까운 바닥 그림 바깥 땅 색과 같게
const FIELD = new THREE.Color('#a9b48f');   // 들·낮은 언덕
const FOREST = new THREE.Color('#5f7f4f');  // 산 (높거나 가파른 곳)
const SINK = [2.5, 40, 300]; // 가까운 지형 안쪽에서 먼 지형을 내리는 깊이: 가장자리 2.5m → 안쪽 300m부터 40m (큰 칸이 움푹한 땅 위로 튀어나오지 않게)

// 먼 지형 메시 (visible을 끄면 가벼운 모드)
export function buildFarTerrain(scene, data) {
  const far = decodeFar(data);
  const mesh = freeAfterUpload(farTerrainMesh(far));
  scene.add(mesh);
  return { mesh, far };
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

