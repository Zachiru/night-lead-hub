"""Records the app's fixed spoken sentences with Kokoro, a free open-source voice (Apache-2.0).

Needs: pip install kokoro-onnx soundfile lameenc, plus the two model files from
https://github.com/thewh1teagle/kokoro-onnx/releases (kokoro-v1.0.onnx, voices-v1.0.bin).

  node tools/voice_texts.mjs > tools/voice_texts.json
  python tools/make_voice.py --models <folder with the model files>

Writes audio/<id>.mp3 and audio/manifest.json. Only missing clips are recorded; old ones are removed.
"""
import argparse, json, re
from pathlib import Path

import lameenc
import numpy as np
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent
VOICES = {'en': ('af_heart', 'en-us'), 'es': ('ef_dora', 'es')}
SPEED = 0.95

# Words the Spanish voice would say the Spanish way; spell them how they sound.
SAY_ES = [(r'Night Lead Hub', 'Náit Lid Jab'), (r'\(ROD\)', ''), (r'\bApp\b', 'ap'), (r'\bapp\b', 'ap'),
          (r'Safari', 'Safári'), (r'Chrome', 'Crom'), (r'Android', 'Ándroid'), (r'iPhone', 'Ai fon'),
          (r'English / Español', 'inglés o español'), (r'\bN/A\b', 'no aplica')]
SAY_EN = [(r'\(ROD\)', ''), (r'English / Español', 'English or Spanish'), (r'Español', 'Espanyol')]


def say(text, lang):
    for pat, rep in (SAY_ES if lang == 'es' else SAY_EN):
        text = re.sub(pat, rep, text)
    return re.sub(r'[“”"]', '', text).strip()


def to_mp3(samples, rate):
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)
    return enc.encode(pcm) + enc.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--models', required=True)
    args = ap.parse_args()
    m = Path(args.models)
    kokoro = Kokoro(str(m / 'kokoro-v1.0.onnx'), str(m / 'voices-v1.0.bin'))
    items = json.loads((ROOT / 'tools' / 'voice_texts.json').read_text(encoding='utf-8'))
    out = ROOT / 'audio'
    out.mkdir(exist_ok=True)
    wanted = {it['id'] for it in items}
    for old in out.glob('*.mp3'):
        if old.stem not in wanted:
            old.unlink()
    for it in items:
        dest = out / f"{it['id']}.mp3"
        if dest.exists():
            continue
        voice, lang = VOICES[it['lang']]
        samples, rate = kokoro.create(say(it['text'], it['lang']), voice=voice, speed=SPEED, lang=lang)
        dest.write_bytes(to_mp3(samples, rate))
        print('recorded', it['lang'], it['id'], it['text'][:60])
    (out / 'manifest.json').write_text(json.dumps(sorted(wanted)) + '\n', encoding='utf-8')
    print(len(wanted), 'clips')


if __name__ == '__main__':
    main()
