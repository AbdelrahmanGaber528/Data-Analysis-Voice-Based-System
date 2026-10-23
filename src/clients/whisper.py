import subprocess
import numpy as np
from faster_whisper import WhisperModel


def load_audio(path: str, sr: int = 16000):
    
    cmd = ["ffmpeg", "-nostdin", "-i", path,
           "-f", "s16le", "-ac", "1", "-ar", str(sr), "-"]
    
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    
    return np.frombuffer(out, np.int16).astype(np.float32) / 32768.0


class WhisperClient:
    
    def __init__(self, model_size, device, compute_type, hf_token=None):
        
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)


    def transcribe(self, audio_path: str, language: str | None = None):
        
        audio = load_audio(audio_path)
        
        segments, info = self.model.transcribe(audio, language=language, vad_filter=True)
        
        text = " ".join(seg.text.strip() for seg in segments).strip()
        
        return {"text": text, 
                "language": info.language,
                "duration": round(info.duration, 2)
                }