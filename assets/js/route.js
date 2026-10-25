// 길 안내: 차도(campus.roads 중 car)를 점·선 그래프로 만들고 A*로 다음 미션까지 도로를 따라가는 경로를 찾는다.
// OSM 도로는 교차로에서 같은 점을 쓰므로 좌표가 같은 점(0.1m 반올림)을 하나로 합친다.

export class RoadGraph {
  constructor(campus) {
    this.pts = [];
    this.adj = [];
    this.blocked = new Set(); // 막힌 간선 "a,b" (무작위 사건: 공사·셔틀버스 고장)
    const id = new Map();
    const node = ([x, z]) => {
      const k = `${Math.round(x * 10)},${Math.round(z * 10)}`;
      if (!id.has(k)) { id.set(k, this.pts.length); this.pts.push([x, z]); this.adj.push([]); }
      return id.get(k);
    };
    for (const r of campus.roads) {
      if (!r.car) continue;
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = node(r.points[i]), b = node(r.points[i + 1]);
        if (a === b) continue;
        const w = Math.hypot(this.pts[a][0] - this.pts[b][0], this.pts[a][1] - this.pts[b][1]);
        this.adj[a].push([b, w]);
        this.adj[b].push([a, w]);
      }
    }
  }

  nearest(x, z) {
    let best = -1, bd = Infinity;
    this.pts.forEach(([px, pz], i) => {
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bd && this.adj[i].length) { bd = d; best = i; }
    });
    return best;
  }

  // (x, z)에서 r 안을 지나는 간선을 막음 / 모두 풀기
  block(x, z, r) {
    this.adj.forEach((list, a) => {
      for (const [b] of list) {
        const [x1, z1] = this.pts[a], [x2, z2] = this.pts[b];
        const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
        if (Math.hypot(x1 + dx * t - x, z1 + dz * t - z) < r) this.blocked.add(`${a},${b}`);
      }
    });
  }
  clearBlocks() { this.blocked.clear(); }

  // (ax, az) → (bx, bz) 도로를 따라가는 점 목록 (처음·끝은 그 자리). 못 찾으면 직선 (.ok = false)
  path(ax, az, bx, bz) {
    const s = this.nearest(ax, az), t = this.nearest(bx, bz);
    if (s < 0 || t < 0) return [[ax, az], [bx, bz]];
    const P = this.pts, n = P.length;
    const g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const h = (i) => Math.hypot(P[i][0] - P[t][0], P[i][1] - P[t][1]);
    const open = [[h(s), s]];
    g[s] = 0;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, u] = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (u === t) break;
      for (const [v, w] of this.adj[u]) {
        if (this.blocked.size && this.blocked.has(`${u},${v}`)) continue;
        const ng = g[u] + w;
        if (ng < g[v]) { g[v] = ng; prev[v] = u; open.push([ng + h(v), v]); }
      }
    }
    if (!isFinite(g[t])) return Object.assign([[ax, az], [bx, bz]], { ok: false });
    const out = [];
    for (let u = t; u !== -1; u = prev[u]) out.push(P[u]);
    out.reverse();
    return Object.assign([[ax, az], ...out, [bx, bz]], { ok: true });
  }
}
