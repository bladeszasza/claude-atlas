(function (root) {
  'use strict';
  class FocusAudio {
    constructor() {
      this.context = null;
      this.master = null;
      this.analyser = null;
      this.playing = false;
      this.volume = 0.22;
      this.preset = 'current';
      this.scheduler = null;
      this.nextNote = 0;
      this.noteIndex = 0;
    }

    async start(preset = this.preset) {
      this.stop();
      const AudioContext = root.AudioContext || root.webkitAudioContext;
      if (!AudioContext) throw new Error('This browser does not support Web Audio. You can open Brain.fm separately.');
      const context = new AudioContext();
      this.context = context;
      this.preset = preset;
      try {
        await context.resume();
      } catch (error) {
        this.stop();
        throw new Error('Audio could not start. Press play again or check your browser audio permissions.');
      }
      if (this.context !== context) { await context.close(); return; }
      this.master = context.createGain();
      this.master.gain.setValueAtTime(0, context.currentTime);
      this.master.gain.linearRampToValueAtTime(this.volume * 0.38, context.currentTime + 1.6);
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 256;
      this.master.connect(compressor);
      compressor.connect(this.analyser);
      this.analyser.connect(context.destination);
      this.playing = true;
      this.addNoise(preset === 'rain' ? 'rain' : 'brown', preset === 'noise' ? 0.65 : preset === 'rain' ? 0.38 : 0.12);
      if (preset !== 'noise') {
        const frequencies = preset === 'drift' ? [98, 146.83, 196, 246.94] : [130.81, 196, 261.63, 329.63];
        frequencies.forEach((frequency, index) => this.addPad(frequency, index));
        this.noteIndex = 0;
        this.nextNote = context.currentTime + 0.5;
        this.scheduleNotes();
        this.scheduler = root.setInterval(() => this.scheduleNotes(), 800);
      }
    }

    addNoise(kind, level) {
      const context = this.context;
      const buffer = context.createBuffer(2, context.sampleRate * 12, context.sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        let last = 0;
        for (let index = 0; index < data.length; index += 1) {
          const white = Math.random() * 2 - 1;
          last = (last + 0.022 * white) / 1.022;
          const edge = Math.min(1, index / 1800, (data.length - index - 1) / 1800);
          data[index] = (kind === 'brown' ? last * 3.7 : white * 0.3) * edge;
        }
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = kind === 'rain' ? 3200 : 650;
      const gain = context.createGain();
      gain.gain.value = level;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start();
    }

    addPad(frequency, index) {
      const context = this.context;
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index % 2 ? 3 : -3;
      const gain = context.createGain();
      gain.gain.value = 0.12 / (1 + index * 0.3);
      const motion = context.createOscillator();
      motion.frequency.value = 0.045 + index * 0.011;
      const motionDepth = context.createGain();
      motionDepth.gain.value = 0.022;
      motion.connect(motionDepth);
      motionDepth.connect(gain.gain);
      const pan = context.createStereoPanner();
      pan.pan.value = (index - 1.5) * 0.28;
      oscillator.connect(gain);
      gain.connect(pan);
      pan.connect(this.master);
      oscillator.start();
      motion.start();
    }

    scheduleNotes() {
      if (!this.playing || !this.context || this.context.state !== 'running') return;
      const context = this.context;
      if (this.nextNote < context.currentTime) this.nextNote = context.currentTime + 0.1;
      const melody = this.preset === 'drift' ? [196, 293.66, 246.94, 392, 293.66, 196, 329.63, 246.94] : [523.25, 392, 659.25, 587.33, 392, 523.25, 329.63, 392];
      while (this.nextNote < context.currentTime + 2) {
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = melody[this.noteIndex % melody.length];
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, this.nextNote);
        gain.gain.exponentialRampToValueAtTime(this.preset === 'rain' ? 0.045 : 0.075, this.nextNote + 0.8);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.nextNote + 5.7);
        const pan = context.createStereoPanner();
        pan.pan.value = Math.sin(this.noteIndex * 1.7) * 0.5;
        oscillator.connect(gain);
        gain.connect(pan);
        pan.connect(this.master);
        oscillator.start(this.nextNote);
        oscillator.stop(this.nextNote + 6);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); pan.disconnect(); };
        this.nextNote += this.preset === 'drift' ? 6 : 4.8;
        this.noteIndex += 1;
      }
    }

    setVolume(value) {
      this.volume = Math.max(0, Math.min(1, value));
      if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume * 0.38, this.context.currentTime, 0.12);
    }

    stop() {
      root.clearInterval(this.scheduler);
      this.scheduler = null;
      const context = this.context;
      const master = this.master;
      this.playing = false;
      this.context = null;
      this.master = null;
      this.analyser = null;
      if (context && context.state !== 'closed') {
        if (master) {
          master.gain.cancelScheduledValues(context.currentTime);
          master.gain.setTargetAtTime(0, context.currentTime, 0.12);
        }
        root.setTimeout(() => { if (context.state !== 'closed') context.close().catch(() => {}); }, 600);
      }
    }

    sample() {
      const values = new Uint8Array(128);
      if (this.analyser) this.analyser.getByteTimeDomainData(values);
      else values.fill(128);
      return values;
    }
  }
  root.AtlasAudio = FocusAudio;
})(globalThis);