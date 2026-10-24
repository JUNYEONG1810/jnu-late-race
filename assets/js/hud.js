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

  setFps(fps) {
    this.fpsEl.classList.remove('hidden');
    this.fpsEl.textContent = `${fps} fps`;
  }
}
