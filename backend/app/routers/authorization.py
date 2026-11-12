from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, Field

from app.core import installation_access
from app.core.sessions import (SESSION_SECONDS, bearer_token, create_session, require_qa,
                               require_session, revoke_session)

from app.core.authorization import (
    AuthorizationError,
    create_password,
    normalize_email,
    read_authorization,
    verify_password,
)
from app.core.database import conectar_banco
from app.schemas.authorization import AccessCredentials, AccessSession, AuthorizationStatus, LocalProfile


router = APIRouter(prefix="/authorization", tags=["Autorização"])


class ActivationRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


@router.get('/activation')
def activation_state():
    return {'enabled': installation_access.enabled()}


@router.post('/activation/request')
def activation_request(payload: ActivationRequest):
    if not installation_access.enabled():
        raise HTTPException(409, 'O canal de liberações ainda não foi configurado pelo responsável.')
    try:
        return installation_access.request_activation(payload.email)
    except AuthorizationError as error:
        raise HTTPException(403, str(error)) from error


@router.post('/activation/check')
def activation_check():
    if not installation_access.enabled():
        raise HTTPException(409, 'O canal de liberações ainda não foi configurado pelo responsável.')
    try:
        installation_access.read_installation_authorization(force=True)
        return {'approved': True}
    except AuthorizationError as error:
        raise HTTPException(403, str(error)) from error


def _profile_context():
    authorization = _authorization_or_error()
    user = _local_user()
    if not user or user['email'] != authorization.email or user['profile'] != authorization.profile:
        raise HTTPException(403, 'Configure o acesso local antes de editar o perfil.')
    return authorization


def _profile_table(db):
    db.execute('''CREATE TABLE IF NOT EXISTS perfil_local (
        email TEXT PRIMARY KEY, nome TEXT NOT NULL, cargo TEXT NOT NULL DEFAULT '', foto TEXT
    )''')


@router.get('/profile', dependencies=[Depends(require_session)])
def consultar_perfil():
    authorization = _profile_context()
    with conectar_banco() as db:
        _profile_table(db)
        row = db.execute('SELECT nome,cargo FROM perfil_local WHERE email=?', (authorization.email,)).fetchone()
    return {'email': authorization.email, 'nome': row['nome'] if row else '',
            'cargo': row['cargo'] if row else ''}


@router.put('/profile', dependencies=[Depends(require_session)])
def salvar_perfil(payload: LocalProfile):
    authorization = _profile_context()
    nome, cargo = payload.nome.strip(), payload.cargo.strip()
    if not nome:
        raise HTTPException(422, 'Informe seu nome.')
    with conectar_banco() as db:
        _profile_table(db)
        db.execute('''INSERT INTO perfil_local(email,nome,cargo,foto) VALUES (?,?,?,?)
            ON CONFLICT(email) DO UPDATE SET nome=excluded.nome,cargo=excluded.cargo,foto=excluded.foto''',
            (authorization.email, nome, cargo, None))
    return {'email': authorization.email, 'nome': nome, 'cargo': cargo}


def _authorization_or_error():
    try:
        return require_qa(read_authorization())
    except AuthorizationError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error


def _local_user():
    with conectar_banco() as connection:
        return connection.execute(
            "SELECT email, profile, password_hash, password_salt, onboarding_concluido FROM acesso_local WHERE id = 1"
        ).fetchone()


@router.get("/status", response_model=AuthorizationStatus)
def status(request: Request):
    try:
        authorization = require_qa(read_authorization())
    except AuthorizationError as error:
        revoke_session(bearer_token(request))
        return AuthorizationStatus(valid=False, detail=str(error))
    user = _local_user()
    with conectar_banco() as connection:
        has_data = bool(
            connection.execute("SELECT 1 FROM projetos LIMIT 1").fetchone()
            or connection.execute("SELECT 1 FROM iteracoes LIMIT 1").fetchone()
        )
    return AuthorizationStatus(
        valid=True,
        has_local_user=user is not None,
        onboarding_pending=bool(user and not user["onboarding_concluido"] and not has_data),
        email=authorization.email,
        profile=authorization.profile,
        expires_at=authorization.expires_at.isoformat() if authorization.expires_at else None,
    )


@router.post("/setup", response_model=AccessSession, status_code=201)
def setup(credentials: AccessCredentials):
    authorization = _authorization_or_error()
    try:
        email = normalize_email(credentials.email)
    except AuthorizationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if email != authorization.email:
        raise HTTPException(status_code=403, detail="O e-mail não corresponde à autorização desta instalação.")
    password_hash, salt = create_password(credentials.password)
    with conectar_banco() as connection:
        if connection.execute("SELECT 1 FROM acesso_local WHERE id = 1").fetchone():
            raise HTTPException(status_code=409, detail="O acesso local já foi configurado.")
        connection.execute(
            "INSERT INTO acesso_local (id, email, profile, password_hash, password_salt, onboarding_concluido, criada_em) VALUES (1, ?, ?, ?, ?, 0, datetime('now'))",
            (authorization.email, authorization.profile, password_hash, salt),
        )
    return _new_session(authorization)


@router.post("/onboarding/zero", status_code=204, dependencies=[Depends(require_session)])
def start_from_zero():
    authorization = _authorization_or_error()
    with conectar_banco() as connection:
        result = connection.execute(
            "UPDATE acesso_local SET onboarding_concluido = 1 WHERE id = 1 AND email = ? AND profile = ?",
            (authorization.email, authorization.profile),
        )
    if not result.rowcount:
        raise HTTPException(status_code=401, detail="Acesso local inválido.")


@router.post("/login", response_model=AccessSession)
def login(credentials: AccessCredentials):
    authorization = _authorization_or_error()
    try:
        email = normalize_email(credentials.email)
    except AuthorizationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    user = _local_user()
    if not user or email != authorization.email or user["email"] != authorization.email:
        raise HTTPException(status_code=401, detail="Credenciais inválidas.")
    if user["profile"] != authorization.profile or not verify_password(
        credentials.password, user["password_hash"], user["password_salt"]
    ):
        raise HTTPException(status_code=401, detail="Credenciais inválidas.")
    return _new_session(authorization)


def _new_session(authorization):
    return AccessSession(email=authorization.email, profile=authorization.profile,
                         access_token=create_session(authorization, _local_user()),
                         expires_in=SESSION_SECONDS)


@router.get('/session')
def current_session(session=Depends(require_session)):
    return {'email': session.email, 'profile': session.profile}


@router.post('/logout', status_code=204)
def logout(request: Request):
    # Deve encerrar também com licença expirada/revogada; nunca exige aprovação.
    revoke_session(bearer_token(request))
