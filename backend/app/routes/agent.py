import logging

from fastapi import APIRouter, HTTPException

from ..llm import LlmProviderError, plan_actions
from ..schemas import AgentRunRequest, AgentRunResponse

logger = logging.getLogger('sih.agent')

router = APIRouter(prefix='/agent', tags=['agent'])


@router.post('/run', response_model=AgentRunResponse)
async def run_agent(payload: AgentRunRequest) -> AgentRunResponse:
    logger.info(
        'agent.run start task=%r url=%r step=%s model=%s markdown_chars=%d prior=%d',
        payload.task[:120],
        payload.page_url,
        payload.step_index,
        payload.model_id or 'default',
        len(payload.page_markdown or ''),
        len(payload.prior_results or []),
    )
    try:
        result = await plan_actions(
            task=payload.task,
            page_markdown=payload.page_markdown,
            page_url=payload.page_url,
            step_index=payload.step_index,
            prior_results=payload.prior_results,
            prior_reasoning=payload.prior_reasoning,
            model_id=payload.model_id,
            force_answer=payload.force_answer,
        )
        logger.info(
            'agent.run ok actions=%d done=%s answer=%r reasoning=%r',
            len(result.actions),
            result.done,
            (result.answer or '')[:160],
            (result.reasoning or '')[:160],
        )
        return result
    except LlmProviderError as exc:
        logger.warning('agent.run provider_error: %s', exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception:
        logger.exception('agent.run unexpected_error')
        raise HTTPException(
            status_code=502,
            detail='The planning service failed. Please try again.',
        ) from None
