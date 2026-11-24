// Resamples browser microphone audio (e.g. 48kHz / 44.1kHz / 16kHz) into
// clean 16kHz 16-bit signed little-endian mono PCM chunks for Gemini Live API.
class JarvisPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._targetRate = 16000;
    this._buffer = new Int16Array(1024);
    this._offset = 0;
    this._phase = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    const ratio = sampleRate / this._targetRate;

    if (Math.abs(ratio - 1) < 0.001) {
      for (let i = 0; i < channel.length; i++) {
        this._pushSample(channel[i]);
      }
    } else {
      let pos = this._phase;
      while (pos < channel.length) {
        const idx = Math.floor(pos);
        const frac = pos - idx;
        const s0 = channel[idx];
        const s1 = idx + 1 < channel.length ? channel[idx + 1] : s0;
        this._pushSample(s0 + (s1 - s0) * frac);
        pos += ratio;
      }
      this._phase = pos - channel.length;
    }

    return true;
  }

  _pushSample(sample) {
    const clamped = Math.max(-1, Math.min(1, sample));
    this._buffer[this._offset++] =
      clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);

    if (this._offset >= this._buffer.length) {
      const chunk = this._buffer.slice(0, this._offset);
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
      this._offset = 0;
    }
  }
}

registerProcessor("jarvis-pcm-capture", JarvisPcmCaptureProcessor);
