"""Build a deployable ZIP without credentials or unrelated repository files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root = Path(__file__).resolve().parents[1]
out = root / 'yandex' / 'function.zip'
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    archive.write(root / 'yandex/index.cjs', 'index.js')
    archive.writestr('package.json', json.dumps({'private': True, 'type': 'commonjs'}))
    archive.writestr('worker/package.json', json.dumps({'type': 'module'}))
    for file in sorted((root / 'worker/src').rglob('*.js')):
        archive.write(file, file.relative_to(root))
print(out)
