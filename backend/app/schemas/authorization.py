from pydantic import BaseModel, Field


class AccessCredentials(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class AuthorizationStatus(BaseModel):
    valid: bool
    has_local_user: bool = False
    onboarding_pending: bool = False
    email: str | None = None
    profile: str | None = None
    expires_at: str | None = None
    detail: str | None = None


class AccessSession(BaseModel):
    email: str
    profile: str
    access_token: str
    token_type: str = 'bearer'
    expires_in: int


class LocalProfile(BaseModel):
    nome: str = Field(min_length=1, max_length=160)
    cargo: str = Field(default="", max_length=100)
