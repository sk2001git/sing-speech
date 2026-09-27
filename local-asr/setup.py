"""
One-time setup for the local hearing server (vault plan-suara-0018), into local-asr/runtime/:

  1. llama.cpp's Vulkan build for Windows, pinned (the GPU runtime for this PC's Radeon RX 6800)
  2. Polyglot-Lion v1.5 from Hugging Face (knoveleng, MIT)
  3. the model converted to GGUF with llama.cpp's own converter, 8-bit, plus its audio encoder

    python -m venv local-asr/runtime/venv
    local-asr/runtime/venv/Scripts/python -m pip install -r local-asr/requirements.txt
    local-asr/runtime/venv/Scripts/python local-asr/setup.py [--size 1.7b|0.6b|both]

About 2.5 GB for 1.7B. Already-present files are kept, so a rerun only fills what is missing.
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

parser = argparse.ArgumentParser()
parser.add_argument('--size', choices=['1.7b', '0.6b', 'both'], default='1.7b')
sizes = ['1.7b', '0.6b'] if (s := parser.parse_args().size) == 'both' else [s]


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
for size in sizes:
    snapshot = snapshot_download(f'knoveleng/polyglot-lion-{size}-v1.5')
    for extra, name in (([], f'polyglot-lion-{size}-v1.5-Q8_0.gguf'), (['--mmproj'], f'mmproj-polyglot-lion-{size}-v1.5-Q8_0.gguf')):
        out = MODELS / name
        if out.exists():
            continue
        print(f'converting {name}', flush=True)
        subprocess.run([sys.executable, str(SOURCE / 'convert_hf_to_gguf.py'), snapshot, *extra, '--outfile', str(out), '--outtype', 'q8_0'], check=True)

devices = subprocess.run([str(LLAMA / 'llama-server.exe'), '--list-devices'], capture_output=True, text=True).stdout
print('\nready. llama.cpp sees:\n' + '\n'.join(l for l in devices.splitlines() if 'Vulkan' in l or 'CPU' in l))
print('start it with: python local-asr/server.py')
