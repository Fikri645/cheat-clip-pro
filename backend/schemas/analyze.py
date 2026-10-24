from typing import List, Optional, Union
from pydantic import BaseModel, Field

class QualityScores(BaseModel):
    hook: int = Field(ge=0, le=100, description="Strength of the opening hook")
    context: int = Field(ge=0, le=100, description="Standalone context and clarity")
    payoff: int = Field(ge=0, le=100, description="Completeness and payoff of the ending")
    signal: Optional[int] = Field(None, ge=0, le=100)

class ViralClip(BaseModel):
    quality_scores: Optional[QualityScores] = None
    score_source: str = "legacy"
    selection_reason: str = ""
    score_note: str = "Selection score, not a probability of going viral."

    title: str = Field(description="Catchy clip title, max 8 words. MUST NEVER use first-person pronouns ('I', 'me', 'my', 'saya', 'aku'). Attribute to the speaker/host by name, role, or use objective framing.")
    start_time: float = Field(description="Clip start in seconds, aligned to a sentence boundary")
    end_time: float = Field(description="Clip end in seconds, aligned to a sentence boundary")
    hook_time: float = Field(description="Absolute timestamp in seconds from video start where the potential hook occurs inside this clip range (must be >= start_time and <= end_time)")
    virality_score: int = Field(description="Virality score 1-100")
    key_quotes: List[str] = Field(description="1-2 key quotes from the clip")
    transcript: str = Field(description="Spoken text of the clip")
    title_suggestion: str = Field(default="", description="Catchy alternative title suggestion. MUST NEVER use first-person pronouns ('I', 'me', 'my'). Attribute to speaker or objective topic.")
    caption_suggestion: str = Field(default="", description="Engaging social media caption suggestion attributing quotes or insights to the speaker.")
    hashtag_suggestion: str = Field(default="", description="Relevant hashtags suggestion (e.g. #hashtag1 #hashtag2)")

class ViralClipGemini(BaseModel):
    quality_scores: Optional[QualityScores] = Field(None, description="Evaluate hook, standalone context, and ending payoff separately, 0-100")
    selection_reason: str = Field("", description="Brief factual explanation of why this clip was selected, in the video's language")

    title: str = Field(description="Catchy clip title, max 8 words, in the EXACT SAME LANGUAGE as the video transcript (STRICT ZERO-TRANSLATION RULE: English is English, Indonesian is Indonesian, Spanish is Spanish). NEVER use first-person pronouns ('I', 'me', 'my', 'myself', 'aku', 'saya'). Attribute to the person speaking by name, host/guest title, or use third-person objective framing so it does not look like the user's opinion.")
    start_time: float = Field(description="Clip start in seconds, aligned to a sentence boundary")
    end_time: float = Field(description="Clip end in seconds, aligned to a sentence boundary")
    hook_time: float = Field(description="Absolute timestamp in seconds from video start where the potential hook occurs inside this clip range (must be >= start_time and <= end_time)")
    virality_score: int = Field(description="Virality score 1-100")
    key_quotes: List[str] = Field(description="1-2 verbatim quotes directly spoken in the clip, in the original language of the video without translation")
    title_suggestion: str = Field(default="", description="Catchy alternative title suggestion in the EXACT SAME LANGUAGE as the video transcript (DO NOT translate). STRICT RULE: NEVER use first-person ('I', 'me', 'my', 'saya', 'aku'). Attribute to the speaker/host/guest by name or topic.")
    caption_suggestion: str = Field(default="", description="Engaging social media caption suggestion written in the EXACT SAME LANGUAGE as the video transcript (DO NOT translate to any other language), attributing insights or story to the speaker.")
    hashtag_suggestion: str = Field(default="", description="Relevant hashtags suggestion in the SAME LANGUAGE as the video transcript (e.g. #hashtag1 #hashtag2)")

class VideoAnalysis(BaseModel):
    summary: str = Field(description="1-2 sentence video summary in the EXACT SAME LANGUAGE as the video transcript (STRICT ZERO-TRANSLATION RULE: English stays English, Indonesian stays Indonesian, Spanish stays Spanish), followed by 2-4 relevant hashtags")
    clips: List[ViralClipGemini] = Field(description="List of viral clip candidates, sorted by virality_score desc")

class AnalyzeRequest(BaseModel):
    url: str = Field(..., description="YouTube video URL")
    duration: str = Field("30s", description="Target clip duration: '15s', '30s', '60s', or 'auto'")
    api_key: Optional[str] = Field(None, description="Optional custom Gemini or fallback API key provided by the user")
    api_provider: Optional[str] = Field("gemini", description="AI provider: 'gemini' or 'openrouter'")
    openrouter_key: Optional[str] = Field(None, description="Optional OpenRouter API key provided by the user")
    openrouter_model: Optional[str] = Field(None, description="Preferred OpenRouter model name (e.g. 'google/gemini-2.5-flash')")
    model: Optional[str] = Field("gemini-2.5-flash", description="Preferred model name")
    custom_prompt: Optional[str] = Field(None, description="Optional custom focus prompt for clips search")
    range_start: Optional[float] = Field(None, description="Search range start in seconds")
    range_end: Optional[float] = Field(None, description="Search range end in seconds")
    subtitles: Optional[str] = Field(None, description="Optional manual subtitles text (SRT or TXT)")
    subtitles_filename: Optional[str] = Field(None, description="Optional manual subtitles filename")
    target_clip_count: Optional[Union[int, str]] = Field(None, description="Optional target number of clips or 'auto'")
    proxy: Optional[str] = Field(None, description="Optional custom proxy URL")
    cookies: Optional[str] = Field(None, description="Optional user YouTube cookies from browser LocalStorage")
    transcript_language: Optional[str] = Field("id", description="Target transcript language for YouTube auto transcripts: 'id' or 'en'")

class HeatmapPoint(BaseModel):
    start_time: float
    end_time: float
    value: float

class TranscriptLine(BaseModel):
    start: float
    end: float
    text: str
    engagement: Optional[float] = None

class AnalyzeResponse(BaseModel):
    video_id: str
    title: str
    channel: Optional[str] = None
    duration: float
    heatmap: List[HeatmapPoint]
    heatmap_source: str = "none"
    analysis_method: str = "ai"
    summary: str
    clips: List[ViralClip]
    transcript: Optional[List[TranscriptLine]] = None
    model: Optional[str] = None
    video_url: Optional[str] = None
    source_type: Optional[str] = "youtube"
