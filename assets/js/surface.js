// 지면 속도: 잔디·흙·운동장·숲·밭 위에서는 굴착기 최고 속도가 약 70% (부스터 중에는 어디서나 그대로).
// 위에서 본 2m 칸 그림 한 장(캔버스에 칠한 뒤 읽어 바이트 배열로, 캔버스는 버림)으로 빠르게 찾는다.
// 차도·보행로·주차장은 포장이라 그대로 빠름.

export const SURFACE = { slow: 0.7, cell: 2, kinds: ['grass', 'park', 'pitch', 'dirt', 'track', 'farm', 'forest'] };

export function buildSurface(campus) {
  const xs = campus.boundary.map((p) => p[0]), zs = campus.boundary.map((p) => p[1]);
  const x0 = Math.min(...xs) - 60, z0 = Math.min(...zs) - 60, x1 = Math.max(...xs) + 60, z1 = Math.max(...zs) + 60;
  const C = SURFACE.cell, W = Math.ceil((x1 - x0) / C), H = Math.ceil((z1 - z0) / C);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const P = ([x, z]) => [(x - x0) / C, (z - z0) / C];
  const poly = (o) => { g.beginPath(); o.forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](...P(p))); g.closePath(); g.fill(); };
  g.fillStyle = '#fff'; // 흰색 = 느림
  for (const gr of campus.greens) if (SURFACE.kinds.includes(gr.kind)) poly(gr.outline);
  // 정사영상에서 찾은 잔디 칸
  const L = campus.lawns;
  if (L?.cells) for (const [i, j] of L.cells) g.fillRect((L.x0 + i * L.cell - x0) / C, (L.z0 + j * L.cell - z0) / C, L.cell / C + 0.5, L.cell / C + 0.5);
  // 포장(검정 = 빠름): 차도·보행로·주차장·물 위는 덮어 칠함
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  g.lineCap = g.lineJoin = 'round';
  for (const o of campus.parking || []) poly(o);
  for (const r of campus.roads) {
    g.lineWidth = Math.max(1, r.width / C);
    g.beginPath();
    r.points.forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](...P(p)));
    g.stroke();
  }
  const img = g.getImageData(0, 0, W, H).data;
  const slow = new Uint8Array(W * H);
  for (let i = 0; i < slow.length; i++) slow[i] = img[i * 4] > 127 ? 1 : 0;
  canvas.width = canvas.height = 1; // 캔버스는 버림
  return {
    // 그 자리의 속도 배율 (1 = 포장, SURFACE.slow = 잔디·흙·운동장)
    factorAt(x, z) {
      const i = Math.floor((x - x0) / C), j = Math.floor((z - z0) / C);
      if (i < 0 || j < 0 || i >= W || j >= H) return 1;
      return slow[j * W + i] ? SURFACE.slow : 1;
    },
  };
}
