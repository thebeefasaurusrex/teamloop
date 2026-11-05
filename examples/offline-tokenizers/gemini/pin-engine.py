"""One-time pin creation after reviewed public setup; runtime never calls this."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()
def main():
    files = [ROOT / 'gemma3.spiece.model']
    files += [file for file in (ROOT / 'runtime-site').rglob('*') if file.is_file() and file.suffix.lower() in ('.py', '.pyd', '.dll')]
    python = Path(sys.executable).resolve()
    libraries = [file for file in [python.parent / 'python313.dll', python.parent / 'python3.dll'] if file.is_file()]
    pin = {'schemaVersion': 1, 'root': str(ROOT), 'python': str(python), 'pythonSha256': digest(python), 'pythonLibraries': [{'path': str(file), 'sha256': digest(file)} for file in libraries], 'helperSha256': digest(ROOT / 'gemini-reference-count.py'), 'sentencepieceVersion': '0.2.2', 'assetSha256': '1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c', 'files': [{'path': file.relative_to(ROOT).as_posix(), 'sizeBytes': file.stat().st_size, 'sha256': digest(file)} for file in sorted(files)]}
    destination = ROOT / 'engine-pin.json'
    if destination.exists():
        raise ValueError('Refuse to overwrite a reviewed pin')
    destination.write_text(json.dumps(pin, indent=2) + '\n', encoding='utf-8')
    descriptor = {
        'enabled': True, 'executable': str(python), 'executableSha256': digest(python),
        'helper': str(ROOT / 'gemini-reference-count.py'), 'helperSha256': pin['helperSha256'],
        'pinFile': str(destination), 'pinSha256': digest(destination),
        'engine': 'google-sentencepiece-gemma3', 'version': '0.2.2',
        'referenceModel': 'gemini-2.5-flash',
    }
    with (ROOT / 'descriptor.local.json').open('x', encoding='utf-8') as file:
        json.dump(descriptor, file, indent=2)
    print(json.dumps({'pinFile': str(destination), 'pinSha256': digest(destination), 'files': len(files)}))
if __name__ == '__main__':
    main()
