"""
Suara's local server (vault plan-suara-0018, obs-0054, obs-0071): hearing and speaking on this PC.

    python local-asr/setup.py            once: llama.cpp (Vulkan) and the models, into local-asr/runtime
    python local-asr/server.py           then: starts both on the GPU and listens on :8791

    GET  /health                         {"ready": true, "model": "...", "device": "Vulkan0", "voice": "serena"}
    POST /transcribe?language=en|zh      body: the recording, any format the browser makes
                                         {"text": "...", "language": "English", "ms": 223}
    POST /speak                          {"text": "...", "language": "en" | "zh-Hans", "voice": "serena"}
                                         audio/mpeg; 503 when the voice is off

Hearing: native Qwen3-ASR 1.7B (Qwen, Apache-2.0) through llama.cpp's Vulkan build. On the 38
test clips it made 12.3% word errors at a median 0.22 s a clip, the best of every engine tested.
`--model polyglot-lion-1.7b` runs its Singapore fine-tune instead (14.5%).

Voice: Qwen3-TTS 1.7B CustomVoice (Qwen, Apache-2.0) through Qwen3-TTS-GGUF (HaujetZhao, MIT). Its
model runs on the GPU through llama.cpp; its audio decoder runs on the CPU, because it fails on
DirectML here. About 0.45 s per second of speech.

The GPU is reached through llama.cpp: PyTorch has no GPU build for this PC's Radeon RX 6800 on
Windows, and vLLM needs CUDA or Linux.

Nothing is stored: recordings and spoken lines are handled in memory and dropped. No request log
is written, because a read-back carries the person's own question.
"""
import argparse, atexit, base64, hashlib, json, logging, os, re, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
RUNTIME = HERE / 'runtime'
TTS = RUNTIME / 'qwen3-tts-gguf'
# The nine presets; the owner picks by ear (design/local-voice).
VOICES = ['serena', 'vivian', 'uncle_fu', 'ryan', 'aiden', 'dylan', 'eric', 'ono_anna', 'sohee']

parser = argparse.ArgumentParser()
parser.add_argument('--model', default=os.environ.get('LOCAL_ASR_MODEL', 'qwen3-asr-1.7b'), help='a name from setup.py, e.g. polyglot-lion-1.7b')
parser.add_argument('--device', default=os.environ.get('LOCAL_ASR_DEVICE', 'Vulkan0'), help='a llama.cpp device, e.g. Vulkan0; "none" for the CPU')
parser.add_argument('--voice', choices=[*VOICES, 'none'], default=os.environ.get('LOCAL_VOICE', 'serena'), help='when a request names none; the app names one (SUARA_LOCAL_VOICE). "none" for hearing only')
parser.add_argument('--port', type=int, default=int(os.environ.get('LOCAL_ASR_PORT', '8791')))
parser.add_argument('--llama-port', type=int, default=8792)
args = parser.parse_args()

import imageio_ffmpeg  # noqa: E402

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
MODEL = RUNTIME / 'models' / f'{args.model}-Q8_0.gguf'
MMPROJ = RUNTIME / 'models' / f'mmproj-{args.model}-Q8_0.gguf'
LLAMA = RUNTIME / 'llama.cpp' / 'llama-server.exe'
LLAMA_URL = f'http://127.0.0.1:{args.llama_port}'
LANGUAGE = {'en': 'English', 'zh': 'Chinese'}
MAX_BYTES = 10 * 1024 * 1024

for need in (LLAMA, MODEL, MMPROJ):
    if not need.exists():
        sys.exit(f'missing {need}: run python local-asr/setup.py --model {args.model} first')

# llama.cpp on the GPU, all layers offloaded; it lives and dies with this server.
llama = subprocess.Popen(
    [str(LLAMA), '-m', str(MODEL), '--mmproj', str(MMPROJ), '--device', args.device, '-ngl', '99',
     '--host', '127.0.0.1', '--port', str(args.llama_port), '--temp', '0', '-c', '4096', '--no-webui'],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
atexit.register(llama.terminate)
t0 = time.time()
while True:
    try:
        if json.load(urllib.request.urlopen(f'{LLAMA_URL}/health', timeout=2)).get('status') == 'ok':
            break
    except (urllib.error.URLError, ConnectionError, TimeoutError, json.JSONDecodeError):
        pass
    if llama.poll() is not None:
        sys.exit(f'llama.cpp stopped (code {llama.returncode}); try --device none for the CPU')
    if time.time() - t0 > 120:
        sys.exit('llama.cpp did not start within 2 minutes')
    time.sleep(0.5)
print(f'{MODEL.name} ready on {args.device} in {time.time() - t0:.0f}s', flush=True)


def to_wav(data: bytes) -> bytes:
    """Any browser recording to 16 kHz mono WAV, in memory."""
    done = subprocess.run([FFMPEG, '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'], input=data, capture_output=True, timeout=30)
    if done.returncode != 0 or not done.stdout:
        raise ValueError('not audio')
    return done.stdout


def transcribe(wav: bytes, hint: str | None) -> tuple[str, str]:
    messages = [{'role': 'user', 'content': [{'type': 'input_audio', 'input_audio': {'data': base64.b64encode(wav).decode(), 'format': 'wav'}}]}]
    # Qwen3-ASR takes the language as the start of its own answer, not as an instruction.
    if hint in LANGUAGE:
        messages.append({'role': 'assistant', 'content': f'language {LANGUAGE[hint]}<asr_text>'})
    body = json.dumps({'messages': messages, 'temperature': 0, 'max_tokens': 256}).encode()
    req = urllib.request.Request(f'{LLAMA_URL}/v1/chat/completions', data=body, headers={'content-type': 'application/json'})
    content = json.load(urllib.request.urlopen(req, timeout=60))['choices'][0]['message']['content']
    head, _, text = content.rpartition('<asr_text>')
    return text.strip(), head.replace('language', '').strip()


class Voice:
    """Qwen3-TTS, one line at a time: the engine holds one model context, so calls queue."""

    MODEL = 'qwen3-tts-1.7b'  # LocalVoice.model in src/lib/routes/voice.ts
    KEPT = RUNTIME / 'voice-cache'

    @classmethod
    def kept(cls, text: str, name: str) -> Path:
        """Where a fixed line is kept: the app's speechKey (src/lib/voice-cache.ts), so a file is
        found by the same words, voice and model whichever side made it."""
        normalised = re.sub(r'\s+', ' ', text).strip()
        return cls.KEPT / f"{hashlib.sha256(f'{cls.MODEL}|{name}|{normalised}'.encode()).digest()[:16].hex()}.mp3"

    SPOKEN = {'en': 'english', 'zh-Hans': 'chinese'}
    # The brief the OpenAI voice gets (src/lib/routes/voice.ts). In Mandarin, 缓慢 ("slow") more than
    # doubled the length of a line (21.9 s against 9.7 s); 语速稍慢 ("a little slower") does not.
    INSTRUCT = {
        'en': 'Speak slowly, warmly and clearly to an older listener. Pause briefly between sentences.',
        'zh-Hans': '用温暖、清楚的语气，语速稍慢，对一位年长的听众说话。',
    }

    def __init__(self, name: str):
        # Claim the package's logger first: it otherwise opens a log file of everything it does.
        quiet = logging.getLogger('qwen3_tts_gguf')
        quiet.addHandler(logging.NullHandler())
        quiet.propagate = False
        sys.path.insert(0, str(TTS))
        from qwen3_tts_gguf.inference import TTSConfig, TTSEngine
        self.name = name
        self.engine = TTSEngine(model_dir=str(TTS / 'model-custom'), onnx_provider='CPU', llm_use_gpu=True, subprocess_decoder=False, verbose=False)
        self.stream = self.engine.create_stream(n_ctx=3072)
        if self.stream is None:
            raise RuntimeError('the voice model did not load')
        # A fixed seed: the same line always comes out the same, so a cached copy matches a fresh one.
        self.config = TTSConfig(max_steps=1200, temperature=0.6, sub_temperature=0.6, seed=42, sub_seed=45, streaming=False)
        self.lock = threading.Lock()
        atexit.register(self.engine.shutdown)

    # Phone numbers read as figures come out wrong: "1800-650-6060" became "one eight o o six five
    # ve…" in English and 一千八百… in Mandarin. Spelled digit by digit, as people read them, both
    # come out right. Seven digits or more, in groups split by spaces or hyphens; not touching a
    # Latin letter (an NRIC like S1234567A) or part of an amount or decimal.
    PHONE = re.compile(r'(?<![A-Za-z\d.,])\+?\d(?:[ -]?\d){6,}(?![\d.,]*\d)(?![A-Za-z])')
    DIGITS = {'en': 'zero one two three four five six seven eight nine'.split(), 'zh-Hans': list('零一二三四五六七八九')}

    @classmethod
    def say_numbers(cls, text: str, language: str) -> str:
        names, comma, gap = cls.DIGITS[language], ('，' if language == 'zh-Hans' else ', '), ('' if language == 'zh-Hans' else ' ')

        def spell(m: re.Match) -> str:
            raw = m.group(0)
            groups = [g for g in re.split(r'[ -]', raw.lstrip('+')) if g]
            if len(groups) == 1:  # 63367777: read in fours
                groups = [groups[0][i:i + 4] for i in range(0, len(groups[0]), 4)]
            spoken = comma.join(gap.join(names[int(d)] for d in g) for g in groups)
            return ('加' if language == 'zh-Hans' else 'plus ') + spoken if raw.startswith('+') else spoken

        return cls.PHONE.sub(spell, text)

    def speak(self, text: str, language: str, name: str | None = None) -> bytes:
        text = self.say_numbers(text, language)
        with self.lock:
            result = self.stream.custom(text=text, speaker=name or self.name, language=self.SPOKEN[language], instruct=self.INSTRUCT[language], config=self.config)
        if result is None or result.audio is None or len(result.audio) == 0:
            raise RuntimeError('no audio')
        pcm = result.audio.astype('float32').tobytes()
        done = subprocess.run([FFMPEG, '-loglevel', 'error', '-f', 'f32le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0', '-b:a', '64k', '-f', 'mp3', 'pipe:1'], input=pcm, capture_output=True, timeout=30)
        if done.returncode != 0:
            raise RuntimeError('mp3 encoding failed')
        return done.stdout


voice = None
if args.voice != 'none':
    if (TTS / 'model-custom' / 'qwen3_tts_talker.q5_k.gguf').exists():
        t1 = time.time()
        voice = Voice(args.voice)
        voice.speak('Hello.', 'en')  # builds the GPU kernels now, not on someone's question
        print(f'voice {args.voice} ready in {time.time() - t1:.0f}s', flush=True)
    else:
        print('voice off: run python local-asr/setup.py to add it', flush=True)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if urlparse(self.path).path == '/health':
            return self.reply(200, {'ready': llama.poll() is None, 'model': MODEL.name, 'device': args.device, 'voice': voice.name if voice else None})
        self.reply(404, {'error': 'not found'})

    def do_POST(self) -> None:
        url = urlparse(self.path)
        size = int(self.headers.get('content-length') or 0)
        if url.path == '/speak':
            return self.speak(size)
        if url.path != '/transcribe':
            return self.reply(404, {'error': 'not found'})
        if size <= 0 or size > MAX_BYTES:
            return self.reply(400, {'error': 'send the recording as the request body, under 10 MB'})
        hint = parse_qs(url.query).get('language', [None])[0]
        try:
            wav = to_wav(self.rfile.read(size))
            started = time.time()
            text, language = transcribe(wav, hint)
            self.reply(200, {'text': text, 'language': language, 'ms': int((time.time() - started) * 1000)})
        except ValueError:
            self.reply(400, {'error': 'that is not audio ffmpeg can read'})
        except Exception as err:  # the route falls over to the next one; the reason goes to this console only
            print('transcribe failed:', str(err)[:200], flush=True)
            self.reply(500, {'error': 'transcription failed'})

    def speak(self, size: int) -> None:
        if voice is None:
            return self.reply(503, {'error': 'the voice is off'})
        try:
            req = json.loads(self.rfile.read(size) if 0 < size <= 64 * 1024 else b'')
            text, language, name = str(req['text']).strip(), req.get('language', 'en'), req.get('voice') or voice.name
            if not text or len(text) > 1000 or language not in Voice.SPOKEN or name not in VOICES:
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self.reply(400, {'error': 'send {"text": "...", "language": "en" | "zh-Hans", "voice": "serena"}, text under 1000 characters'})
        # Card and step lines are kept on disk when scripts/kb/build-audio.ts --local asks ("keep");
        # nothing else is, because a read-back carries the person's own question.
        kept = Voice.kept(text, name)
        if kept.exists():
            audio = kept.read_bytes()
        else:
            try:
                audio = voice.speak(text, language, name)
            except Exception as err:  # the phone speaks instead; the words are not printed
                print('speak failed:', str(err)[:120], flush=True)
                return self.reply(500, {'error': 'speech failed'})
            if req.get('keep') is True:
                Voice.KEPT.mkdir(exist_ok=True)
                kept.write_bytes(audio)
        self.send_response(200)
        self.send_header('content-type', 'audio/mpeg')
        self.send_header('content-length', str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def log_message(self, *_):
        pass


# The GPU's first request builds its kernels (about a second); do it now, not on someone's question.
try:
    transcribe(to_wav(subprocess.run([FFMPEG, '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1', '-f', 'wav', 'pipe:1'], capture_output=True, check=True).stdout), 'en')
except Exception as err:
    print('warm-up skipped:', str(err)[:120], flush=True)

print(f'listening on http://127.0.0.1:{args.port}', flush=True)
try:
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
finally:
    llama.terminate()
