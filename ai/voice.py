"""Kixo Agent's voice, fully self-hosted: no outside service and no browser speech.

Speaking: Kokoro (open model, Apache 2.0) through onnxruntime, on the GPU when CUDA is
there, else the CPU. Listening: Whisper (open model, MIT) through faster-whisper. English
only for now. Lines are cached, so an alert spoken to many viewers of one coin is made
once.

Run:  E:\\KixoAI\\voice-venv\\Scripts\\python.exe ai\\voice.py
POST /tts  {"text": "...", "voice": "am_michael", "speed": 1.05}  -> audio/wav (24 kHz mono)
POST /stt  raw audio body (webm/ogg/wav from the browser)          -> {"text": "..."}
GET  /health -> {"ok": true, "tts": "cuda"|"cpu", "stt": "cuda"|"cpu"|null, "voices": [...]}
Listens on 127.0.0.1 only: the gateway is the way in (gateway voice.rs).
"""

import glob
import hashlib
import io
import json
import os
import re
import sys
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = os.environ.get("KIXO_VOICE_MODELS", "E:/KixoAI/voice-models")
PORT = int(os.environ.get("KIXO_VOICE_PORT", "8091"))
STT_MODEL = os.environ.get("KIXO_STT_MODEL", "small.en")
MAX_TEXT = 600
MAX_AUDIO = 4 << 20
# Voices offered in the app (English): calm and clear ones first.
VOICES = ["am_michael", "af_heart", "bm_george", "af_bella", "am_adam", "bf_emma", "am_fenrir", "af_nicole"]


def _cuda_dlls():
    """Puts the CUDA and cuDNN libraries that pip installed (nvidia-* packages) on the DLL
    search path, so onnxruntime and CTranslate2 find them without a system CUDA."""
    for base in sys.path:
        for d in glob.glob(os.path.join(base, "nvidia", "*", "bin")) + glob.glob(os.path.join(base, "nvidia", "*", "bin", "x86_64")):
            try:
                os.add_dll_directory(d)
            except (OSError, AttributeError):
                pass
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


_cuda_dlls()

import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
import soundfile as sf  # noqa: E402
from kokoro_onnx import Kokoro  # noqa: E402

try:
    ort.preload_dlls()
except Exception:
    pass


def _tts():
    providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(f"{MODELS}/kokoro-v1.0.onnx", sess_options=opts, providers=providers)
    used = "cuda" if "CUDAExecutionProvider" in session.get_providers() else "cpu"
    return Kokoro.from_session(session, f"{MODELS}/voices-v1.0.bin"), used


kokoro, TTS_DEVICE = _tts()
# One synthesis at a time on the GPU; the cache answers repeats at once.
tts_lock = threading.Lock()
cache: "OrderedDict[str, bytes]" = OrderedDict()
CACHE_MAX = 400

stt = None
STT_DEVICE = None
stt_lock = threading.Lock()


def load_stt():
    """Whisper loads on first use (it is only needed once someone talks)."""
    global stt, STT_DEVICE
    if stt is not None:
        return stt
    from faster_whisper import WhisperModel

    for device, compute in (("cuda", "float16"), ("cuda", "int8_float16"), ("cpu", "int8")):
        try:
            stt = WhisperModel(STT_MODEL, device=device, compute_type=compute, download_root=f"{MODELS}/whisper")
            STT_DEVICE = device
            print(f"whisper {STT_MODEL} on {device} ({compute})", flush=True)
            return stt
        except Exception as e:  # no CUDA, or not enough memory: next option
            print(f"whisper on {device}/{compute} failed: {str(e)[:160]}", flush=True)
    raise RuntimeError("whisper could not load")


# Numbers and symbols read the way a trader says them.
def speakable(text: str) -> str:
    t = text.strip()
    t = re.sub(r"(\d+(?:\.\d+)?)%\+", r"\1 percent or more", t)
    t = re.sub(r"\$(\d[\d,]*\.?\d*)\s*([KMB])\b", lambda m: f"{m.group(1)} {dict(K='thousand', M='million', B='billion')[m.group(2)]} dollars", t)
    t = re.sub(r"\$(\d[\d,]*\.?\d*)", r"\1 dollars", t)
    t = re.sub(r"(\d)\s*([KMB])\b", lambda m: f"{m.group(1)} {dict(K='thousand', M='million', B='billion')[m.group(2)]}", t)
    t = re.sub(r"(\d+(?:\.\d+)?)x\b", r"\1 times", t)
    t = re.sub(r"\bSOL\b", "sol", t)
    t = t.replace("%", " percent").replace("&", " and ").replace("+", "plus ")
    t = re.sub(r"(?<=\s)-(?=\d)", "minus ", t)
    return re.sub(r"\s+", " ", t)[:MAX_TEXT]


def synth(text: str, voice: str, speed: float) -> bytes:
    voice = voice if voice in VOICES else VOICES[0]
    speed = min(1.4, max(0.8, speed))
    key = hashlib.sha1(f"{voice}|{speed:.2f}|{text}".encode()).hexdigest()
    hit = cache.get(key)
    if hit is not None:
        cache.move_to_end(key)
        return hit
    with tts_lock:
        lang = "en-gb" if voice.startswith("b") else "en-us"
        audio, sr = kokoro.create(speakable(text), voice=voice, speed=speed, lang=lang)
    buf = io.BytesIO()
    sf.write(buf, np.asarray(audio, dtype=np.float32), sr, format="WAV", subtype="PCM_16")
    data = buf.getvalue()
    cache[key] = data
    while len(cache) > CACHE_MAX:
        cache.popitem(last=False)
    return data


def decode(audio: bytes) -> np.ndarray:
    """Any browser recording (webm/opus, ogg, wav) to 16 kHz mono floats, decoded here
    (faster-whisper's own decoder passes an option newer PyAV no longer takes)."""
    import av

    out = []
    with av.open(io.BytesIO(audio)) as box:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in box.decode(audio=0):
            out.extend(f.to_ndarray() for f in resampler.resample(frame))
        out.extend(f.to_ndarray() for f in resampler.resample(None))
    if not out:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(out, axis=1).reshape(-1).astype(np.float32) / 32768.0


def transcribe(audio: bytes) -> str:
    model = load_stt()
    samples = decode(audio)
    if samples.size < 1600:
        return ""
    with stt_lock:
        segments, _ = model.transcribe(samples, language="en", beam_size=1, vad_filter=True, condition_on_previous_text=False)
        return " ".join(s.text.strip() for s in segments).strip()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "tts": TTS_DEVICE, "stt": STT_DEVICE, "voices": VOICES, "cached": len(cache)})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        if self.path == "/tts":
            if n <= 0 or n > 8192:
                return self._send(400, {"error": "bad body"})
            try:
                body = json.loads(self.rfile.read(n))
                text = str(body.get("text") or "").strip()
                if not text:
                    return self._send(400, {"error": "no text"})
                t = time.time()
                wav = synth(text, str(body.get("voice") or ""), float(body.get("speed") or 1.05))
                if time.time() - t > 0.05:
                    print(f"tts {len(text)} chars in {time.time() - t:.2f}s", flush=True)
                return self._send(200, wav, "audio/wav")
            except Exception as e:
                return self._send(500, {"error": str(e)[:200]})
        if self.path == "/stt":
            if n <= 0 or n > MAX_AUDIO:
                return self._send(400, {"error": "bad audio"})
            try:
                t = time.time()
                text = transcribe(self.rfile.read(n))
                print(f"stt in {time.time() - t:.2f}s: {text[:80]}", flush=True)
                return self._send(200, {"text": text})
            except Exception as e:
                return self._send(500, {"error": str(e)[:200]})
        self._send(404, {"error": "not found"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    # Warm up so the first real line is fast.
    t = time.time()
    synth("Kixo agent ready.", VOICES[0], 1.05)
    print(f"Kixo voice on http://127.0.0.1:{PORT} (speech on {TTS_DEVICE}, warm-up {time.time() - t:.1f}s)", flush=True)

    # The emergency phrases (web lib/agent/brain.ts ALERT_SHORT) in each mode's voice and
    # speed (lib/agent/settings.ts MODES), made now so every alert plays the instant it is
    # needed.
    ALERT_SHORT = ["Sell! The dev is dumping.", "Sell! Bundles are dumping.", "Careful! Snipers are selling.", "Sell! Everyone's selling.", "Heavy selling! Price is crashing.", "Whale exit!", "It's pumping!"]
    MODE_VOICES = [("am_michael", 1.05), ("af_heart", 0.98), ("bm_george", 1.12), ("am_fenrir", 1.1)]

    def warm_alerts():
        t0 = time.time()
        for voice, speed in MODE_VOICES:
            for line in ALERT_SHORT:
                try:
                    synth(line, voice, speed)
                except Exception as e:
                    print(f"alert warm-up failed: {e}", flush=True)
                    return
        print(f"alert phrases ready in {time.time() - t0:.1f}s", flush=True)

    threading.Thread(target=warm_alerts, daemon=True).start()

    # Whisper loads in the background, so the first question is answered quickly too.
    def warm_stt():
        try:
            model = load_stt()
            with stt_lock:
                list(model.transcribe(np.zeros(16000, dtype=np.float32), language="en", beam_size=1)[0])
        except Exception as e:
            print(f"whisper warm-up failed: {e}", flush=True)

    threading.Thread(target=warm_stt, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
