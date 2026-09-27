"""
Suara's local hearing server (vault plan-suara-0018): Polyglot-Lion, Qwen3-ASR fine-tuned for
Singapore's English, Mandarin, Malay and Tamil (arXiv 2603.16184; knoveleng, MIT), on this PC's GPU.

    python local-asr/setup.py            once: llama.cpp (Vulkan) and the model, into local-asr/runtime
    python local-asr/server.py           then: starts llama.cpp on the GPU and listens on :8791

    GET  /health                         {"ready": true, "model": "...", "device": "Vulkan0"}
    POST /transcribe?language=en|zh      body: the recording, any format the browser makes
                                         {"text": "...", "language": "English", "ms": 223}

The GPU is reached through llama.cpp's Vulkan backend: PyTorch has no GPU build for this PC's
Radeon RX 6800 on Windows. On the 38 test clips, Polyglot-Lion 1.7B took a median 0.22 s a clip
here (5.7 s on the CPU) at 14.5% word error, best on Mandarin of every engine tested.

Nothing is stored: a recording is converted in memory, sent to llama.cpp on this machine, and
dropped. No request log is written, because recordings are personal.
"""
import argparse, atexit, base64, json, os, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
RUNTIME = HERE / 'runtime'

parser = argparse.ArgumentParser()
parser.add_argument('--model', default=os.environ.get('LOCAL_ASR_MODEL', 'polyglot-lion-1.7b'), help='a name from setup.py, e.g. qwen3-asr-1.7b')
parser.add_argument('--device', default=os.environ.get('LOCAL_ASR_DEVICE', 'Vulkan0'), help='a llama.cpp device, e.g. Vulkan0; "none" for the CPU')
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
    head, _, text = content.partition('<asr_text>')
    return text.strip(), head.replace('language', '').strip()


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
            return self.reply(200, {'ready': llama.poll() is None, 'model': MODEL.name, 'device': args.device})
        self.reply(404, {'error': 'not found'})

    def do_POST(self) -> None:
        url = urlparse(self.path)
        if url.path != '/transcribe':
            return self.reply(404, {'error': 'not found'})
        size = int(self.headers.get('content-length') or 0)
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
