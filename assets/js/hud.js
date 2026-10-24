// 화면 위 정보: 속도, 가까운 건물 이름, 주요 건물 이름표, 품질 버튼, 조작법, 알림.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const tmp = new THREE.Vector3();

export class Hud {
  constructor({ onQuality }) {
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

    this.qualityButtons = [...document.querySelectorAll('#quality button')];
    for (const btn of this.qualityButtons) {
      btn.addEventListener('click', () => {
        onQuality(btn.dataset.q);
        btn.blur(); // Space가 버튼을 다시 누르지 않도록
      });
    }
  }

  setQuality(q) {
    for (const btn of this.qualityButtons) btn.classList.toggle('on', btn.dataset.q === q);
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
  addLabel(text, x, y, z) {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = text;
    document.getElementById('labels').appendChild(el);
    this.labels.push({ el, pos: new THREE.Vector3(x, y, z) });
  }

  updateLabels(camera) {
    const w = innerWidth / 2, h = innerHeight / 2;
    for (const { el, pos } of this.labels) {
      const dist = camera.position.distanceTo(pos);
      tmp.copy(pos).project(camera);
      if (tmp.z > 1) { el.style.display = 'none'; continue; } // 카메라 뒤
      const scale = Math.min(1, Math.max(0.45, 180 / dist));
      el.style.display = '';
      el.style.transform = `translate(${tmp.x * w + w}px, ${-tmp.y * h + h}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
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

  // remaining: 남은 초 (음수면 지각)
  setTimer(remaining) {
    // 남은 시간은 올림, 지각(올라가는 시간)은 내림 → 결과 화면과 같은 숫자
    const s = remaining >= 0 ? Math.ceil(remaining) : Math.floor(-remaining);
    const text = `${remaining < 0 ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (text === this.lastTimer) return;
    this.lastTimer = text;
    this.timerEl.textContent = remaining < 0 ? `지각 ${text}` : text;
    this.timerEl.classList.toggle('warn', remaining >= 0 && remaining <= 30);
    this.timerEl.classList.toggle('over', remaining < 0);
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

  showCountdown(text) {
    this.countdownEl.textContent = text || '';
  }

  showPause(on) {
    $('pause-menu').classList.toggle('hidden', !on);
  }

  // r: { grade, elapsed, remaining } 또는 null
  showResult(r) {
    const el = $('result');
    el.classList.toggle('hidden', !r);
    if (!r) return;
    const fmt = (s) => `${Math.floor(Math.abs(s) / 60)}분 ${String(Math.floor(Math.abs(s) % 60)).padStart(2, '0')}초`;
    const ok = r.remaining >= 0;
    el.querySelector('.res-title').textContent = ok ? '늦지 않았다!' : '지각…';
    const g = el.querySelector('.res-grade');
    g.textContent = r.grade;
    g.className = `res-grade ${ok ? 'good' : 'bad'}`;
    el.querySelector('.res-times').innerHTML = `걸린 시간 <b>${fmt(r.elapsed)}</b><br>`
      + (ok ? `남은 시간 <b>${fmt(r.remaining)}</b>` : `<b>${fmt(r.remaining)}</b> 늦음`);
  }

  setFps(fps) {
    this.fpsEl.classList.remove('hidden');
    this.fpsEl.textContent = `${fps} fps`;
  }
}
