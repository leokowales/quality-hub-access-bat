"""Autorizações assinadas, cifradas para a chave de cada instalação Windows.

O canal entrega somente envelopes públicos. A chave da instalação e seu cache
ficam protegidos pelo DPAPI do usuário do Windows; a chave emissora não é distribuída.
"""

import base64
import ctypes
import hashlib
import json
import os
import secrets
import threading
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlsplit, quote, urlencode
from zoneinfo import ZoneInfo

import httpx
from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core import authorization, database

_LOCK = threading.RLock()
_ATTEMPTED = {}  # Uma consulta por dia/processo, inclusive após falha de rede.
_CONTEXT = b"QualityHub-installation-authorization-v2"


def _day():
    return datetime.now(ZoneInfo("America/Sao_Paulo")).date()


def _path():
    return database.DATABASE_PATH.parent / "access" / "installation.bin"


def enabled():
    # Uma vez iniciada a ativação, retirar a URL não reabilita a licença antiga.
    return bool(os.getenv("QUALITYHUB_AUTHORIZATION_BASE_URL")) or _path().exists()


def _encode(value):
    return base64.urlsafe_b64encode(value).decode("ascii")


def _decode(value):
    return base64.b64decode(value, altchars=b"-_", validate=True)


def _dpapi(value: bytes, *, decrypt=False) -> bytes:
    if os.name != "nt":
        raise authorization.AuthorizationError("A ativação protegida requer Windows.")
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = ctypes.create_string_buffer(value)
    source = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt32, kernel32 = ctypes.WinDLL("crypt32", use_last_error=True), ctypes.WinDLL("kernel32", use_last_error=True)
    fn = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                   ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    fn.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise authorization.AuthorizationError("Não foi possível acessar a chave protegida desta instalação.")
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel32.LocalFree(target.data)


def _load():
    try:
        return json.loads(_dpapi(_path().read_bytes(), decrypt=True))
    except FileNotFoundError:
        return None
    except (ValueError, OSError, TypeError) as error:
        raise authorization.AuthorizationError("A identificação local não pode ser lida. Não recrie o acesso; procure o responsável.") from error


def _save(state):
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{secrets.token_hex(8)}.tmp")
    try:
        temporary.write_bytes(_dpapi(authorization._canonical_claims(state)))
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _public(private):
    return private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def request_activation(email):
    email = authorization.normalize_email(email)
    with _LOCK:
        with database.conectar_banco() as db:
            user = db.execute("SELECT email FROM acesso_local WHERE id=1").fetchone()
        if user and user["email"] != email:
            raise authorization.AuthorizationError("Esta instalação já possui outra conta. Seus dados não foram alterados.")
        state = _load()
        if state and state["email"] != email:
            raise authorization.AuthorizationError("Já existe uma solicitação para outro e-mail nesta instalação.")
        if state is None:
            private = X25519PrivateKey.generate()
            state = {"email": email, "key": _encode(private.private_bytes(
                serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()))}
            _save(state)
        private = X25519PrivateKey.from_private_bytes(_decode(state["key"]))
        public = _public(private)
        request = {"version": 2, "email": email, "public_key": _encode(public),
                   "installation_id": hashlib.sha256(public).hexdigest()}
        return {"code": "QH2." + _encode(authorization._canonical_claims(request)),
                "installation_id": request["installation_id"], "email": email}


def parse_request(code):
    try:
        if not code.startswith("QH2.") or len(code) > 4096:
            raise ValueError()
        request = json.loads(_decode(code[4:]))
        public = _decode(request["public_key"])
        if len(public) != 32 or request["version"] != 2 or request["installation_id"] != hashlib.sha256(public).hexdigest():
            raise ValueError()
        request["email"] = authorization.normalize_email(request["email"])
        return request
    except (ValueError, TypeError, KeyError) as error:
        raise authorization.AuthorizationError("Código de instalação inválido.") from error


def _derived_key(private, public):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_CONTEXT).derive(private.exchange(public))


def issue_envelope(code, private_key_path: Path, *, revision: int, expires_at: date | None,
                   status="active", profile="qa"):
    request = parse_request(code)
    if type(revision) is not int or revision < 1 or status not in {"active", "revoked"} or profile not in authorization.VALID_PROFILES:
        raise authorization.AuthorizationError("Revisão, situação ou perfil inválido.")
    ephemeral = X25519PrivateKey.generate()
    header = {"version": 2, "installation_id": request["installation_id"], "revision": revision,
              "ephemeral_key": _encode(_public(ephemeral)), "nonce": _encode(secrets.token_bytes(12))}
    claims = {"email": request["email"], "profile": profile, "status": status,
              "expires_at": expires_at.isoformat() if expires_at else None}
    key = _derived_key(ephemeral, X25519PublicKey.from_public_bytes(_decode(request["public_key"])))
    body = {**header, "ciphertext": _encode(AESGCM(key).encrypt(_decode(header["nonce"]),
                authorization._canonical_claims(claims), authorization._canonical_claims(header)))}
    issuer = serialization.load_pem_private_key(private_key_path.read_bytes(), password=None)
    return {"payload": body, "signature": _encode(issuer.sign(authorization._canonical_claims(body)))}


def _verify(envelope, state):
    try:
        body = envelope["payload"]
        authorization._load_public_key().verify(_decode(envelope["signature"]), authorization._canonical_claims(body))
        private = X25519PrivateKey.from_private_bytes(_decode(state["key"]))
        if body["version"] != 2 or body["installation_id"] != hashlib.sha256(_public(private)).hexdigest():
            raise ValueError()
        if type(body["revision"]) is not int or body["revision"] < 1:
            raise ValueError()
        header = {key: value for key, value in body.items() if key != "ciphertext"}
        key = _derived_key(private, X25519PublicKey.from_public_bytes(_decode(body["ephemeral_key"])))
        claims = json.loads(AESGCM(key).decrypt(_decode(body["nonce"]), _decode(body["ciphertext"]),
                                              authorization._canonical_claims(header)))
        if claims["email"] != state["email"] or claims["profile"] not in authorization.VALID_PROFILES or claims["status"] not in {"active", "revoked"}:
            raise ValueError()
        if claims["expires_at"] is not None:
            date.fromisoformat(claims["expires_at"])
        return claims
    except (ValueError, KeyError, TypeError, InvalidSignature, InvalidTag) as error:
        raise authorization.AuthorizationError("A liberação recebida não é válida para esta instalação.") from error


def _fetch(installation_id):
    base = os.getenv("QUALITYHUB_AUTHORIZATION_BASE_URL", "").strip()
    parsed = urlsplit(base)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise authorization.AuthorizationError("O canal de liberações ainda não foi configurado pelo responsável.")
    with httpx.Client(timeout=6, follow_redirects=False, trust_env=False) as client:
        # GitHub Raw pode devolver a branch anterior mesmo com query diferente.
        # Contents/raw consulta a revisão publicada, sem token do mantenedor.
        nonce = secrets.token_hex(12)
        url = f"{base.rstrip('/')}/{installation_id}.json?qh={nonce}"
        headers = {"Cache-Control": "no-cache"}
        parts = parsed.path.strip('/').split('/')
        if parsed.netloc == 'raw.githubusercontent.com' and len(parts) >= 4:
            owner, repository, ref, *folder = parts
            path = '/'.join([*folder, installation_id + '.json'])
            url = (f"https://api.github.com/repos/{quote(owner, safe='')}/{quote(repository, safe='')}/contents/"
                   + quote(path, safe='/') + '?' + urlencode({'ref': ref, 'qh': nonce}))
            headers.update({'Accept': 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28'})
        with client.stream("GET", url, headers=headers) as response:
            response.raise_for_status()
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > 32768:
                    raise authorization.AuthorizationError("Documento de liberação excede o tamanho permitido.")
            return json.loads(content)


def read_installation_authorization(*, today=None, force=False):
    today = today or _day()
    with _LOCK:
        state = _load()
        if state is None:
            raise authorization.AuthorizationError("Informe seu e-mail para solicitar a liberação desta instalação.")
        identifier = hashlib.sha256(_public(X25519PrivateKey.from_private_bytes(_decode(state["key"])))).hexdigest()
        last_error = None
        if force or _ATTEMPTED.get(str(_path())) != today:
            _ATTEMPTED[str(_path())] = today
            try:
                incoming = _fetch(identifier)
                _verify(incoming, state)
                cached = state.get("envelope")
                if cached:
                    _verify(cached, state)
                    old, new = cached["payload"]["revision"], incoming["payload"]["revision"]
                    if new < old or (new == old and incoming != cached):
                        raise authorization.AuthorizationError("A revisão recebida é anterior à já validada.")
                state["envelope"] = incoming
                _save(state)  # Persistir revogação antes de negar, sem retornar a versões antigas.
            except (httpx.HTTPError, ValueError, TypeError, OSError) as error:
                last_error = error
        if not state.get("envelope"):
            raise authorization.AuthorizationError(str(last_error) if isinstance(last_error, authorization.AuthorizationError)
                else "Liberação ainda não recebida. Confira a publicação com o responsável e tente novamente.")
        claims = _verify(state["envelope"], state)
        if claims["status"] == "revoked":
            raise authorization.AuthorizationError("O acesso desta instalação foi revogado pelo responsável.")
        expires = date.fromisoformat(claims["expires_at"]) if claims["expires_at"] else None
        if expires is not None and expires < today:
            raise authorization.AuthorizationError("A autorização expirou. Solicite a extensão ao responsável.")
        return authorization.Authorization(claims["email"], claims["profile"], expires)
