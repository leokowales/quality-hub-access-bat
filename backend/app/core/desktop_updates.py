"""Atualizações nativas: assinatura fixa, download limitado e preparação explícita."""
import base64
import hashlib
import json
from pathlib import Path
import re
import secrets
import shutil
import threading
from urllib.parse import urlsplit, quote, unquote, urlencode

import httpx
from cryptography.hazmat.primitives import serialization

from app.core.authorization import _canonical_claims

PUBLIC_KEY = Path(__file__).with_name('update_public_key.pem')
FIELDS = {'format', 'version', 'sha256', 'size', 'url'}
MAX_INSTALLER = 256 * 1024 * 1024


def version(value):
    match = re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-rc\.([1-9][0-9]*))?', value) if isinstance(value, str) and len(value) <= 128 else None
    if not match:
        raise ValueError('A atualização precisa ter versão estável ou candidata válida.')
    return (*map(int, match.group(1, 2, 3)), 0 if match[4] else 1, int(match[4] or 0))


def verify_manifest(document, current, key_path=PUBLIC_KEY):
    package = document['platforms']['windows-x86_64']
    if set(package) != FIELDS | {'signature'} or package['format'] != 'qualityhub-update-v1':
        raise ValueError('Formato de atualização inválido.')
    current_value = current.split('-prototype.')[0]
    if '-rc.' in package['version'] and '-rc.' not in current:
        raise ValueError('O canal estável não instala candidatas de homologação.')
    if document['version'] != package['version'] or version(package['version']) <= version(current_value):
        raise ValueError('A versão precisa ser superior à instalada.')
    if type(package['size']) is not int or not 0 < package['size'] <= MAX_INSTALLER or not re.fullmatch(r'[a-f0-9]{64}', package['sha256']):
        raise ValueError('Tamanho ou hash inválido.')
    expected = f"/leokowales/quality-hub-distribution/releases/download/v{package['version']}/QualityHub-{package['version']}-windows-x64-setup.exe"
    url = urlsplit(package['url'])
    if (url.scheme != 'https' or url.netloc != 'github.com' or url.path != expected or url.query or url.fragment):
        raise ValueError('O pacote não pertence ao canal de distribuição.')
    signed = {field: package[field] for field in FIELDS}
    key = serialization.load_pem_public_key(key_path.read_bytes())
    key.verify(base64.b64decode(package['signature'], validate=True), _canonical_claims(signed))
    return package


def verify_file(path, package):
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if path.stat().st_size != package['size'] or digest != package['sha256']:
        raise ValueError('O instalador recebido não corresponde à assinatura.')


def manifest_request(channel):
    parsed = urlsplit(channel)
    parts = parsed.path.strip('/').split('/')
    if (parsed.scheme == 'https' and parsed.netloc == 'raw.githubusercontent.com'
            and not parsed.query and not parsed.fragment and len(parts) >= 4):
        owner, repository, ref, *path = map(unquote, parts)
        endpoint = (f'https://api.github.com/repos/{quote(owner, safe="")}/{quote(repository, safe="")}/contents/'
                    + '/'.join(quote(part, safe='') for part in path)
                    + '?' + urlencode({'ref': ref, 'qh': secrets.token_hex(12)}))
        return endpoint, {'Accept': 'application/vnd.github.raw+json'}
    return channel, {}


def download(client, url, target, limit, *, redirects=False, headers=None):
    for _ in range(6):
        with client.stream('GET', url, headers={'Cache-Control': 'no-cache', **(headers or {})}) as response:
            if response.is_redirect and redirects:
                candidate = urlsplit(response.headers.get('location', ''))
                if (candidate.scheme != 'https' or candidate.hostname not in {'release-assets.githubusercontent.com', 'github.com', 'objects.githubusercontent.com'}
                        or candidate.username or candidate.password or candidate.port not in (None, 443)):
                    raise ValueError('Redirecionamento de download inválido.')
                url = candidate.geturl()
                continue
            response.raise_for_status()
            total = 0
            with target.open('xb') as stream:
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > limit:
                        raise ValueError('O download excede o tamanho permitido.')
                    stream.write(chunk)
            return
    raise ValueError('Redirecionamentos demais no download.')


class UpdateManager:
    def __init__(self, *, runtime, install, data, current, channel, key_path=PUBLIC_KEY):
        self.runtime, self.install, self.data = map(Path, (runtime, install, data))
        self.current, self.channel, self.key = current, channel, key_path
        self.lock = threading.Lock()
        self.prepared = None
        self.applying = False

    def prepare(self):
        if not self.lock.acquire(blocking=False):
            raise ValueError('Já existe uma atualização em preparação.')
        try:
            if self.applying:
                raise ValueError('A instalação já foi solicitada.')
            previous = self.data.parent / 'updates' / 'last-result.json'
            if previous.exists() and json.loads(previous.read_text(encoding='utf-8')).get('status') in {
                    'backing_up', 'installing', 'recovering', 'failed_recovery_required'}:
                raise ValueError('A atualização anterior exige conferência do suporte.')
            job = self.runtime / ('update-' + secrets.token_hex(8))
            job.mkdir()
            with httpx.Client(timeout=httpx.Timeout(30, connect=10), follow_redirects=False, trust_env=False) as client:
                manifest = job / 'latest.json'
                channel_url, headers = manifest_request(self.channel)
                download(client, channel_url, manifest, 256000, headers=headers)
                document = json.loads(manifest.read_text(encoding='utf-8'))
                package = verify_manifest(document, self.current, self.key)
                download(client, package['url'], job / 'installer.exe', package['size'], redirects=True)
            verify_file(job / 'installer.exe', package)
            # O helper roda fora da instalação e do JobObject do backend.
            helper = self.runtime / 'update-helper'
            if not helper.exists():
                shutil.copytree(self.install / 'backend', helper)
            plan = {'document': document, 'current': self.current, 'install': str(self.install.resolve()),
                    'data': str(self.data.resolve()), 'job': str(job.resolve())}
            plan_path = self.runtime / 'update-plan.json'
            temporary = self.runtime / 'update-plan.tmp'
            temporary.write_text(json.dumps(plan), encoding='utf-8')
            temporary.replace(plan_path)
            self.prepared = package
            return {'version': package['version'], 'size': package['size']}
        finally:
            self.lock.release()

    def apply(self):
        with self.lock:
            if not self.prepared or self.applying:
                raise ValueError('Prepare e verifique o pacote antes de instalar.')
            plan = json.loads((self.runtime / 'update-plan.json').read_text(encoding='utf-8'))
            package = verify_manifest(plan['document'], self.current, self.key)
            verify_file(Path(plan['job']) / 'installer.exe', package)
            self.applying = True
            (self.runtime / 'update-request').write_text('confirmed', encoding='ascii')
            return {'status': 'closing'}


def create_router(manager):
    from fastapi import APIRouter, HTTPException
    router = APIRouter(prefix='/desktop-updates')

    @router.get('/status')
    def status():
        result = manager.data.parent / 'updates' / 'last-result.json'
        previous = json.loads(result.read_text(encoding='utf-8')) if result.is_file() else None
        return {'enabled': True, 'current': manager.current, 'applying': manager.applying, 'previous': previous}

    @router.post('/prepare')
    def prepare():
        try:
            return manager.prepare()
        except Exception:
            raise HTTPException(400, 'Não foi possível baixar e verificar a atualização. Nenhuma instalação foi iniciada.')

    @router.post('/apply')
    def apply():
        try:
            return manager.apply()
        except Exception:
            raise HTTPException(400, 'O pacote não está pronto ou foi alterado. Prepare a atualização novamente.')

    return router
