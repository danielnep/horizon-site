"""Owner-only read-only index of browser/Android verification PNGs.

Existing screenshots stay in their original paths; no images from source,
fixtures, document uploads or application assets are eligible.
"""
import base64
import datetime as dt
import hashlib
from pathlib import Path

PROJECTS = Path('/var/lib/horizon-worker/projects')
WORKSPACE = Path('/var/lib/horizon-worker/workspace/runtime/web-evidence')
IMPORTS = Path('/var/lib/horizon-worker/workspace/runtime/owner-visual-archive')
MAX_BYTES = 3_000_000
MAX_ITEMS = 400


def _locations():
    if PROJECTS.is_dir():
        for project in sorted(PROJECTS.iterdir()):
            if project.is_symlink() or not project.is_dir():
                continue
            for session in sorted(project.iterdir()):
                if session.is_symlink() or not session.is_dir():
                    continue
                for kind in ('artifacts', 'runtime/web-evidence'):
                    root = session / kind
                    if root.is_dir() and not root.is_symlink():
                        yield root, project.name, session.name
    if WORKSPACE.is_dir() and not WORKSPACE.is_symlink():
        yield WORKSPACE, 'Horizon / QA geral', None
    if IMPORTS.is_dir() and not IMPORTS.is_symlink():
        yield IMPORTS, 'Horizon / capturas de controle', None


def catalog():
    found = []
    for root, project, session in _locations():
        for path in root.rglob('*.png'):
            if len(found) >= MAX_ITEMS:
                break
            try:
                relative = path.relative_to(root)
                if any(part.startswith('.') for part in relative.parts):
                    continue
                if any(p.is_symlink() for p in (path, *path.parents) if p == root or root in p.parents):
                    continue
                stat = path.stat()
                if not 0 < stat.st_size <= MAX_BYTES:
                    continue
                with path.open('rb') as f:
                    if f.read(8) != b'\x89PNG\r\n\x1a\n':
                        continue
            except (OSError, ValueError):
                continue
            fingerprint = hashlib.sha256(str(path).encode('utf-8')).hexdigest()[:32]
            kind = 'Navegador' if 'web-evidence' in path.parts else (
                'Android / interface' if 'android' in str(relative).lower() or 'apk-' in path.name.lower() else 'Comparativo visual'
            )
            found.append({'id': fingerprint, 'project': project, 'session': session,
                          'file': path.name, 'kind': kind,
                          'at': dt.datetime.fromtimestamp(stat.st_mtime, dt.timezone.utc).isoformat(),
                          'bytes': stat.st_size, '_path': path})
    return sorted(found, key=lambda x: x['at'], reverse=True)[:MAX_ITEMS]


def list_evidence():
    items = catalog()
    return {'count': len(items), 'items': [{k: v for k, v in i.items() if k != '_path'} for i in items]}


def read_evidence(item_id):
    if len(item_id) != 32 or any(ch not in '0123456789abcdef' for ch in item_id):
        raise ValueError('identificador_invalido')
    item = next((x for x in catalog() if x['id'] == item_id), None)
    if not item:
        raise ValueError('captura_nao_encontrada')
    raw = item['_path'].read_bytes()
    if len(raw) > MAX_BYTES or not raw.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('captura_invalida')
    return {'mime': 'image/png', 'data': base64.b64encode(raw).decode('ascii'),
            'sha256': hashlib.sha256(raw).hexdigest()}