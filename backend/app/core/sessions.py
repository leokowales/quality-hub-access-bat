"""Sessões opacas em memória do backend local; nenhum serviço externo."""
from dataclasses import dataclass
import hashlib
import secrets
import threading
from time import monotonic

from fastapi import HTTPException, Request

from app.core import authorization, database

SESSION_SECONDS = 12 * 60 * 60
_LOCK = threading.RLock()
_SESSIONS = {}


@dataclass(frozen=True)
class LocalSession:
    email: str
    profile: str
    database_path: str
    credentials: bytes
    expires: float


def require_qa(approval):
    if approval.profile != 'qa':
        raise authorization.AuthorizationError('Esta versão permite acesso somente ao perfil QA.')
    return approval


def _credentials(user):
    return hashlib.sha256(bytes(user['password_hash']) + bytes(user['password_salt'])).digest()


def _digest(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def bearer_token(request: Request):
    value = request.headers.get('authorization', '')
    scheme, _, token = value.partition(' ')
    if scheme.lower() != 'bearer' or len(token) != 43 or not token.isascii():
        return None
    return token


def create_session(approval, user):
    require_qa(approval)
    token = secrets.token_urlsafe(32)
    now = monotonic()
    path = str(database.DATABASE_PATH.resolve())
    with _LOCK:
        # Um login novo substitui a sessão anterior desta instalação.
        for key, session in list(_SESSIONS.items()):
            if session.expires <= now or session.database_path == path:
                del _SESSIONS[key]
        _SESSIONS[_digest(token)] = LocalSession(
            approval.email, approval.profile, path, _credentials(user), now + SESSION_SECONDS,
        )
    return token


def revoke_session(token):
    if token:
        with _LOCK:
            _SESSIONS.pop(_digest(token), None)


def require_session(request: Request):
    token = bearer_token(request)
    with _LOCK:
        session = _SESSIONS.get(_digest(token)) if token else None
    if (session is None or session.expires <= monotonic()
            or session.database_path != str(database.DATABASE_PATH.resolve())):
        revoke_session(token)
        raise HTTPException(401, 'Entre no QualityHub para continuar.')
    try:
        approval = require_qa(authorization.read_authorization())
    except authorization.AuthorizationError as error:
        revoke_session(token)
        raise HTTPException(403, str(error)) from error
    with database.conectar_banco() as db:
        user = db.execute('SELECT email,profile,password_hash,password_salt FROM acesso_local WHERE id=1').fetchone()
    if (not user or session.email != approval.email or session.profile != approval.profile
            or user['email'] != session.email or user['profile'] != session.profile
            or not secrets.compare_digest(_credentials(user), session.credentials)):
        revoke_session(token)
        raise HTTPException(401, 'O acesso local mudou. Entre novamente no QualityHub.')
    return session
