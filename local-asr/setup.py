"""
One-time setup for the local hearing server (vault plan-suara-0018), into local-asr/runtime/:

  1. llama.cpp's Vulkan build for Windows, pinned (the GPU runtime for this PC's Radeon RX 6800)
  2. the speech model from Hugging Face: Polyglot-Lion v1.5 (knoveleng, MIT), or the native
     Qwen3-ASR it was fine-tuned from (Qwen, Apache-2.0)
  3. the model converted to GGUF with llama.cpp's own converter, 8-bit, plus its audio encoder

    python -m venv local-asr/runtime/venv
    local-asr/runtime/venv/Scripts/python -m pip install -r local-asr/requirements.txt
    local-asr/runtime/venv/Scripts/python local-asr/setup.py [--model polyglot-lion-1.7b ...]

About 2.5 GB a 1.7B model. Already-present files are kept, so a rerun only fills what is missing.
"""
import argparse, io, os, subprocess, sys, urllib.request, zipfile
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
    'polyglot-lion-1.7b': 'knoveleng/polyglot-lion-1.7b-v1.5',
    'polyglot-lion-0.6b': 'knoveleng/polyglot-lion-0.6b-v1.5',
    'qwen3-asr-1.7b': 'Qwen/Qwen3-ASR-1.7B',
    'qwen3-asr-0.6b': 'Qwen/Qwen3-ASR-0.6B',
}

parser = argparse.ArgumentParser()
parser.add_argument('--model', choices=[*REPOS, 'all'], action='append', help='repeat for several; default polyglot-lion-1.7b')
names = parser.parse_args().model or ['polyglot-lion-1.7b']
names = list(REPOS) if 'all' in names else names


def fetch_zip(url: str, into: Path) -> None:
    print(f'downloading {url}', flush=True)
    with urllib.request.urlopen(url) as r:
        zipfile.ZipFile(io.BytesIO(r.read())).extractall(into)


if not (LLAMA / 'llama-server.exe').exists():
    fetch_zip(f'https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_TAG}/llama-{LLAMA_TAG}-bin-win-vulkan-x64.zip', LLAMA)
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

devices = subprocess.run([str(LLAMA / 'llama-server.exe'), '--list-devices'], capture_output=True, text=True).stdout
print('\nready. llama.cpp sees:\n' + '\n'.join(l for l in devices.splitlines() if 'Vulkan' in l or 'CPU' in l))
print('start it with: python local-asr/server.py --model ' + names[0])
