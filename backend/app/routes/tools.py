from fastapi import APIRouter, HTTPException

from ..schemas import ToolCallRequest, ToolCallResponse
from ..tools import run_tool

router = APIRouter(prefix='/agent', tags=['agent-tools'])


@router.post('/tool', response_model=ToolCallResponse)
async def call_tool(payload: ToolCallRequest) -> ToolCallResponse:
    try:
        result, details = run_tool(payload.tool, payload.page_markdown, payload.query)
        return ToolCallResponse(tool=payload.tool, ok=True, result=result, details=details)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        raise HTTPException(status_code=500, detail='Tool execution failed') from None
