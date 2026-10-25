// 배경음악: 모두 Web Audio로 그 자리에서 합성한 이 게임만의 짧은 곡 (기존 곡을 흉내 내지 않음, 소리 파일 없음).
//  - free: 자유 주행 — 느긋한 장조 아르페지오 + 부드러운 화음 (BPM 92)
//  - late: 지각 모드 — 단조 베이스 반복 + 짧게 끊는 멜로디 + 하이햇 (BPM 138, 남은 시간 30초부터 빨라짐)
//  - 결과: 등급별 짧은 음악 (A+ 팡파르, A·B 밝게, C 어정쩡하게, F 내려가는 단조)
// 전체 음량(voice.js master)을 거치고, 배경음악만 따로 끌 수 있다 (localStorage 'bgmOff').
import { audioOut } from './voice.js';

export const MUSIC = { volume: 0.32 }; // 배경음악 음량 (전체 음량 안에서)

// 음 이름 → 주파수 (A4 = 440)
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

// 자유 주행: C장조 I–vi–IV–V 변형 (마디마다 [근음, 3음, 5음]), 아르페지오 무늬
const FREE = {
  bpm: 92,
  chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62], [60, 64, 67], [52, 55, 59], [53, 57, 60], [55, 59, 62]],
  arp: [0, 1, 2, 1, 2, 3, 2, 1], // 3 = 근음 한 옥타브 위
  melody: [72, null, 76, 74, 72, null, 69, null, 71, 72, null, 74, 76, null, 74, null], // 두 마디에 한 번 나오는 짧은 노래 (8분음표)
};
// 지각 모드: A단조 i–VI–III–VII
const LATE = {
  bpm: 138,
  bass: [[45, 45, 57, 45, 45, 57, 45, 52], [41, 41, 53, 41, 41, 53, 41, 48], [48, 48, 60, 48, 48, 60, 48, 55], [43, 43, 55, 43, 43, 55, 43, 50]],
  lead: [[69, null, 72, 69, 76, null, 74, 72], [72, null, 69, 65, 67, null, 69, null], [72, 74, 76, null, 79, 76, 74, 72], [71, null, 67, 71, 74, null, 71, null]],
};
// 결과 음악 (BPM, [음, 길이(박)] 목록)
const RESULT = {
  'A+': { bpm: 150, notes: [[72, 0.5], [76, 0.5], [79, 0.5], [84, 1.5], [79, 0.5], [84, 2]], wave: 'square' },
  A: { bpm: 140, notes: [[72, 0.5], [76, 0.5], [79, 1], [77, 0.5], [79, 1.5]], wave: 'triangle' },
  'B+': { bpm: 130, notes: [[67, 0.5], [72, 0.5], [76, 1], [74, 1.5]], wave: 'triangle' },
  B: { bpm: 120, notes: [[67, 0.5], [71, 0.5], [74, 1], [72, 1.5]], wave: 'triangle' },
  C: { bpm: 110, notes: [[67, 0.5], [66, 0.5], [67, 1], [62, 1.5]], wave: 'triangle' },
  F: { bpm: 84, notes: [[64, 1], [63, 1], [62, 1], [57, 2.5]], wave: 'sawtooth' },
};

let off = false;
try { off = localStorage.getItem('bgmOff') === '1'; } catch {}

export class Music {
  constructor() {
    this.mode = null;   // 'free' | 'late' | null
    this.out = null;
    this.next = 0;      // 다음 박 시각 (오디오 시계)
    this.step = 0;      // 8분음표 칸 번호
    this.rush = 0;      // 0~1: 지각 모드 마지막 30초 빨라짐
    this.timer = setInterval(() => this.schedule(), 90);
  }

  get off() { return off; }
  setOff(v) {
    off = v;
    try { localStorage.setItem('bgmOff', v ? '1' : '0'); } catch {}
    if (this.out) this.out.gain.setTargetAtTime(v ? 0 : MUSIC.volume, this.out.context.currentTime, 0.1);
  }

  ensureOut() {
    const a = audioOut();
    if (!a) return null;
    if (!this.out) {
      this.out = a.ctx.createGain();
      this.out.gain.value = off ? 0 : MUSIC.volume;
      this.out.connect(a.master);
    }
    return a.ctx;
  }

  // 곡 바꾸기 (같은 곡이면 그대로). 바뀌면 다음 마디 처음부터
  play(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.step = 0;
    const ac = this.ensureOut();
    if (ac) this.next = ac.currentTime + 0.1;
  }

  // 결과 음악: 지금 곡을 멈추고 한 번
  result(grade) {
    this.mode = null;
    const ac = this.ensureOut();
    if (!ac || off) return;
    const R = RESULT[grade] || RESULT.C;
    let t = ac.currentTime + 0.15;
    const beat = 60 / R.bpm;
    for (const [n, len] of R.notes) {
      this.tone(ac, NOTE(n), t, len * beat * 0.92, 0.22, R.wave);
      if (grade === 'A+') this.tone(ac, NOTE(n - 12), t, len * beat * 0.9, 0.1, 'triangle');
      t += len * beat;
    }
  }

  schedule() {
    if (!this.mode) return;
    const ac = this.ensureOut();
    if (!ac || ac.state !== 'running') return;
    if (this.next < ac.currentTime) this.next = ac.currentTime + 0.05;
    const song = this.mode === 'late' ? LATE : FREE;
    const bpm = song.bpm * (1 + 0.22 * this.rush);
    const eighth = 30 / bpm;
    while (this.next < ac.currentTime + 0.35) {
      if (this.mode === 'late') this.lateStep(ac, this.next, eighth);
      else this.freeStep(ac, this.next, eighth);
      this.next += eighth;
      this.step++;
    }
  }

  freeStep(ac, t, e) {
    const bar = Math.floor(this.step / 8) % FREE.chords.length, k = this.step % 8;
    const ch = FREE.chords[bar];
    const a = FREE.arp[k];
    const n = a === 3 ? ch[0] + 12 : ch[a];
    this.tone(ac, NOTE(n), t, e * 1.6, 0.11, 'triangle');
    if (k === 0) { // 마디 처음: 낮은 화음 (부드럽게 길게)
      for (const c of ch) this.tone(ac, NOTE(c - 12), t, e * 7.5, 0.045, 'sine', 0.25);
      this.tone(ac, NOTE(ch[0] - 24), t, e * 3.5, 0.12, 'sine');
    }
    const m = FREE.melody[this.step % FREE.melody.length];
    if (Math.floor(this.step / 16) % 2 === 1 && m) this.tone(ac, NOTE(m), t, e * 1.7, 0.08, 'sine', 0.02);
  }

  lateStep(ac, t, e) {
    const bar = Math.floor(this.step / 8) % 4, k = this.step % 8;
    this.tone(ac, NOTE(LATE.bass[bar][k]), t, e * 0.8, 0.16, 'sawtooth', 0.005, 700);
    const n = LATE.lead[bar][k];
    if (n && Math.floor(this.step / 32) % 2 === 1) this.tone(ac, NOTE(n), t, e * 0.6, 0.07, 'square', 0.005, 2400);
    this.hat(ac, t, k % 2 ? 0.035 : 0.06);
    if (k === 0 || k === 4) this.kick(ac, t);
  }

  // 음 하나: 빠른 어택, 지수 감쇠. lp가 있으면 저역 필터
  tone(ac, f, t, len, vol, type, attack = 0.01, lp = 0) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    if (lp) {
      const fl = ac.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = lp;
      o.connect(fl).connect(g);
    } else o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  hat(ac, t, vol) {
    if (!this.noise) {
      this.noise = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ac.createBufferSource();
    s.buffer = this.noise;
    const f = ac.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f).connect(g).connect(this.out);
    s.start(t);
    s.stop(t + 0.06);
  }

  kick(ac, t) {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.18);
  }
}
