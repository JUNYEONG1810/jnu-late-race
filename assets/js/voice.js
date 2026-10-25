// 소리는 모두 Web Audio로 직접 합성한다 (소리 파일 없음).
// 굴착기 엔진·궤도·충돌, 부스터, 미션·카운트다운 효과음, 그리고 꿍싯꿍싯 목소리.
// 모든 소리는 master(전체 음량·음소거) 하나를 거쳐 나간다.

export const SOUND = { volume: 0.8 }; // 전체 음량 (0~1)

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('muted') === '1'; } catch {}

// 브라우저는 사용자 입력 뒤에만 소리를 낼 수 있어서, 첫 키 입력·클릭 때 부른다
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : SOUND.volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function isMuted() { return muted; }

// 배경음악(music.js)도 같은 전체 음량(master)을 거치게: 오디오가 시작됐으면 { ctx, master }
export function audioOut() { return ctx && master ? { ctx, master } : null; }

export function setMuted(on) {
  muted = on;
  try { localStorage.setItem('muted', on ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(on ? 0 : SOUND.volume, ctx.currentTime, 0.02);
}

let noiseBuffer = null;
function noise(ac, loop = false) {
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = loop;
  return src;
}

// 음량 봉투: 0 → peak(attack 초) → 0(끝 초)
function env(ac, t, peak, attack, end) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + end);
  g.connect(master);
  return g;
}

function filter(ac, type, freq, q = 1) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

// 짧은 음 하나 (빠른 감쇠)
function tone(ac, freq, start, dur, vol = 0.3, type = 'sine') {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.connect(env(ac, start, vol, 0.01, dur));
  o.start(start);
  o.stop(start + dur + 0.05);
}

// 잡음 한 번 (필터를 거쳐서)
function burst(ac, t, dur, vol, type, freq, q = 1) {
  const n = noise(ac);
  const f = filter(ac, type, freq, q);
  n.connect(f).connect(env(ac, t, vol, 0.005, dur));
  n.start(t);
  n.stop(t + dur + 0.05);
  return f;
}

// ---------- 굴착기 엔진 (계속 나는 소리) ----------
// 엔진 몸통: 낮은 톱니파를 저역 필터로 둥글게 → 사각파 LFO로 음량을 떨게 해서 "두두두두".
// 디젤 느낌을 내려고 같은 박동에 낮은 잡음을 섞는다. 속도에 따라 음높이·박동·필터가 함께 오른다.
// 궤도 "철컥": 속도에 비례하는 간격으로 짧은 금속성 잡음을 작게.
// 부스터 중 바람: 고역 잡음을 부스터 세기 × 속도만큼.
export class EngineSound {
  constructor() {
    this.nodes = null;
    this.trackT = 0;
    this.kick = 0;
    this.prevThrottle = false;
  }

  init(ac) {
    const t = ac.currentTime;
    const out = ac.createGain();
    out.gain.value = 0;
    out.connect(master);
    const pulse = ac.createGain(); // 박동으로 떨리는 음량
    pulse.gain.value = 0.55;
    pulse.connect(out);

    const body = ac.createOscillator();
    body.type = 'sawtooth';
    body.frequency.value = 36;
    const lp = filter(ac, 'lowpass', 220, 1.2);
    body.connect(lp).connect(pulse);

    const rumble = noise(ac, true);
    const rumbleGain = ac.createGain();
    rumbleGain.gain.value = 0.35;
    rumble.connect(filter(ac, 'bandpass', 180, 0.8)).connect(rumbleGain).connect(pulse);

    const lfo = ac.createOscillator(); // "두두두두" 박동
    lfo.type = 'square';
    lfo.frequency.value = 11;
    const lfoDepth = ac.createGain();
    lfoDepth.gain.value = 0.45;
    lfo.connect(lfoDepth).connect(pulse.gain);

    const wind = noise(ac, true);
    const windGain = ac.createGain();
    windGain.gain.value = 0;
    wind.connect(filter(ac, 'highpass', 600)).connect(filter(ac, 'bandpass', 1500, 0.4)).connect(windGain).connect(master);

    for (const s of [body, rumble, lfo, wind]) s.start(t);
    this.nodes = { out, body, lp, lfo, windGain };
  }

  // speed: m/s, throttle: 가속 중, boostFx: 부스터 효과 세기 0~1, active: 엔진 소리를 낼지,
  // quiet: 학생이 내려서 걷는 동안 시동만 걸린 채 작게
  update(dt, { speed, throttle, boostFx, active, quiet = false }) {
    if (!ctx || ctx.state !== 'running') return;
    if (!this.nodes) this.init(ctx);
    const n = this.nodes, t = ctx.currentTime;
    const s01 = Math.min(1, speed / (60 / 3.6));
    if (throttle && !this.prevThrottle) this.kick = 1; // 페달을 밟는 순간 살짝 커짐
    this.prevThrottle = throttle;
    this.kick = Math.max(0, this.kick - dt * 3);
    const vol = active ? (0.16 + 0.1 * s01 + 0.1 * this.kick + 0.05 * boostFx) * (quiet ? 0.35 : 1) : 0;
    n.out.gain.setTargetAtTime(vol, t, 0.08);
    n.body.frequency.setTargetAtTime(34 + 38 * s01 + 22 * boostFx, t, 0.1); // 부스터 때 한 단계 높게
    n.lfo.frequency.setTargetAtTime(10 + 20 * s01 + 8 * boostFx, t, 0.1);
    n.lp.frequency.setTargetAtTime(200 + 450 * s01 + 600 * boostFx, t, 0.1);
    n.windGain.gain.setTargetAtTime(active ? 0.35 * boostFx * Math.min(1, speed / 25) : 0, t, 0.1);

    // 궤도 "철컥철컥": 엔진 아래에 작게
    if (!active) return;
    this.trackT += dt * Math.min(14, speed * 0.75);
    while (this.trackT >= 1) {
      this.trackT -= 1;
      burst(ctx, t, 0.035, 0.05, 'bandpass', 1700 + Math.random() * 400, 3);
      tone(ctx, 620 + Math.random() * 80, t, 0.025, 0.015, 'square');
    }
  }
}

// 충돌 "쿵" + 금속 덜컹 (strength: 0~1)
export function playHit(strength = 1) {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime, k = 0.3 + 0.7 * strength;
  const thud = ac.createOscillator(); // 낮은 쿵
  thud.frequency.setValueAtTime(80, t);
  thud.frequency.exponentialRampToValueAtTime(36, t + 0.3);
  thud.connect(env(ac, t, 0.55 * k, 0.005, 0.35));
  thud.start(t);
  thud.stop(t + 0.4);
  burst(ac, t, 0.18, 0.35 * k, 'lowpass', 500);
  // 금속 덜컹: 배음이 안 맞는 두 사각파를 대역 필터로
  for (const [f, d] of [[310, 0.22], [457, 0.16]]) {
    const o = ac.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(filter(ac, 'bandpass', f * 2, 4)).connect(env(ac, t + 0.02, 0.12 * k, 0.003, d));
    o.start(t + 0.02);
    o.stop(t + d + 0.1);
  }
}

// 부스터 시작: 터보가 차오르는 "쉬이익↗"(0.3초) → "콰앙" 점화(낮은 쿵 + 짧은 폭발 잡음)
export function playBoost() {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime;
  const spool = burst(ac, t, 0.32, 0.22, 'bandpass', 800, 2.5);
  spool.frequency.exponentialRampToValueAtTime(4200, t + 0.3);
  const whine = ac.createOscillator();
  whine.frequency.setValueAtTime(700, t);
  whine.frequency.exponentialRampToValueAtTime(2600, t + 0.3);
  whine.connect(env(ac, t, 0.06, 0.25, 0.33));
  whine.start(t);
  whine.stop(t + 0.35);
  const ig = t + 0.3; // 점화
  const boom = ac.createOscillator();
  boom.frequency.setValueAtTime(95, ig);
  boom.frequency.exponentialRampToValueAtTime(32, ig + 0.45);
  boom.connect(env(ac, ig, 0.6, 0.005, 0.5));
  boom.start(ig);
  boom.stop(ig + 0.55);
  burst(ac, ig, 0.3, 0.45, 'lowpass', 1500);
}

// 부스터 끝: 압력이 빠지는 "피슈~"
export function playBoostEnd() {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime;
  const f = burst(ac, t, 0.7, 0.25, 'bandpass', 3500, 1.5);
  f.frequency.exponentialRampToValueAtTime(500, t + 0.7);
}

// 미션 진행 막대 동안 음이 점점 올라가는 "뚜루루루↗"
export function playMissionRise(duration = 2) {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime, step = 0.075, n = Math.floor(duration / step);
  for (let i = 0; i < n; i++) tone(ac, 420 * Math.pow(3, i / n), t + i * step, 0.06, 0.1, 'triangle');
}

// 부스터 게이지 충전 "슈웅↑"
export function playCharge() {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.frequency.setValueAtTime(350, t);
  o.frequency.exponentialRampToValueAtTime(1600, t + 0.35);
  o.connect(env(ac, t, 0.15, 0.03, 0.4));
  o.start(t);
  o.stop(t + 0.45);
  burst(ac, t, 0.35, 0.12, 'bandpass', 1200, 1.5).frequency.exponentialRampToValueAtTime(5000, t + 0.35);
}

// 미션 완료 "딩동"
export function playDing() {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime;
  tone(ac, 1318.5, t, 0.5, 0.28);       // 딩 (E6)
  tone(ac, 1046.5, t + 0.16, 0.7, 0.28); // 동 (C6)
}

// 남은 시간 경고음: 짧고 높은 "삑" (마지막 10초, 1초마다)
export function playWarn() {
  const ac = unlockAudio();
  if (!ac) return;
  tone(ac, 1046.5, ac.currentTime, 0.09, 0.16, 'square');
}

// 학생 발소리: 작고 귀여운 "톡" (달리면 조금 높고 또렷하게)
export function playStep(run = false) {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime, f = (run ? 560 : 470) * (0.92 + Math.random() * 0.16);
  const o = ac.createOscillator();
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.05);
  o.connect(env(ac, t, run ? 0.07 : 0.05, 0.004, 0.06));
  o.start(t);
  o.stop(t + 0.08);
  burst(ac, t, 0.03, run ? 0.03 : 0.02, 'lowpass', 1200);
}

// 학생 "음메~": 코로 내는 짧은 "음"(낮은 허밍) → 떨리며 올라갔다 내려오는 "메~"(톱니파 + 모음 'ㅔ' 필터 두 개)
export function playMoo() {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime;
  const hum = ac.createOscillator(); // 음
  hum.type = 'triangle';
  hum.frequency.setValueAtTime(300, t);
  hum.frequency.linearRampToValueAtTime(340, t + 0.15);
  hum.connect(filter(ac, 'lowpass', 900)).connect(env(ac, t, 0.22, 0.02, 0.2));
  hum.start(t);
  hum.stop(t + 0.22);
  const m = t + 0.16, len = 0.55; // 메~
  const o = ac.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(390, m);
  o.frequency.linearRampToValueAtTime(450, m + 0.18);
  o.frequency.linearRampToValueAtTime(360, m + len);
  const vib = ac.createOscillator(); // 떨림
  vib.frequency.value = 7.5;
  const vibDepth = ac.createGain();
  vibDepth.gain.value = 14;
  vib.connect(vibDepth).connect(o.frequency);
  const out = env(ac, m, 0.2, 0.04, len);
  for (const [f, q, v] of [[560, 4, 1], [1900, 6, 0.6]]) {
    const g = ac.createGain();
    g.gain.value = v;
    o.connect(filter(ac, 'bandpass', f, q)).connect(g).connect(out);
  }
  for (const s of [o, vib]) { s.start(m); s.stop(m + len + 0.05); }
}

// 학생이 달리다 벽에 꽈당: 통통한 "뽀옹" (아래로 미끄러지는 사인파 + 작은 잡음)
export function playBonk() {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.frequency.setValueAtTime(520, t);
  o.frequency.exponentialRampToValueAtTime(140, t + 0.25);
  o.connect(env(ac, t, 0.28, 0.005, 0.3));
  o.start(t);
  o.stop(t + 0.32);
  burst(ac, t, 0.06, 0.12, 'lowpass', 700);
}

// 카운트다운 삐 (go면 높고 길게)
export function playBeep(go = false) {
  const ac = unlockAudio();
  if (!ac) return;
  tone(ac, go ? 1320 : 660, ac.currentTime, go ? 0.6 : 0.18, 0.22, 'square');
}

// ---------- 꿍싯꿍싯 목소리 ----------
// 한글 음절(영문은 2~3글자 묶음)마다 짧은 합성음. 같은 음절은 같은 높이,
// 모음에 따라 음색(필터 중심 주파수)이 바뀌고, 띄어쓰기·문장부호에서 쉰다.

export const VOICE = {
  base: 150,        // 교수님 기본 음높이 (Hz, 조금 낮게)
  syllable: 0.065,  // 한 음절 길이 (s)
  latin: 0.075,     // 영문 묶음 하나 길이
  space: 0.06,
  punct: 0.16,
  volume: 0.22,
};

// 한글 중성 21개 순서 (ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ) → 음색 필터 주파수
const VOWEL_HZ = [900, 1500, 1000, 1500, 700, 1400, 800, 1400, 500, 800, 1300, 1300, 550, 350, 700, 1300, 1500, 400, 420, 1600, 1900];
const LATIN_VOWEL_HZ = { a: 900, e: 1500, i: 1900, o: 500, u: 350, y: 1600 };

// 대사를 소리 단위로 나눈다: [{ start, end, dur, key, formant, sound }]
function syllables(text) {
  const units = [];
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const vowel = Math.floor(((code - 0xac00) % 588) / 28);
      units.push({ start: i, end: i + 1, dur: VOICE.syllable, key: ch, formant: VOWEL_HZ[vowel], sound: true });
      i++;
    } else if (/[A-Za-z0-9]/.test(ch)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9]/.test(text[j])) j++;
      // 영문 단어는 2~3글자씩 묶기 (Serious → Ser / io / us)
      for (let k = i; k < j;) {
        const left = j - k;
        const n = left >= 5 ? 3 : left === 4 ? 2 : left;
        const chunk = text.slice(k, k + n).toLowerCase();
        const v = [...chunk].find((c) => LATIN_VOWEL_HZ[c]);
        units.push({ start: k, end: k + n, dur: VOICE.latin, key: chunk, formant: LATIN_VOWEL_HZ[v] || 1000, sound: true });
        k += n;
      }
      i = j;
    } else {
      const dur = ch === ' ' ? VOICE.space : ch === '…' ? VOICE.punct * 1.6 : /[.,!?~]/.test(ch) ? VOICE.punct : 0;
      units.push({ start: i, end: i + 1, dur, sound: false });
      i++;
    }
  }
  return units;
}

function pitchOf(key) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return VOICE.base * Math.pow(2, ((h % 8) - 2) / 12); // 같은 음절 → 같은 높이 (-2 ~ +5 반음)
}

function blip(ac, out, t, freq, formant, len, vol) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(vol * 0.6, t + len * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(out);

  const body = ac.createOscillator(); // 몸통 소리
  body.type = 'triangle';
  body.frequency.setValueAtTime(freq * 1.06, t);
  body.frequency.exponentialRampToValueAtTime(freq * 0.94, t + len);
  body.connect(g);

  const buzz = ac.createOscillator(); // 모음 음색
  buzz.type = 'square';
  buzz.frequency.setValueAtTime(freq, t);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = formant;
  bp.Q.value = 3;
  const bg = ac.createGain();
  bg.gain.value = 0.35;
  buzz.connect(bp).connect(bg).connect(g);

  for (const o of [body, buzz]) { o.start(t); o.stop(t + len + 0.02); }
}

// 대사를 말한다. 소리를 예약하고, 말풍선 타자 효과용 시간표를 돌려준다.
// opts.emphasis: 낮고 길게 말할 단어, opts.big: 크고 길게 말할 부분, opts.pitch: 음높이 배수(학생은 높게)
// 반환: { steps: [{ at: 시작 초, end: 이 소리까지 보일 글자 수 }], duration, stop() }
export function speak(text, { emphasis, big, pitch = 1 } = {}) {
  const inRange = (word, u) => {
    if (!word) return false;
    for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
      if (u.start >= i && u.start < i + word.length) return true;
    }
    return false;
  };
  const ac = unlockAudio();
  let out = null;
  if (ac) {
    out = ac.createGain();
    out.gain.value = 1;
    out.connect(master);
  }
  const t0 = ac ? ac.currentTime + 0.05 : 0;
  const steps = [];
  let at = 0;
  for (const u of syllables(text)) {
    let dur = u.dur, f = u.sound ? pitchOf(u.key) * pitch : 0, vol = VOICE.volume;
    if (inRange(emphasis, u)) { dur *= 1.9; f *= 0.78; vol *= 1.1; } // "Serious"는 낮고 길게
    if (inRange(big, u)) { dur *= 1.7; f *= 0.9; vol *= 1.6; }       // "F다."는 크고 길게
    if (ac && u.sound) blip(ac, out, t0 + at, f, u.formant, dur * 0.85, vol);
    steps.push({ at, end: u.end });
    at += dur;
  }
  // 건너뛸 때 남은 소리를 끊는다
  const stop = () => { if (out) out.gain.setTargetAtTime(0, ac.currentTime, 0.01); };
  return { steps, duration: at, stop };
}
