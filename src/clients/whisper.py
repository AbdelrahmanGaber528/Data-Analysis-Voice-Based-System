from faster_whisper import WhisperModel


class WhisperClient:
    
    def __init__(self, model_size: str, device: str, compute_type: str):

        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)



    def transcribe(self, audio_path: str, language: str | None = None) -> dict:
        
        segments, info = self.model.transcribe( audio_path, language=language, vad_filter=True )
       
        text = " ".join(seg.text.strip() for seg in segments).strip()
        
        return {
            "text": text,
            "language": info.language,
            "duration": round(info.duration, 2),
        }