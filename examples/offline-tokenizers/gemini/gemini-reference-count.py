"""Offline, visible-text-only Google-published Gemma3 reference token count.

The requested current Gemini model is NOT assumed to share this tokenizer.
Input: JSON on stdin {"text": "...", "requestedModel": "gemini-..."}.
Arguments: this script, explicit pinned engine manifest path. No text in argv/files.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import sys
import time

MAX_INPUT = 8 * 1024 * 1024
MAX_TEXT_BYTES = 1024 * 1024
sys.dont_write_bytecode = True
ASSET_SHA = '1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c'
REFERENCE_MODEL = 'gemini-2.5-flash'
REFERENCE_IDS = [3689, 563, 822, 1463, 236881]

def deny_network(*_args, **_kwargs):
    raise OSError('Offline tokenizer network disabled')

def audit(event, _args):
    if event.startswith('socket.') or event in ('subprocess.Popen', 'os.system'):
        raise OSError('Offline tokenizer external operation disabled')

def enforce_offline():
    sys.addaudithook(audit)
    socket.socket = deny_network
    socket.create_connection = deny_network
    socket.getaddrinfo = deny_network

def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            result.update(block)
    return result.hexdigest()

def validate_pin(pin_file):
    if not sys.flags.isolated or not sys.flags.no_site:
        raise ValueError('Isolated no-site interpreter required')
    if pin_file.is_symlink() or pin_file.stat().st_size > 1024*1024:
        raise ValueError('Invalid engine pin')
    pin = json.loads(pin_file.read_text(encoding='utf-8'))
    root = Path(__file__).resolve().parent
    if pin.get('schemaVersion') != 1 or Path(pin['root']).resolve() != root or pin.get('assetSha256') != ASSET_SHA or pin.get('sentencepieceVersion') != '0.2.2':
        raise ValueError('Unsupported engine pin')
    executable = Path(sys.executable).resolve()
    if executable != Path(pin['python']).resolve() or digest(executable) != pin.get('pythonSha256') or digest(Path(__file__).resolve()) != pin.get('helperSha256'):
        raise ValueError('Runtime pin mismatch')
    files = pin.get('files')
    if not isinstance(files, list) or not files or len(files) > 512:
        raise ValueError('Invalid engine file set')
    selected = set()
    for item in files:
        relative = item.get('path')
        if not isinstance(relative, str) or relative in selected or Path(relative).is_absolute() or '..' in Path(relative).parts:
            raise ValueError('Invalid engine path')
        selected.add(relative)
        file = root / relative
        if file.is_symlink() or not file.is_file() or file.resolve().is_relative_to(root) is False or file.stat().st_size != item.get('sizeBytes') or digest(file) != item.get('sha256'):
            raise ValueError('Engine asset changed')
    # Reject injected executable modules as well as changed selected modules.
    discovered = list((root / 'runtime-site').rglob('*'))
    if any(file.is_symlink() or file.suffix.lower() == '.pyc' for file in discovered):
        raise ValueError('Engine aliases and cached executable bytecode unsupported')
    actual = {file.relative_to(root).as_posix() for file in discovered if file.is_file() and file.suffix.lower() in ('.py', '.pyd', '.dll')}
    if actual != {name for name in selected if name.startswith('runtime-site/') and Path(name).suffix.lower() in ('.py', '.pyd', '.dll')}:
        raise ValueError('Engine module set changed')
    for item in pin.get('pythonLibraries', []):
        if digest(Path(item['path'])) != item.get('sha256'):
            raise ValueError('Python library pin changed')
    if 'gemma3.spiece.model' not in selected or digest(root / 'gemma3.spiece.model') != ASSET_SHA:
        raise ValueError('Vocabulary pin mismatch')
    return root, pin

def main():
    started = time.perf_counter()
    enforce_offline()
    if len(sys.argv) != 2:
        raise ValueError('Explicit engine pin required')
    root, pin = validate_pin(Path(sys.argv[1]))
    data = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(data) > MAX_INPUT:
        raise ValueError('Input bound exceeded')
    payload = json.loads(data.decode('utf-8'))
    if not isinstance(payload, dict) or set(payload) - {'text', 'requestedModel'} or not isinstance(payload.get('text'), str):
        raise ValueError('Unsupported input metadata')
    requested = payload.get('requestedModel')
    if not isinstance(requested, str) or not re.fullmatch(r'gemini-[a-zA-Z0-9_.-]{1,100}', requested):
        raise ValueError('Invalid requested model')
    text = payload['text']
    text_bytes = text.encode('utf-8')
    if len(text_bytes) > MAX_TEXT_BYTES:
        raise ValueError('Visible text byte bound exceeded')
    # -I -S excludes site/user configuration. Only verified dependency files are added.
    sys.path.insert(0, str(root / 'runtime-site'))
    import sentencepiece
    if sentencepiece.__version__ != '0.2.2':
        raise ValueError('SentencePiece version mismatch')
    processor = sentencepiece.SentencePieceProcessor()
    processor.LoadFromSerializedProto((root / 'gemma3.spiece.model').read_bytes())
    vector = processor.encode('What is your name?')
    # SDK's count_tokens example publishes count 5. Its inline token IDs are stale
    # for the currently published asset SHA; preserve the asset's observed IDs.
    if len(vector) != 5 or vector != REFERENCE_IDS:
        raise ValueError('Reference vector mismatch')
    load_elapsed = time.perf_counter() - started
    encoding_started = time.perf_counter()
    count = len(processor.encode(text))
    encode_elapsed = time.perf_counter() - encoding_started
    try:
        socket.create_connection(('example.com', 443), timeout=0.1)
        raise ValueError('Offline network guard failed')
    except OSError:
        network_blocked = True
    reference = {'status': 'observed', 'tokens': count, 'engine': 'google-sentencepiece-gemma3', 'version': '0.2.2', 'referenceModel': REFERENCE_MODEL, 'assetSha256': ASSET_SHA, 'verifiedForRequestedModel': requested == REFERENCE_MODEL, 'mappingStatus': 'verified-reference-model-only' if requested == REFERENCE_MODEL else 'unverified-model-mapping', 'scope': 'visible-text-only', 'warningCode': 'reference-count-excludes-client-context' if requested == REFERENCE_MODEL else 'reference-tokenizer-not-requested-model'}
    result = {'schemaVersion': 1, 'status': 'observed', 'requestedModel': requested, 'requestedModelTokens': None, 'fullRequestExact': False, 'inputSha256': hashlib.sha256(text_bytes).hexdigest(), 'visibleBytes': len(text_bytes), 'referenceCount': reference, 'offlineNetworkGuardVerified': network_blocked, 'timing': {'loadAndVerifyMs': round(load_elapsed*1000, 3), 'encodeMs': round(encode_elapsed*1000, 3), 'totalMs': round((time.perf_counter()-started)*1000, 3)}}
    print(json.dumps(result, ensure_ascii=True, separators=(',', ':')))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not echo text, filesystem paths, credentials or exception payloads.
        print(json.dumps({'schemaVersion': 1, 'status': 'unavailable', 'reasonCode': 'offline-reference-engine-failed', 'requestedModelTokens': None, 'referenceCount': {'status': 'unavailable', 'tokens': None, 'engine': 'google-sentencepiece-gemma3', 'version': '0.2.2', 'referenceModel': REFERENCE_MODEL, 'reasonCode': 'offline-reference-engine-failed'}}))
        sys.exit(1)
