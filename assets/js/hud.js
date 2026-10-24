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

  setFps(fps) {
    this.fpsEl.classList.remove('hidden');
    this.fpsEl.textContent = `${fps} fps`;
  }
}
