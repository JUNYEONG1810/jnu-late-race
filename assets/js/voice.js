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
