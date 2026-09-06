/** Selectable planner models shown in the agent panel. */
export type ModelChoiceId =
  | 'openai-gpt'
  | 'groq-qwen'
  | 'nvidia-llama'
  | 'nvidia-nemotron'

export interface ModelOption {
  id: ModelChoiceId
  label: string
  provider: 'openai' | 'groq' | 'nvidia'
  description: string
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'openai-gpt',
    label: 'OpenAI GPT-4.1 Mini',
    provider: 'openai',
    description: 'OpenAI · mid-cost, strong agent planner',
  },
  {
    id: 'groq-qwen',
    label: 'Qwen3.6 27B',
    provider: 'groq',
    description: 'Groq · best Qwen chat model on GroqCloud',
  },
  {
    id: 'nvidia-llama',
    label: 'Llama 3.2 11B Vision',
    provider: 'nvidia',
    description: 'NVIDIA NIM · Meta Llama (hosted text+vision)',
  },
  {
    id: 'nvidia-nemotron',
    label: 'Nemotron 3 Super 120B',
    provider: 'nvidia',
    description: 'NVIDIA NIM · Nemotron agentic specialist',
  },
]

export const DEFAULT_MODEL_ID: ModelChoiceId = 'openai-gpt'

/** Map retired / renamed stored ids to current ones. */
export function normalizeModelChoiceId(value: string): ModelChoiceId | null {
  if (value === 'groq-openai') return 'openai-gpt'
  return isModelChoiceId(value) ? value : null
}

export function isModelChoiceId(value: string): value is ModelChoiceId {
  return MODEL_OPTIONS.some((o) => o.id === value)
}
