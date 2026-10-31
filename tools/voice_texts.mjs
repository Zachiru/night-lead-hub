// Lists every fixed sentence the app reads out loud, in English and Spanish, as JSON.
// tools/make_voice.py records each one. Run both again after changing these texts:
//   node tools/voice_texts.mjs > tools/voice_texts.json && <kokoro python> tools/make_voice.py
import {STRINGS, translator} from '../js/i18n.js';
import {clean, clipId} from '../js/voice.js';

export function spokenTexts(lang) {
  const t = translator(lang);
  const out = [];
  for (const tour of ['tourLead', 'tourRod']) {
    for (const step of t(tour)) {
      if (step.text === 'HOME') {
        for (const k of ['homeIos', 'homeAndroid']) out.push(`${step.title}. ${t(k)}`);
      } else out.push(`${step.title}. ${step.text}`);
    }
  }
  for (const k of ['sentSpoken', 'fixErrors', 'voiceOnSample']) out.push(t(k));
  return [...new Set(out)];
}

const all = [];
for (const lang of Object.keys(STRINGS)) {
  for (const text of spokenTexts(lang)) all.push({id: clipId(text, lang), lang, text: clean(text)});
}
process.stdout.write(JSON.stringify(all, null, 1) + '\n');
