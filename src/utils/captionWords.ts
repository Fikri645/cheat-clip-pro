import type { CaptionWord } from '../types';

export function captionValidation(words:CaptionWord[], duration:number):string|undefined {
  let end=0;
  for(let i=0;i<words.length;i++) {
    const word=words[i];
    if(!word.word.trim())return `Word ${i+1}: text is required.`;
    if(!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start<0 || word.end<=word.start || word.end>duration+.001)
      return `Word ${i+1}: use a start and end inside the clip (0–${duration.toFixed(2)}s).`;
    if(word.start<end-.001)return `Word ${i+1}: timings must be ordered and must not overlap.`;
    end=word.end;
  }
}
