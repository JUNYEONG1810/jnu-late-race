// 소리는 모두 Web Audio로 직접 합성한다 (소리 파일 없음).
// 지금은 부스터·미션 완료·카운트다운 효과음. 꿍싯꿍싯 목소리는 다음 단계에서 여기에 추가.

let ctx = null;

// 브라우저는 사용자 입력 뒤에만 소리를 낼 수 있어서, 첫 키 입력 때 부른다
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

let noiseBuffer = null;
function noise(ac) {
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  return src;
}

// 부스터 시작 "부웅~": 낮게 시작해 솟았다가 내려오는 톱니파 + 바람 소리
export function playBoost() {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.value = 0.5;
  out.connect(ac.destination);

  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(55, t);
  osc.frequency.exponentialRampToValueAtTime(170, t + 0.25);
  osc.frequency.exponentialRampToValueAtTime(110, t + 1.1);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 6;
  lp.frequency.setValueAtTime(350, t);
  lp.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
  lp.frequency.exponentialRampToValueAtTime(600, t + 1.1);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.35, t + 0.06);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
  osc.connect(lp).connect(og).connect(out);
  osc.start(t);
  osc.stop(t + 1.2);

  const air = noise(ac);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(700, t);
  bp.frequency.exponentialRampToValueAtTime(3000, t + 0.3);
  bp.frequency.exponentialRampToValueAtTime(900, t + 1.0);
  const ag = ac.createGain();
  ag.gain.setValueAtTime(0.0001, t);
  ag.gain.exponentialRampToValueAtTime(0.25, t + 0.1);
  ag.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
  air.connect(bp).connect(ag).connect(out);
  air.start(t);
  air.stop(t + 1.1);
}

// 짧은 음 하나 (사인파 + 빠른 감쇠)
function tone(ac, freq, start, dur, vol = 0.3, type = 'sine') {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ac.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}

// 미션 완료 "딩동"
export function playDing() {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime;
  tone(ac, 1318.5, t, 0.5, 0.28);       // 딩 (E6)
  tone(ac, 1046.5, t + 0.16, 0.7, 0.28); // 동 (C6)
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
  base: 150,        // 부엉이 교수님 기본 음높이 (Hz, 조금 낮게)
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
// opts.emphasis: 낮고 길게 말할 단어, opts.big: 크고 길게 말할 부분
// 반환: { steps: [{ at: 시작 초, end: 이 소리까지 보일 글자 수 }], duration, stop() }
export function speak(text, { emphasis, big } = {}) {
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
    out.connect(ac.destination);
  }
  const t0 = ac ? ac.currentTime + 0.05 : 0;
  const steps = [];
  let at = 0;
  for (const u of syllables(text)) {
    let dur = u.dur, f = u.sound ? pitchOf(u.key) : 0, vol = VOICE.volume;
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
