interface SpeechAlternativeLike {
  transcript: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

export class VoiceController {
  private recognition: SpeechRecognitionLike | null = null;
  private listening = false;
  public speechEnabled = true;

  get canSpeak(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  get canListen(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as WindowWithSpeech;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  get isListening(): boolean {
    return this.listening;
  }

  speak(text: string, lang: 'en' | 'es' = 'en'): void {
    if (!this.speechEnabled || !this.canSpeak) return;
    try {
      window.speechSynthesis.cancel();
      const clean = text.replace(/[·—–]/g, ', ').replace(/\s+/g, ' ').trim();
      if (!clean) return;
      const utt = new SpeechSynthesisUtterance(clean);
      utt.lang = lang === 'es' ? 'es-US' : 'en-US';
      utt.rate = 1.02;
      utt.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices?.() ?? [];
      const preferred =
        lang === 'es'
          ? voices.find((v) => /es[-_](?:US|MX|419)/i.test(v.lang) && /paulina|monica|google español|natural/i.test(v.name)) ||
            voices.find((v) => /^es/i.test(v.lang))
          : voices.find((v) => /en[-_]US/i.test(v.lang) && /samantha|ava|aria|google us english|natural/i.test(v.name)) ||
            voices.find((v) => /en[-_]US/i.test(v.lang));
      if (preferred) utt.voice = preferred;

      window.speechSynthesis.speak(utt);
    } catch {
      // Speech synthesis is purely optional enhancement
    }
  }

  stopSpeaking(): void {
    if (this.canSpeak) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  startListening(callbacks: {
    lang?: 'en' | 'es';
    onInterim: (transcript: string) => void;
    onFinal: (transcript: string, alternatives: string[]) => void;
    onEnd: () => void;
    onError: (message: string) => void;
  }): boolean {
    if (!this.canListen) {
      callbacks.onError(
        callbacks.lang === 'es'
          ? 'Tu navegador no soporta entrada de voz — escribe o toca abajo.'
          : 'Voice input is not supported in this browser — type or tap below instead.'
      );
      return false;
    }

    this.stopSpeaking();
    this.stopListening();

    const w = window as WindowWithSpeech;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return false;

    const rec = new Ctor();
    rec.lang = callbacks.lang === 'es' ? 'es-US' : 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    // Ask the browser's speech engine for top-5 alternatives so phonetic campus names ("EPAC", "S-4", "Boone") match reliably!
    rec.maxAlternatives = 5;

    let latestTranscript = '';
    let latestAlts: string[] = [];
    let deliveredFinal = false;

    rec.onresult = (ev) => {
      let full = '';
      let hasFinal = false;
      const altBuckets: string[] = [];

      for (let i = 0; i < ev.results.length; i++) {
        const res = ev.results[i];
        full += res[0].transcript;
        if (res.isFinal) hasFinal = true;
      }

      // Collect alternative full hypotheses from the last (or single) speech segment
      if (ev.results.length > 0) {
        const lastRes = ev.results[ev.results.length - 1];
        const prefix =
          ev.results.length > 1
            ? Array.from({ length: ev.results.length - 1 }, (_, k) => ev.results[k][0].transcript).join('')
            : '';
        for (let a = 0; a < Math.min(5, lastRes.length || 1); a++) {
          const t = `${prefix}${lastRes[a]?.transcript ?? ''}`.trim();
          if (t && !altBuckets.includes(t)) altBuckets.push(t);
        }
      }

      latestTranscript = full.trim();
      latestAlts = altBuckets.filter((a) => a !== latestTranscript);
      callbacks.onInterim(latestTranscript);

      if (hasFinal && latestTranscript && !deliveredFinal) {
        deliveredFinal = true;
        // Close listening state BEFORE calling onFinal so UI never stays stuck on "Listening..." and mic never hears TTS!
        this.listening = false;
        this.recognition = null;
        try {
          rec.stop();
        } catch {
          // ignore
        }
        callbacks.onFinal(latestTranscript, latestAlts);
      }
    };

    rec.onerror = (ev) => {
      this.listening = false;
      this.recognition = null;
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        callbacks.onError('Microphone permission was denied — type or tap below instead.');
      } else if (ev.error === 'no-speech') {
        callbacks.onError("Didn't catch any speech — tap the mic and try again.");
      } else if (ev.error !== 'aborted') {
        callbacks.onError('Voice input had trouble — you can type or tap below.');
      }
    };

    rec.onend = () => {
      this.listening = false;
      this.recognition = null;
      if (!deliveredFinal && latestTranscript) {
        deliveredFinal = true;
        callbacks.onFinal(latestTranscript, latestAlts);
      }
      callbacks.onEnd();
    };

    try {
      this.recognition = rec;
      this.listening = true;
      rec.start();
      return true;
    } catch {
      this.listening = false;
      this.recognition = null;
      callbacks.onError('Could not start microphone.');
      return false;
    }
  }

  stopListening(): void {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
    this.listening = false;
  }
}
