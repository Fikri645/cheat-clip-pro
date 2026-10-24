"""Edited word times use seconds relative to the clip, before presentation styling."""
import math
from pydantic import BaseModel, Field, model_validator


class CaptionWord(BaseModel):
    word: str = Field(min_length=1, max_length=300)
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(gt=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def valid_word(self):
        if not self.word.strip() or self.end <= self.start:
            raise ValueError("A caption needs text and end > start")
        return self


def validate_words(words, duration):
    previous_end = 0.0
    for item in words:
        word = CaptionWord.model_validate(item)
        if word.start < previous_end - 0.001 or word.end > duration + 0.001:
            raise ValueError("Caption times must be ordered, non-overlapping, and inside the clip")
        previous_end = word.end
    return words
