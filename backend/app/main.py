from app.core.storage import load_environment

# Carregar antes dos módulos que resolvem caminhos/configurações.
# Variáveis do processo têm prioridade sobre os arquivos locais.
load_environment()
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from app.core.sessions import require_session

from app.routers.jira import router as jira_router
from app.routers.iterations import router as iterations_router
from app.routers.configuration import router as configuration_router
from app.core.database import inicializar_banco
from app.routers.sprint_ativa import router as sprint_ativa_router
from app.routers.authorization import router as authorization_router
from app.routers.local_updates import router as local_updates_router


app = FastAPI(
    title="Quality Hub API",
    description="Backend da plataforma Quality Hub",
    version="0.2.0",
)


@app.middleware('http')
async def validate_local_session(request, call_next):
    public = {
        ('GET', '/health'), ('GET', '/authorization/status'), ('GET', '/authorization/activation'),
        ('POST', '/authorization/activation/request'), ('POST', '/authorization/activation/check'),
        ('POST', '/authorization/setup'), ('POST', '/authorization/login'), ('POST', '/authorization/logout'),
    }
    if request.method != 'OPTIONS' and (request.method, request.url.path) not in public:
        try:
            request.state.session = await run_in_threadpool(require_session, request)
        except HTTPException as error:
            return JSONResponse(status_code=error.status_code, content={'detail': error.detail},
                                headers={'X-QualityHub-Session': 'invalid',
                                         **({'WWW-Authenticate': 'Bearer'} if error.status_code == 401 else {})})
    updates = getattr(app.state, 'desktop_updates', None)
    if updates and updates.applying and request.url.path != '/desktop-updates/status':
        return JSONResponse(status_code=503, content={'detail': 'O QualityHub está encerrando para instalar a atualização.'})
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["X-QualityHub-Session"],
)


app.include_router(jira_router)
app.include_router(iterations_router)
app.include_router(sprint_ativa_router)
app.include_router(configuration_router)
app.include_router(authorization_router)
app.include_router(local_updates_router)

@app.on_event("startup")
def iniciar_aplicacao():
    inicializar_banco()


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "quality-hub-api",
    }
