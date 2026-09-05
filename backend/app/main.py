from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes.agent import router as agent_router

load_dotenv()

app = FastAPI(
    title='SIH Browser AI Agent',
    description='Receives sanitized page markdown + task; returns JSON browser actions.',
    version='0.1.0',
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(agent_router)


@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}
