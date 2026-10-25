// 화면 위 정보: 속도, 가까운 건물 이름, 주요 건물 이름표, 미니맵, 품질·소리 버튼, 조작법, 알림.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const tmp = new THREE.Vector3();

// 미니맵: 보이는 반경(m)과 미리 그려 두는 지도 해상도(px/m)
const MINIMAP = { radius: 260, res: 0.7 };
// 이름표가 가리면 안 되는 HUD 요소들
const LABEL_BLOCKERS = ['quality', 'minimap', 'mission-list', 'building-name', 'timer', 'boost-gauge', 'speedo', 'late-start', 'toast'];

export class Hud {
  constructor({ onQuality, onSound, onOption }) {
    this.speedEl = $('speed');
    this.buildingEl = $('building-name');
    this.toastEl = $('toast');
    this.helpEl = $('help');
    this.fpsEl = $('fps');
    this.lastSpeed = -1;
    this.lastBuilding = null;
    this.toastTimer = null;
    this.helpTimer = null;
    this.labels = [];

    this.gaugeEl = $('boost-gauge');
    this.gaugeFill = this.gaugeEl.querySelector('.boost-fill');
    this.gaugeText = this.gaugeEl.querySelector('.boost-text');
    this.lastGauge = -1;
    this.lastGaugeState = null;

    this.lines = $('speedlines');
    this.linesCtx = this.lines.getContext('2d');
    this.linesOn = false;

    this.qualityButtons = [...document.querySelectorAll('#quality button[data-q]')];
    for (const btn of this.qualityButtons) {
      btn.addEventListener('click', () => {
        onQuality(btn.dataset.q);
        btn.blur(); // Space가 버튼을 다시 누르지 않도록
      });
    }
    // 설정: 바깥 건물·사람·차 켜고 끄기 (기본 꺼짐)
    this.optionButtons = [...document.querySelectorAll('#quality button[data-opt]')];
    for (const btn of this.optionButtons) {
      btn.addEventListener('click', () => { onOption?.(btn.dataset.opt); btn.blur(); });
    }
    this.soundBtn = $('sound-btn');
    this.soundBtn.addEventListener('click', () => { onSound(); this.soundBtn.blur(); });
  }

  setSound(on) {
    this.soundBtn.textContent = on ? '🔊' : '🔇';
    this.soundBtn.classList.toggle('off', !on);
  }

  // 미션 완료로 부스터 게이지가 찰 때 반짝
  flashGauge() {
    this.gaugeEl.classList.remove('charged');
    void this.gaugeEl.offsetWidth;
    this.gaugeEl.classList.add('charged');
  }

  // ---------- 미니맵 ----------

  // 건물·차도·캠퍼스 경계를 한 번 그려 두고, 매 프레임 굴착기 주변만 잘라 원형으로 보여 준다
  initMinimap(campus) {
    const xs = [], zs = [];
    for (const r of campus.roads) for (const [x, z] of r.points) { xs.push(x); zs.push(z); }
    const pad = MINIMAP.radius;
    this.mmBounds = { x0: Math.min(...xs) - pad, z0: Math.min(...zs) - pad, x1: Math.max(...xs) + pad, z1: Math.max(...zs) + pad };
    const B = this.mmBounds, S = MINIMAP.res;
    const off = document.createElement('canvas');
    off.width = Math.ceil((B.x1 - B.x0) * S);
    off.height = Math.ceil((B.z1 - B.z0) * S);
    const g = off.getContext('2d');
    const P = (x, z) => [(x - B.x0) * S, (z - B.z0) * S];
    const poly = (pts) => { g.beginPath(); pts.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](...P(x, z))); g.closePath(); };
    g.fillStyle = '#d7d6d0';
    g.fillRect(0, 0, off.width, off.height);
    g.fillStyle = '#eceae4';
    poly(campus.boundary);
    g.fill();
    g.fillStyle = '#b9dd98';
    for (const gr of campus.greens) if (gr.kind !== 'park' && gr.kind !== 'water') { poly(gr.outline); g.fill(); }
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = '#8f939a';
    for (const r of campus.roads) {
      if (!r.car) continue;
      g.lineWidth = Math.max(2, r.width * S);
      g.beginPath();
      r.points.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](...P(x, z)));
      g.stroke();
    }
    g.fillStyle = '#b4a48c';
    for (const b of campus.buildings) { poly(b.outline); g.fill(); }
    this.mmOff = off;
    this.mmCanvas = $('minimap');
    this.mmCtx = this.mmCanvas.getContext('2d');
  }

  // carPos: Vector2(x, z), heading: rad, target: {x, z} 또는 null
  drawMinimap(carPos, heading, target) {
    const c = this.mmCanvas, g = this.mmCtx;
    const css = c.clientWidth || 184;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== css * dpr) { c.width = c.height = css * dpr; }
    const W = c.width, R = W / 2, k = R / MINIMAP.radius; // px per m
    const B = this.mmBounds, S = MINIMAP.res;
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath();
    g.arc(R, R, R, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#d7d6d0';
    g.fillRect(0, 0, W, W);
    const sx = (carPos.x - MINIMAP.radius - B.x0) * S, sz = (carPos.y - MINIMAP.radius - B.z0) * S;
    g.drawImage(this.mmOff, sx, sz, MINIMAP.radius * 2 * S, MINIMAP.radius * 2 * S, 0, 0, W, W);

    // 다음 미션 장소 (범위 밖이면 가장자리에)
    if (target) {
      let dx = (target.x - carPos.x) * k, dz = (target.z - carPos.y) * k;
      const d = Math.hypot(dx, dz), max = R - 10 * dpr;
      if (d > max) { dx *= max / d; dz *= max / d; }
      const pulse = 1 + 0.25 * Math.sin(performance.now() / 180);
      g.fillStyle = target.final ? '#3fb6ff' : '#ffc21a';
      g.strokeStyle = '#2b3240';
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.arc(R + dx, R + dz, 6 * dpr * pulse, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // 내 굴착기: 방향 화살표 (앞 = (sin h, cos h), 화면 x = 동쪽, y = 남쪽)
    g.translate(R, R);
    g.rotate(Math.atan2(Math.cos(heading), Math.sin(heading)));
    g.fillStyle = '#ff5a3c';
    g.strokeStyle = '#fff';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.moveTo(11 * dpr, 0);
    g.lineTo(-7 * dpr, 7 * dpr);
    g.lineTo(-3 * dpr, 0);
    g.lineTo(-7 * dpr, -7 * dpr);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // 테두리와 북쪽 표시
    g.lineWidth = 4 * dpr;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.arc(R, R, R - 2 * dpr, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#2b3240';
    g.font = `800 ${12 * dpr}px sans-serif`;
    g.textAlign = 'center';
    g.fillText('N', R, 16 * dpr);
  }

  setQuality(q) {
    for (const btn of this.qualityButtons) btn.classList.toggle('on', btn.dataset.q === q);
  }

  setOption(name, on) {
    for (const btn of this.optionButtons) if (btn.dataset.opt === name) btn.classList.toggle('on', on);
  }

  setSpeed(kmh) {
    const v = Math.round(kmh);
    if (v !== this.lastSpeed) {
      this.speedEl.textContent = v;
      this.lastSpeed = v;
    }
  }

  setBuilding(name) {
    if (name === this.lastBuilding) return;
    this.lastBuilding = name;
    if (name) this.buildingEl.textContent = `🏫 ${name}`;
    this.buildingEl.classList.toggle('hidden', !name);
  }

  toast(text, ms = 1500) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  showHelp(ms = 7000) {
    this.helpEl.classList.remove('hidden');
    clearTimeout(this.helpTimer);
    this.helpTimer = setTimeout(() => this.helpEl.classList.add('hidden'), ms);
  }

  // 주요 건물 위에 항상 보이는 이름표. 멀어질수록 작아진다.
  // maxDist: 이만큼 가까이 와야 보이는 작은 이름표 (조형물·기념물)
  addLabel(text, x, y, z, { maxDist = Infinity, small = false } = {}) {
    const el = document.createElement('div');
    el.className = small ? 'label small' : 'label';
    el.textContent = text;
    document.getElementById('labels').appendChild(el);
    this.labels.push({ el, pos: new THREE.Vector3(x, y, z), maxDist });
  }

  // 가까운 이름표부터 놓고, 이미 놓인 이름표나 HUD와 겹치면 위·아래로 비켜 보고, 그래도 겹치면 숨긴다
  updateLabels(camera) {
    const w = innerWidth / 2, h = innerHeight / 2;
    const blocks = [];
    for (const id of LABEL_BLOCKERS) {
      const el = $(id);
      if (!el || el.classList.contains('hidden')) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) blocks.push(r);
    }
    const items = [];
    for (const label of this.labels) {
      tmp.copy(label.pos).project(camera);
      if (tmp.z > 1) { label.el.style.display = 'none'; continue; } // 카메라 뒤
      const dist = camera.position.distanceTo(label.pos);
      if (dist > label.maxDist) { label.el.style.display = 'none'; continue; }
      items.push({ label, dist, x: tmp.x * w + w, y: -tmp.y * h + h });
    }
    items.sort((a, b) => a.dist - b.dist);
    const placed = [];
    const hits = (r) => [...placed, ...blocks].some((o) => r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top);
    for (const { label, dist, x, y } of items) {
      const { el } = label;
      el.style.display = '';
      const scale = Math.min(1, Math.max(0.45, 180 / dist));
      const lw = el.offsetWidth * scale, lh = el.offsetHeight * scale;
      let spot = null;
      for (const shift of [0, -1.15, 1.15, -2.3]) { // 제자리 → 위 → 아래 → 더 위
        const top = y - lh + shift * lh;
        const r = { left: x - lw / 2 - 4, right: x + lw / 2 + 4, top: top - 2, bottom: top + lh + 2 };
        if (!hits(r)) { spot = { r, top }; break; }
      }
      if (!spot) { el.style.display = 'none'; continue; }
      placed.push(spot.r);
      el.style.transform = `translate(${x}px, ${spot.top + lh}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      el.style.zIndex = String(10000 - Math.round(dist));
    }
  }

  // value: 0~1, state: 'active'(쓰는 중) | 'ready'(가득) | ''(차는 중)
  setBoost(value, state) {
    const pct = Math.round(value * 200) / 2;
    if (pct !== this.lastGauge) {
      this.gaugeFill.style.width = `${pct}%`;
      this.lastGauge = pct;
    }
    if (state !== this.lastGaugeState) {
      this.gaugeEl.classList.toggle('ready', state === 'ready');
      this.gaugeEl.classList.toggle('active', state === 'active');
      this.gaugeText.textContent = state === 'ready' ? 'BOOST READY' : state === 'active' ? 'BOOST!!' : 'BOOST';
      this.lastGaugeState = state;
    }
  }

  // 부스터 중 화면 가장자리의 방사형 속도선 (fx: 0~1)
  drawSpeedLines(fx) {
    const c = this.lines, g = this.linesCtx;
    if (fx < 0.02) {
      if (this.linesOn) { g.clearRect(0, 0, c.width, c.height); this.linesOn = false; }
      return;
    }
    if (c.width !== innerWidth || c.height !== innerHeight) { c.width = innerWidth; c.height = innerHeight; }
    this.linesOn = true;
    const w = c.width, h = c.height, cx = w / 2, cy = h / 2;
    const R = Math.hypot(cx, cy);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = `rgba(255, 255, 255, ${(0.55 * fx).toFixed(3)})`;
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = R * (0.55 + Math.random() * 0.3);
      const r1 = r0 + R * (0.12 + Math.random() * 0.3) * fx;
      g.lineWidth = 1 + Math.random() * 2.5;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
  }

  // ---------- 지각 모드 ----------

  // handlers: { start, resume, retry, exit }
  bindLate(handlers) {
    const click = (el, fn) => el.addEventListener('click', () => { el.blur(); fn(); });
    click($('late-start'), handlers.start);
    for (const btn of document.querySelectorAll('#pause-menu button, #result button')) {
      click(btn, handlers[btn.dataset.act]);
    }
    this.timerEl = $('timer');
    this.listEl = $('mission-list');
    this.tagEl = $('target-tag');
    this.arrowEl = $('target-arrow');
    this.hintEl = $('mission-hint');
    this.progressEl = $('mission-progress');
    this.countdownEl = $('countdown');
    this.lastTimer = null;
  }

  // 연출 중에는 게임 HUD를 숨기고 말풍선만
  setCinematic(on) {
    document.body.classList.toggle('cine', on);
  }

  // 지각 모드 시작 연출: 내려다본 캠퍼스 위에 미션 장소(이모지 + 이름)를 하나씩 띄운다
  setPins(list) {
    this.clearPins();
    const box = $('pins');
    this.pins = list.map((p, i) => {
      const el = document.createElement('div');
      el.className = 'pin';
      const num = document.createElement('span');
      num.className = 'pin-num';
      num.textContent = i === list.length - 1 ? '도착' : String(i + 1);
      const emoji = document.createElement('span');
      emoji.className = 'pin-emoji';
      emoji.textContent = p.emoji;
      const name = document.createElement('span');
      name.className = 'pin-name';
      name.textContent = p.label;
      el.append(num, emoji, name);
      box.appendChild(el);
      return { el, pos: p.pos };
    });
  }

  showPin(i) {
    this.pins?.[i]?.el.classList.add('on');
  }

  updatePins(camera) {
    if (!this.pins?.length) return;
    for (const p of this.pins) {
      tmp.copy(p.pos).project(camera);
      const x = (tmp.x + 1) / 2 * innerWidth, y = (1 - tmp.y) / 2 * innerHeight;
      p.el.style.left = `${x}px`;
      p.el.style.top = `${y}px`;
    }
  }

  clearPins() {
    const box = $('pins');
    if (box) box.textContent = '';
    this.pins = [];
  }

  // "F다." 같은 순간에 화면 흔들림
  shake() {
    document.body.classList.remove('shake');
    void document.body.offsetWidth; // 애니메이션 다시 시작
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 650);
  }

  setLateMode(on) {
    document.body.classList.toggle('late', on);
    if (!on) {
      this.showPause(false);
      this.showResult(null);
      this.showProgress(null);
      this.setHint(null);
      this.showCountdown(null);
    }
  }

  // remaining: 남은 초 (0에서 멈춤: 시간이 끝나면 바로 실패)
  setTimer(remaining) {
    const s = Math.max(0, Math.ceil(remaining));
    const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (text === this.lastTimer) return;
    this.lastTimer = text;
    this.timerEl.textContent = text;
    this.timerEl.classList.toggle('warn', s <= 30);
  }

  // missions: [{emoji, label, title}], current: 지금 미션 번호 (이전 것은 완료)
  setMissions(missions, current) {
    this.listEl.innerHTML = '<h3>오늘의 할 일</h3>' + missions.map((m, i) => {
      const cls = i < current ? 'done' : i === current ? 'current' : '';
      const check = i < current ? '✅' : m.emoji;
      return `<div class="mission-item ${cls}"><span class="check">${check}</span>`
        + `<span><b>${m.label}</b><br><span class="title">${m.title}</span></span></div>`;
    }).join('');
  }

  // 목표 위치 표시: 화면 안이면 목표 위에 거리 꼬리표, 밖이면 가장자리에 방향 화살표
  updateTarget(camera, pos, dist) {
    if (!pos) {
      this.tagEl.style.display = this.arrowEl.style.display = 'none';
      return;
    }
    tmp.copy(pos).project(camera);
    const behind = tmp.z > 1;
    let x = behind ? -tmp.x : tmp.x, y = behind ? -tmp.y : tmp.y;
    const w = innerWidth / 2, h = innerHeight / 2;
    const label = `${Math.round(dist)}m`;
    if (!behind && Math.abs(x) < 0.9 && Math.abs(y) < 0.85) {
      this.arrowEl.style.display = 'none';
      this.tagEl.style.display = '';
      this.tagEl.textContent = label;
      this.tagEl.style.transform = `translate(${x * w + w}px, ${-y * h + h}px) translate(-50%, -100%)`;
      return;
    }
    this.tagEl.style.display = 'none';
    this.arrowEl.style.display = '';
    if (behind && Math.abs(y) < 0.2) y = -0.2; // 바로 뒤면 아래쪽에 표시
    const sx = x * w, sy = -y * h;
    const k = Math.min((w - 60) / Math.max(Math.abs(sx), 1e-3), (h - 70) / Math.max(Math.abs(sy), 1e-3));
    this.arrowEl.style.transform = `translate(${w + sx * k}px, ${h + sy * k}px)`;
    this.arrowEl.firstElementChild.style.transform = `rotate(${Math.atan2(sy, sx)}rad)`;
    this.arrowEl.lastElementChild.textContent = label;
  }

  setHint(text) {
    if (text) this.hintEl.textContent = text;
    this.hintEl.classList.toggle('hidden', !text);
  }

  // mission: { emoji, line }, t: 0~1 진행 (null이면 숨김)
  showProgress(mission, t = 0) {
    if (!mission) { this.progressEl.classList.add('hidden'); return; }
    this.progressEl.classList.remove('hidden');
    this.progressEl.querySelector('.mp-emoji').textContent = mission.emoji;
    this.progressEl.querySelector('.mp-line').textContent = t >= 1 ? mission.line : `${mission.title} 중…`;
    this.progressEl.querySelector('.mp-fill').style.width = `${Math.min(1, t) * 100}%`;
  }

  showCountdown(text, kind = '') {
    this.countdownEl.textContent = text || '';
    this.countdownEl.className = text ? kind : '';
  }

  showPause(on) {
    $('pause-menu').classList.toggle('hidden', !on);
  }

  // r: { grade, elapsed, remaining, done, total, timedOut } 또는 null
  showResult(r) {
    const el = $('result');
    el.classList.toggle('hidden', !r);
    if (!r) return;
    const fmt = (s) => `${Math.floor(Math.abs(s) / 60)}분 ${String(Math.floor(Math.abs(s) % 60)).padStart(2, '0')}초`;
    const ok = r.grade !== 'F';
    el.querySelector('.res-title').textContent = ok ? '늦지 않았다!' : r.timedOut ? '시간 초과…' : '지각…';
    const g = el.querySelector('.res-grade');
    g.textContent = r.grade;
    g.className = `res-grade ${ok ? 'good' : 'bad'}`;
    el.querySelector('.res-times').innerHTML = `완료한 미션 <b>${r.done}/${r.total}</b><br>걸린 시간 <b>${fmt(r.elapsed)}</b>`
      + (ok ? `<br>남은 시간 <b>${fmt(r.remaining)}</b>` : '');
  }

  setFps(fps) {
    this.fpsEl.classList.remove('hidden');
    this.fpsEl.textContent = `${fps} fps`;
  }
}
