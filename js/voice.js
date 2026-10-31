// Read-aloud voice in English and Spanish.
// 1. Fixed sentences (the tour, "report sent", ...) play natural recordings from audio/
//    (made with tools/make_voice.py).
// 2. Anything else, like the questions supervisors write, uses the phone's own voice,
//    picking its most natural one. If the phone has no voice for that language, we say so
//    instead of reading Spanish with an English voice.

const hasWindow = typeof window !== 'undefined';
const synth = hasWindow ? window.speechSynthesis : null;
const canSynth = !!(synth && typeof SpeechSynthesisUtterance !== 'undefined');
const canAudio = hasWindow && typeof Audio !== 'undefined';
export const voiceSupported = canSynth || canAudio;

// Symbols that sound odd when read out.
export const clean = text => String(text || '').replace(/[✓✗⚠📌⬆︎⋮↑↓▾👥🔊]/g, ' ').replace(/\s+/g, ' ').trim();

// Recordings are named by a short fingerprint of their exact words, so if a sentence is
// edited later its old recording is simply not used (the phone's voice reads it instead).
export function clipId(text, lang) {
  let h = 0x811c9dc5;
  for (const ch of `${lang}|${clean(text)}`) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

let clips = new Set();
if (canAudio && typeof fetch !== 'undefined') {
  fetch('audio/manifest.json').then(r => r.ok ? r.json() : []).then(ids => { clips = new Set(ids); }).catch(() => {});
}

// Some browsers load their list of voices a moment after the page opens.
let voices = [];
const loadVoices = () => { try { voices = synth.getVoices() || []; } catch { voices = []; } };
if (canSynth) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }

// Higher score = sounds more like a person.
const NATURAL = /natural|neural|premium|enhanced|siri|google|online|wavenet/i;
const ROBOTIC = /espeak|compact|eloquence|novelty|whisper|bad news|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|zarvox/i;
function pickVoice(lang) {
  const mine = voices.filter(v => (v.lang || '').toLowerCase().replace('_', '-').startsWith(lang));
  if (!mine.length) return null;
  const score = v => (NATURAL.test(v.name) ? 4 : 0) - (ROBOTIC.test(v.name) ? 5 : 0)
    + (/-(us|mx)$/i.test(v.lang.replace('_', '-')) ? 1 : 0) + (v.default ? 0.5 : 0);
  return [...mine].sort((a, b) => score(b) - score(a))[0];
}

let playing = null;

/** Reads text out loud. Returns false when this device has no voice for that language. */
export function speak(text, lang) {
  stopSpeaking();
  const id = clipId(text, lang);
  if (canAudio && clips.has(id)) {
    playing = new Audio(`audio/${id}.mp3`);
    playing.play().catch(() => {});
    return true;
  }
  if (!canSynth) return false;
  const v = pickVoice(lang);
  if (!v) return false;
  const u = new SpeechSynthesisUtterance(clean(text));
  u.voice = v;
  u.lang = v.lang;
  u.rate = 0.95;
  synth.speak(u);
  return true;
}

export function stopSpeaking() {
  if (playing) { try { playing.pause(); } catch { /* already stopped */ } playing = null; }
  if (canSynth) { try { synth.cancel(); } catch { /* nothing playing */ } }
}
