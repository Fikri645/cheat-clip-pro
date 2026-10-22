import logging
import json
import re
from typing import List, Dict, Any, Optional
import httpx
from backend.schemas.analyze import VideoAnalysis

logger = logging.getLogger("cheatclip.openrouter")

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# Curated list of popular, high-capability text LLMs for transcript analysis
POPULAR_OPENROUTER_MODELS = [
    {
        "id": "google/gemini-2.5-flash",
        "name": "Google: Gemini 2.5 Flash",
        "context_length": 1000000,
        "description": "Recommended - ultra fast, 1M context window, ideal for long transcripts",
        "family": "google",
        "recommended": True
    },
    {
        "id": "google/gemini-2.0-flash-001",
        "name": "Google: Gemini 2.0 Flash",
        "context_length": 1000000,
        "description": "High-speed multimodal LLM with 1M context",
        "family": "google",
        "recommended": True
    },
    {
        "id": "anthropic/claude-3.5-sonnet",
        "name": "Anthropic: Claude 3.5 Sonnet",
        "context_length": 200000,
        "description": "State-of-the-art reasoning, viral hook generation & nuanced comprehension",
        "family": "anthropic",
        "recommended": True
    },
    {
        "id": "anthropic/claude-3.5-haiku",
        "name": "Anthropic: Claude 3.5 Haiku",
        "context_length": 200000,
        "description": "Blazing fast inference, cost-effective transcript analysis",
        "family": "anthropic"
    },
    {
        "id": "deepseek/deepseek-chat",
        "name": "DeepSeek: DeepSeek V3",
        "context_length": 64000,
        "description": "Exceptional value and high quality viral scoring",
        "family": "deepseek",
        "recommended": True
    },
    {
        "id": "meta-llama/llama-3.3-70b-instruct",
        "name": "Meta: Llama 3.3 70B Instruct",
        "context_length": 128000,
        "description": "Top-tier open weights model for instruction following",
        "family": "meta-llama"
    },
    {
        "id": "openai/gpt-4o-mini",
        "name": "OpenAI: GPT-4o Mini",
        "context_length": 128000,
        "description": "Fast and intelligent lightweight flagship",
        "family": "openai"
    },
    {
        "id": "openai/gpt-4o",
        "name": "OpenAI: GPT-4o",
        "context_length": 128000,
        "description": "OpenAI flagship intelligence",
        "family": "openai"
    },
    {
        "id": "qwen/qwen-2.5-72b-instruct",
        "name": "Qwen: Qwen 2.5 72B Instruct",
        "context_length": 128000,
        "description": "Outstanding multilingual & Indonesian transcript comprehension",
        "family": "qwen"
    },
    {
        "id": "mistralai/mistral-large-2411",
        "name": "Mistral: Mistral Large 2",
        "context_length": 128000,
        "description": "Enterprise-grade reasoning and reasoning quality",
        "family": "mistralai"
    },
    {
        "id": "google/gemini-2.5-pro",
        "name": "Google: Gemini 2.5 Pro",
        "context_length": 1000000,
        "description": "Maximum reasoning depth for complex podcasts and long interviews",
        "family": "google"
    }
]


def get_openrouter_fallback_chain(requested_model: str) -> List[str]:
    """
    Builds a fallback chain within the SAME model family (e.g., Claude -> Claude, Gemini -> Gemini, Llama -> Llama)
    to prevent cross-family mismatches per user guidelines.
    """
    requested_model = (requested_model or "google/gemini-2.5-flash").strip()
    chain = [requested_model]
    req_lower = requested_model.lower()

    if "google" in req_lower or "gemini" in req_lower:
        family_candidates = [
            "google/gemini-2.5-flash",
            "google/gemini-2.0-flash-001",
            "google/gemini-flash-1.5",
            "google/gemini-2.5-pro"
        ]
    elif "anthropic" in req_lower or "claude" in req_lower:
        family_candidates = [
            "anthropic/claude-3.5-sonnet",
            "anthropic/claude-3.5-haiku",
            "anthropic/claude-3-haiku",
            "anthropic/claude-3-opus"
        ]
    elif "meta-llama" in req_lower or "llama" in req_lower:
        family_candidates = [
            "meta-llama/llama-3.3-70b-instruct",
            "meta-llama/llama-3.1-70b-instruct",
            "meta-llama/llama-3.1-8b-instruct"
        ]
    elif "openai" in req_lower or "gpt" in req_lower:
        family_candidates = [
            "openai/gpt-4o-mini",
            "openai/gpt-4o",
            "openai/gpt-4-turbo"
        ]
    elif "deepseek" in req_lower:
        family_candidates = [
            "deepseek/deepseek-chat",
            "deepseek/deepseek-coder"
        ]
    elif "qwen" in req_lower:
        family_candidates = [
            "qwen/qwen-2.5-72b-instruct",
            "qwen/qwen-2.5-32b-instruct",
            "qwen/qwen-2.5-7b-instruct"
        ]
    elif "mistral" in req_lower:
        family_candidates = [
            "mistralai/mistral-large-2411",
            "mistralai/mistral-small-2409",
            "mistralai/mistral-7b-instruct"
        ]
    else:
        family_candidates = []

    for cand in family_candidates:
        if cand not in chain:
            chain.append(cand)

    return chain[:3]


async def fetch_openrouter_available_models(api_key: str = "") -> List[Dict[str, Any]]:
    """
    Fetches models from OpenRouter, filtering exclusively for text-generation LLMs
    with adequate context window (>=16k) suitable for long video transcript analysis.
    """
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(OPENROUTER_MODELS_URL, headers=headers)
            if resp.status_code == 200:
                raw_models = resp.json().get("data", [])
                
                # Exclude image/audio/video generation models
                excluded_keywords = [
                    "image", "flux", "diffusion", "dall-e", "midjourney", 
                    "audio", "tts", "whisper", "embedding", "rerank", "moderation", "vision-preview"
                ]

                filtered_map: Dict[str, Dict[str, Any]] = {}
                for m in raw_models:
                    m_id = m.get("id", "")
                    m_name = m.get("name", m_id)
                    context_len = m.get("context_length") or 0
                    
                    if context_len < 16000:
                        continue
                    
                    m_id_lower = m_id.lower()
                    if any(ex in m_id_lower for ex in excluded_keywords):
                        continue
                    
                    family = m_id.split("/")[0] if "/" in m_id else "other"
                    filtered_map[m_id] = {
                        "id": m_id,
                        "name": m_name,
                        "context_length": context_len,
                        "description": m.get("description", "")[:120],
                        "family": family,
                        "recommended": False
                    }

                # Prioritize curated list at the top
                result_list: List[Dict[str, Any]] = []
                for pop in POPULAR_OPENROUTER_MODELS:
                    if pop["id"] in filtered_map:
                        merged = {**filtered_map[pop["id"]], **pop}
                        result_list.append(merged)
                        del filtered_map[pop["id"]]
                    else:
                        result_list.append(pop)

                # Append other high context models
                for remaining_model in list(filtered_map.values())[:30]:
                    result_list.append(remaining_model)

                return result_list
    except Exception as exc:
        logger.warning(f"Error fetching live OpenRouter models: {exc}. Returning curated defaults.")

    return POPULAR_OPENROUTER_MODELS


async def analyze_with_openrouter(
    api_key: str,
    model_name: str,
    prompt: str,
    timeout: float = 120.0
) -> VideoAnalysis:
    """
    Executes a structured JSON video analysis request against OpenRouter.
    """
    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "HTTP-Referer": "https://cheatclip.pro",
        "X-Title": "Cheat Clip Pro",
        "Content-Type": "application/json"
    }

    system_instruction = (
        "You are an expert viral video clipper and AI retention analyst. "
        "Analyze the provided video transcript and select the highest engagement clips. "
        "Strict rules:\n"
        "1. STRICT ZERO-TRANSLATION RULE: Output titles, key_quotes, and summary in the EXACT SAME LANGUAGE as the video transcript.\n"
        "2. ZERO FIRST-PERSON PRONOUNS: Never use 'I', 'me', 'my', 'aku', 'saya' in titles or suggestions. Attribute the quote or insight to the speaker/host by name or use third-person objective framing.\n"
        "3. You MUST respond ONLY with a valid JSON object matching this schema:\n"
        "{\n"
        '  "summary": "1-2 sentence video summary in the exact transcript language, followed by 2-4 hashtags",\n'
        '  "clips": [\n'
        "    {\n"
        '      "title": "Snappy title under 8 words attributing speaker",\n'
        '      "start_time": 10.0,\n'
        '      "end_time": 45.0,\n'
        '      "hook_time": 12.0,\n'
        '      "virality_score": 92,\n'
        '      "key_quotes": ["quote 1", "quote 2"],\n'
        '      "title_suggestion": "Alternative viral hook title",\n'
        '      "caption_suggestion": "Social media post caption",\n'
        '      "hashtag_suggestion": "#hashtag1 #hashtag2"\n'
        "    }\n"
        "  ]\n"
        "}"
    )

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt}
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(OPENROUTER_API_URL, headers=headers, json=payload)
        
        if resp.status_code != 200:
            err_text = resp.text
            try:
                err_json = resp.json()
                err_msg = err_json.get("error", {}).get("message", err_text)
            except Exception:
                err_msg = err_text
            raise RuntimeError(f"OpenRouter API Error ({resp.status_code}): {err_msg}")

        data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            raise ValueError("OpenRouter returned empty choices array.")

        content = choices[0].get("message", {}).get("content", "").strip()
        if not content:
            raise ValueError("OpenRouter returned empty message content.")

        # Robust JSON extraction
        parsed_dict = None
        try:
            parsed_dict = json.loads(content)
        except Exception:
            # Check for ```json ... ``` code fence
            fence_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', content)
            if fence_match:
                parsed_dict = json.loads(fence_match.group(1))
            else:
                # Find outermost { ... }
                bracket_match = re.search(r'\{[\s\S]*\}', content)
                if bracket_match:
                    parsed_dict = json.loads(bracket_match.group(0))
                else:
                    raise ValueError(f"Could not parse valid JSON from OpenRouter output: {content[:200]}...")

        # Coerce and validate through VideoAnalysis model
        return VideoAnalysis.model_validate(parsed_dict)
