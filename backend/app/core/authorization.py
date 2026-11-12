"""Validação da autorização individual e credenciais locais."""

import base64
import hashlib
import json
import os
import secrets
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from app.core.storage import data_directory, load_environment


load_environment()
DATA_DIRECTORY = data_directory()
AUTHORIZATION_PATH = Path(
    os.getenv(
        "QUALITYHUB_AUTHORIZATION_PATH",
        str(DATA_DIRECTORY / "authorization.lic"),
    )
)
PUBLIC_KEY_PATH = Path(__file__).with_name("authorization_public_key.pem")
VALID_PROFILES = {"qa", "gestor"}

# Cifra o arquivo para evitar leitura casual. A assinatura é a garantia de
# integridade: a chave privada nunca é distribuída com o aplicativo.
_CIPHER_KEY = base64.urlsafe_b64encode(
    hashlib.sha256(b"quality-hub-authorization-v1").digest()
)


class AuthorizationError(ValueError):
    pass


@dataclass(frozen=True)
class Authorization:
    email: str
    profile: str
    expires_at: date | None


def normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    local, separator, domain = normalized.partition("@")
    if not local or not separator or not domain or "." not in domain:
        raise AuthorizationError("Informe um e-mail válido.")
    return normalized


def _canonical_claims(claims: dict) -> bytes:
    return json.dumps(
        claims,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _fernet() -> Fernet:
    return Fernet(_CIPHER_KEY)


def _load_public_key():
    try:
        content = PUBLIC_KEY_PATH.read_bytes()
    except FileNotFoundError as error:
        raise AuthorizationError("Chave pública da autorização não encontrada.") from error
    return serialization.load_pem_public_key(content)


def read_authorization(path: Path | None = None, today: date | None = None) -> Authorization:
    if path is None:
        from app.core.installation_access import enabled, read_installation_authorization
        if enabled():
            return read_installation_authorization(today=today)
    path = path or AUTHORIZATION_PATH
    try:
        envelope = json.loads(_fernet().decrypt(path.read_bytes()).decode("utf-8"))
    except FileNotFoundError as error:
        raise AuthorizationError("Arquivo de autorização não encontrado.") from error
    except (InvalidToken, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AuthorizationError("Arquivo de autorização inválido.") from error

    claims = envelope.get("claims")
    signature = envelope.get("signature")
    if not isinstance(claims, dict) or not isinstance(signature, str):
        raise AuthorizationError("Arquivo de autorização inválido.")

    try:
        _load_public_key().verify(base64.b64decode(signature), _canonical_claims(claims))
        email = normalize_email(str(claims["email"]))
        profile = str(claims["profile"]).lower()
        expires_at = date.fromisoformat(str(claims["expires_at"])) if claims["expires_at"] is not None else None
    except (KeyError, ValueError, TypeError, InvalidSignature) as error:
        raise AuthorizationError("Assinatura da autorização inválida.") from error

    if profile not in VALID_PROFILES:
        raise AuthorizationError("Perfil da autorização inválido.")
    if expires_at is not None and expires_at < (today or date.today()):
        raise AuthorizationError("A autorização expirou.")
    return Authorization(email=email, profile=profile, expires_at=expires_at)


def create_password(password: str) -> tuple[bytes, bytes]:
    salt = secrets.token_bytes(16)
    password_hash = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1
    )
    return password_hash, salt


def verify_password(password: str, password_hash: bytes, salt: bytes) -> bool:
    candidate = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1
    )
    return secrets.compare_digest(candidate, password_hash)


def generate_key_pair(private_key_path: Path, public_key_path: Path = PUBLIC_KEY_PATH) -> None:
    private_key_path.parent.mkdir(parents=True, exist_ok=True)
    private_key = Ed25519PrivateKey.generate()
    private_key_path.write_bytes(
        private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    public_key_path.write_bytes(
        private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )


def export_public_key(private_key_path: Path, public_key_path: Path = PUBLIC_KEY_PATH) -> None:
    private_key = serialization.load_pem_private_key(
        private_key_path.read_bytes(), password=None
    )
    public_key_path.write_bytes(
        private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )


def create_authorization_file(
    private_key_path: Path,
    output_path: Path,
    email: str,
    profile: str,
    expires_at: date | None,
) -> None:
    profile = profile.lower()
    if profile not in VALID_PROFILES:
        raise AuthorizationError("Perfil deve ser qa ou gestor.")
    private_key = serialization.load_pem_private_key(
        private_key_path.read_bytes(), password=None
    )
    claims = {
        "email": normalize_email(email),
        "profile": profile,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "version": 1,
    }
    envelope = {
        "claims": claims,
        "signature": base64.b64encode(private_key.sign(_canonical_claims(claims))).decode("ascii"),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(_fernet().encrypt(json.dumps(envelope).encode("utf-8")))
