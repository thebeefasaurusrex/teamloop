"""One-time public dependency setup. Never imported by the offline runtime."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent
WHEEL_URL = 'https://files.pythonhosted.org/packages/09/fa/d2d6369257fd2f0de616b1c7110b73fab409ef61b14f1b9e0010ed325914/sentencepiece-0.2.2-cp313-cp313-win_amd64.whl'
WHEEL_SHA = '74f0ee601047c0c12a783088b51be4e6214a62ecd9e02278c477433cd16e0ed9'
ASSET_URL = 'https://raw.githubusercontent.com/google/gemma_pytorch/014acb7ac4563a5f77c76d7ff98f31b568c16508/tokenizer/gemma3_cleaned_262144_v2.spiece.model'
ASSET_SHA = '1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c'

def download(url, destination, expected=None, maximum=50*1024*1024):
    request = urllib.request.Request(url, headers={'User-Agent': 'TeamLoop-public-tokenizer-qualification'})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read(maximum + 1)
    if len(content) > maximum:
        raise ValueError('Public artifact exceeds setup size bound')
    digest = hashlib.sha256(content).hexdigest()
    if expected and digest != expected:
        raise ValueError('Public artifact digest mismatch')
    destination.write_bytes(content)
    return {'source': url, 'file': destination.name, 'sha256': digest, 'sizeBytes': len(content)}

def main():
    if sys.platform != 'win32' or sys.version_info[:2] != (3, 13):
        raise ValueError('Qualified wheel requires Windows CPython 3.13')
    wheel = ROOT / 'sentencepiece-0.2.2-cp313-cp313-win_amd64.whl'
    records = [download(WHEEL_URL, wheel, WHEEL_SHA)]
    records.append(download(ASSET_URL, ROOT / 'gemma3.spiece.model', ASSET_SHA))
    site = ROOT / 'runtime-site'
    if site.exists():
        raise ValueError('Refuse to overwrite existing dependency runtime')
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-index', '--no-deps', '--no-compile', '--target', str(site), str(wheel)], check=True)
    (ROOT / 'SETUP-PROVENANCE.json').write_text(json.dumps({'schemaVersion': 1, 'purpose': 'public-tokenizer-assets-only', 'artifacts': records}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'installed-isolated', 'assetBytes': records[1]['sizeBytes'], 'wheelBytes': records[0]['sizeBytes'], 'site': str(site)}))

if __name__ == '__main__':
    main()
