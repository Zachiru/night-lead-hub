import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';

const root = new URL('..', import.meta.url);

test('every tour step and message has a natural-voice recording (else run tools/make_voice.py)', () => {
  const items = JSON.parse(execFileSync(process.execPath, ['tools/voice_texts.mjs'], {cwd: root}).toString());
  const have = new Set(JSON.parse(readFileSync(new URL('audio/manifest.json', root), 'utf8')));
  const missing = items.filter(it => !have.has(it.id) || !existsSync(new URL(`audio/${it.id}.mp3`, root)));
  assert.deepEqual(missing.map(it => `${it.lang}: ${it.text.slice(0, 50)}`), []);
  assert.ok(items.some(it => it.lang === 'es') && items.some(it => it.lang === 'en'));
});
