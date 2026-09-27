"""
One-time setup for the local server (vault plan-suara-0018, obs-0071), into local-asr/runtime/:

  Hearing
  1. llama.cpp's Vulkan build for Windows, pinned (the GPU runtime for this PC's Radeon RX 6800)
  2. the speech model from Hugging Face: native Qwen3-ASR (Qwen, Apache-2.0), or Polyglot-Lion
     v1.5, its Singapore fine-tune (knoveleng, MIT)
  3. the model converted to GGUF with llama.cpp's own converter, 8-bit, plus its audio encoder

  Voice (skip with --no-voice)
  4. Qwen3-TTS-GGUF (HaujetZhao, MIT), pinned, with the llama.cpp build it is written against
  5. Qwen3-TTS 1.7B CustomVoice (Qwen, Apache-2.0) exported by that repo's own scripts: the model
     to GGUF for llama.cpp, the audio decoder to ONNX

    python -m venv local-asr/runtime/venv
    local-asr/runtime/venv/Scripts/python -m pip install -r local-asr/requirements.txt
    local-asr/runtime/venv/Scripts/python local-asr/setup.py [--model qwen3-asr-1.7b ...] [--no-voice]

About 2.5 GB a hearing model and 2.2 GB the voice. Already-present files are kept, so a rerun
only fills what is missing.
"""
import argparse, io, os, shutil, subprocess, sys, urllib.request, zipfile
from pathlib import Path

LLAMA_TAG = 'b11217'  # 2026-09-27; Qwen3-ASR support, Vulkan build for Windows
HERE = Path(__file__).resolve().parent
RUNTIME = HERE / 'runtime'
LLAMA = RUNTIME / 'llama.cpp'
SOURCE = RUNTIME / f'llama.cpp-{LLAMA_TAG}'
MODELS = RUNTIME / 'models'
os.environ.setdefault('HF_HOME', str(RUNTIME / 'hf'))

# The name server.py is started with, and where Hugging Face keeps it.
REPOS = {
    'qwen3-asr-1.7b': 'Qwen/Qwen3-ASR-1.7B',
    'qwen3-asr-0.6b': 'Qwen/Qwen3-ASR-0.6B',
    'polyglot-lion-1.7b': 'knoveleng/polyglot-lion-1.7b-v1.5',
    'polyglot-lion-0.6b': 'knoveleng/polyglot-lion-0.6b-v1.5',
}

TTS_SHA = '74feb581bc8cefb835fc608107e857036d7580a1'  # 2026-09-19
TTS_LLAMA_TAG = 'b10621'  # the build Qwen3-TTS-GGUF is written against
TTS = RUNTIME / 'qwen3-tts-gguf'
TTS_BIN = TTS / 'qwen3_tts_gguf' / 'inference' / 'bin'
TTS_MODEL = TTS / 'model-custom'
TTS_REPO = 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice'
TTS_FILES = ['qwen3_tts_talker.q5_k.gguf', 'qwen3_tts_predictor.q8_0.gguf', 'qwen3_tts_decoder.fp16.onnx', 'tokenizer.json']
# The custom-voice model needs no cloning encoders (scripts 11 and 12).
TTS_EXPORT = ['13-Export-Decoder', '14-Export-Embeddings', '15-Copy-Tokenizer', '16-Quantize-ONNX-Models',
              '21-Extract-Talker-Weights', '22-Prepare-Talker-Tokenizer', '23-Convert-Talker-GGUF', '24-Quantize-Talker-GGUF',
              '31-Extract-Predictor-Weights', '32-Prepare-Predictor-Tokenizer', '33-Convert-Predictor-GGUF', '34-Quantize-Predictor-GGUF']
# What the export leaves behind that the engine never reads: about 6.4 GB.
TTS_LEFTOVERS = ['talker_hf', 'predictor_hf', 'qwen3_tts_talker.f16.gguf', 'qwen3_tts_predictor.f16.gguf',
                 'qwen3_tts_decoder.fp32.onnx', 'qwen3_tts_decoder.fp32.onnx.data', 'qwen3_tts_decoder.int8.onnx']

parser = argparse.ArgumentParser()
parser.add_argument('--model', choices=[*REPOS, 'all'], action='append', help='repeat for several; default qwen3-asr-1.7b')
parser.add_argument('--no-voice', action='store_true', help='hearing only')
args = parser.parse_args()
names = args.model or ['qwen3-asr-1.7b']
names = list(REPOS) if 'all' in names else names


def fetch_zip(url: str, into: Path) -> None:
    print(f'downloading {url}', flush=True)
    with urllib.request.urlopen(url) as r:
        zipfile.ZipFile(io.BytesIO(r.read())).extractall(into)


def llama_zip(tag: str) -> str:
    return f'https://github.com/ggml-org/llama.cpp/releases/download/{tag}/llama-{tag}-bin-win-vulkan-x64.zip'


if not (LLAMA / 'llama-server.exe').exists():
    fetch_zip(llama_zip(LLAMA_TAG), LLAMA)
if not (SOURCE / 'convert_hf_to_gguf.py').exists():
    fetch_zip(f'https://github.com/ggml-org/llama.cpp/archive/refs/tags/{LLAMA_TAG}.zip', RUNTIME)
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '-e', str(SOURCE / 'gguf-py')], check=True)

from huggingface_hub import snapshot_download  # noqa: E402

MODELS.mkdir(parents=True, exist_ok=True)
for name in names:
    snapshot = snapshot_download(REPOS[name])
    for extra, out in (([], MODELS / f'{name}-Q8_0.gguf'), (['--mmproj'], MODELS / f'mmproj-{name}-Q8_0.gguf')):
        if out.exists():
            continue
        print(f'converting {out.name}', flush=True)
        subprocess.run([sys.executable, str(SOURCE / 'convert_hf_to_gguf.py'), snapshot, *extra, '--outfile', str(out), '--outtype', 'q8_0'], check=True)

if not args.no_voice and not all((TTS_MODEL / f).exists() for f in TTS_FILES):
    if not (TTS / 'export_config.py').exists():
        fetch_zip(f'https://github.com/HaujetZhao/Qwen3-TTS-GGUF/archive/{TTS_SHA}.zip', RUNTIME)
        (RUNTIME / f'Qwen3-TTS-GGUF-{TTS_SHA}').rename(TTS)
    if not (TTS_BIN / 'llama.dll').exists():
        fetch_zip(llama_zip(TTS_LLAMA_TAG), TTS_BIN)
    # Script 33 imports llama.cpp's converter from ref/, a git submodule a zip leaves empty;
    # script 23 uses the copy bundled in qwen3_tts_gguf/export/, and so does this.
    s33 = TTS / '33-Convert-Predictor-GGUF.py'
    s33.write_text(s33.read_text(encoding='utf-8').replace('"ref", "llama.cpp"', '"qwen3_tts_gguf", "export"'), encoding='utf-8')
    snapshot = snapshot_download(TTS_REPO)
    (TTS / 'export_config.py').write_text(
        'from pathlib import Path\n'
        f'MODEL_DIR = Path(r"{snapshot}")\n'
        f'EXPORT_DIR = Path(r"{TTS_MODEL}")\n', encoding='utf-8')
    env = {**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'}
    for script in TTS_EXPORT:
        print(f'voice: {script}', flush=True)
        subprocess.run([sys.executable, f'{script}.py'], cwd=TTS, env=env, check=True)
    for leftover in TTS_LEFTOVERS:
        path = TTS_MODEL / leftover
        shutil.rmtree(path) if path.is_dir() else path.unlink(missing_ok=True)

devices = subprocess.run([str(LLAMA / 'llama-server.exe'), '--list-devices'], capture_output=True, text=True).stdout
print('\nready. llama.cpp sees:\n' + '\n'.join(l for l in devices.splitlines() if 'Vulkan' in l or 'CPU' in l))
print('start it with: python local-asr/server.py --model ' + names[0])
