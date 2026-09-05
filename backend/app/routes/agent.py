from fastapi import APIRouter, HTTPException

from ..llm import plan_actions
from ..schemas import AgentRunRequest, AgentRunResponse

router = APIRouter(prefix='/agent', tags=['agent'])


@router.post('/run', response_model=AgentRunResponse)
async def run_agent(payload: AgentRunRequest) -> AgentRunResponse:
    try:
        return await plan_actions(
            task=payload.task,
            page_markdown=payload.page_markdown,
            page_url=payload.page_url,
        )
    except Exception as exc:  # noqa: BLE001 — surface provider errors to client
        raise HTTPException(status_code=502, detail=str(exc)) from exc
