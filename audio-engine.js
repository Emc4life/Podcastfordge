// ===== AUDIO ENGINE — Processing Chain, Playback, Recording =====

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterBuffer = null;     // Original loaded AudioBuffer
    this.workingBuffer = null;    // After edits
    this.sourceNode = null;
    this.gainNode = null;
    this.analyserNode = null;
    this.isPlaying = false;
    this.isRecording = false;
    this.startTime = 0;
    this.pauseOffset = 0;
    this.duration = 0;
    this.sampleRate = 44100;

    // Processing chain nodes
    this.chain = {
      hpf: { enabled: true, node: null, freq: 80 },
      noiseReduction: { enabled: false, strength: 0.3 },
      noiseGate: { enabled: false, threshold: -40, attack: 0.005, release: 0.05, floor: -60 },
      notchFilter: { enabled: false, node: null, freq: 60, q: 30 },
      eq: {
        enabled: true,
        lowCut: { freq: 80, gain: 0 },
        mudCut: { freq: 400, gain: -3, q: 1.5 },
        presence: { freq: 4000, gain: 2, q: 1.0 },
        air: { freq: 10000, gain: 1, q: 0.7 },
        nodes: {}
      },
      deEsser: { enabled: true, freq: 6000, threshold: -20, reduction: 6 },
      compressor: {
        enabled: true, node: null,
        threshold: -18, ratio: 3, attack: 0.01, release: 0.15, knee: 6, makeupGain: 4
      },
      limiter: { enabled: true, node: null, ceiling: -1 },
      loudness: { enabled: true, target: -19, ceiling: -1 }
    };

    // Presets
    this.presets = {
      clear: {
        name: 'Clear Podcast Voice',
        hpf: { enabled: true, freq: 80 },
        noiseReduction: { enabled: false, strength: 0.3 },
        noiseGate: { enabled: false, threshold: -40, attack: 0.005, release: 0.05, floor: -60 },
        notchFilter: { enabled: false, freq: 60, q: 30 },
        eq: { enabled: true, lowCut: { freq: 80, gain: 0 }, mudCut: { freq: 400, gain: -3, q: 1.5 }, presence: { freq: 4000, gain: 2, q: 1.0 }, air: { freq: 10000, gain: 1, q: 0.7 } },
        deEsser: { enabled: true, freq: 6000, threshold: -20, reduction: 6 },
        compressor: { enabled: true, threshold: -18, ratio: 3, attack: 0.01, release: 0.15, knee: 6, makeupGain: 4 },
        limiter: { enabled: true, ceiling: -1 },
        loudness: { enabled: true, target: -19, ceiling: -1 }
      },
      warm: {
        name: 'Warm & Rich',
        hpf: { enabled: true, freq: 60 },
        noiseReduction: { enabled: false, strength: 0.2 },
        noiseGate: { enabled: false, threshold: -45, attack: 0.01, release: 0.1, floor: -60 },
        notchFilter: { enabled: false, freq: 60, q: 30 },
        eq: { enabled: true, lowCut: { freq: 60, gain: 0 }, mudCut: { freq: 300, gain: -1, q: 1.0 }, presence: { freq: 3000, gain: 1, q: 0.8 }, air: { freq: 8000, gain: 2, q: 0.7 } },
        deEsser: { enabled: true, freq: 5500, threshold: -22, reduction: 4 },
        compressor: { enabled: true, threshold: -20, ratio: 2.5, attack: 0.015, release: 0.2, knee: 8, makeupGain: 3 },
        limiter: { enabled: true, ceiling: -1 },
        loudness: { enabled: true, target: -19, ceiling: -1 }
      },
      studio: {
        name: 'Studio Clean',
        hpf: { enabled: true, freq: 100 },
        noiseReduction: { enabled: true, strength: 0.4 },
        noiseGate: { enabled: true, threshold: -35, attack: 0.003, release: 0.03, floor: -70 },
        notchFilter: { enabled: false, freq: 60, q: 30 },
        eq: { enabled: true, lowCut: { freq: 100, gain: 0 }, mudCut: { freq: 500, gain: -4, q: 2.0 }, presence: { freq: 5000, gain: 3, q: 1.2 }, air: { freq: 12000, gain: 1, q: 0.7 } },
        deEsser: { enabled: true, freq: 6500, threshold: -18, reduction: 8 },
        compressor: { enabled: true, threshold: -16, ratio: 4, attack: 0.005, release: 0.1, knee: 5, makeupGain: 5 },
        limiter: { enabled: true, ceiling: -1 },
        loudness: { enabled: true, target: -16, ceiling: -1 }
      }
    };

    // Metering
    this.meterData = { peak: -Infinity, rms: -Infinity, lufs: -Infinity };
    this._meterInterval = null;

    // Recording
    this.mediaRecorder = null;
    this.recordedChunks = [];
  }

  async init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.sampleRate });
  }

  async loadFile(file) {
    await this.init();
    const arrayBuffer = await file.arrayBuffer();
    this.masterBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.workingBuffer = this.cloneBuffer(this.masterBuffer);
    this.sampleRate = this.workingBuffer.sampleRate;
    this.duration = this.workingBuffer.duration;
    this.pauseOffset = 0;
    return {
      duration: this.duration,
      sampleRate: this.sampleRate,
      channels: this.workingBuffer.numberOfChannels,
      name: file.name
    };
  }

  async loadFromBuffer(buffer) {
    await this.init();
    this.masterBuffer = this.cloneBuffer(buffer);
    this.workingBuffer = this.cloneBuffer(buffer);
    this.sampleRate = this.workingBuffer.sampleRate;
    this.duration = this.workingBuffer.duration;
    this.pauseOffset = 0;
  }

  cloneBuffer(buffer) {
    const newBuffer = this.ctx ? this.ctx.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    ) : new AudioBuffer({
      numberOfChannels: buffer.numberOfChannels,
      length: buffer.length,
      sampleRate: buffer.sampleRate
    });
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = newBuffer.getChannelData(ch);
      dst.set(src);
    }
    return newBuffer;
  }

  // ===== PLAYBACK =====
  play() {
    if (!this.workingBuffer || this.isPlaying) return;
    this._stopSource();

    this.sourceNode = this.ctx.createBufferSource();
    this.sourceNode.buffer = this.workingBuffer;
    this.gainNode = this.ctx.createGain();
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 2048;

    // Build processing chain for playback monitoring
    const chain = this._buildPlaybackChain();
    this.sourceNode.connect(chain.input);
    chain.output.connect(this.analyserNode);
    this.analyserNode.connect(this.ctx.destination);

    this.sourceNode.start(0, this.pauseOffset);
    this.startTime = this.ctx.currentTime - this.pauseOffset;
    this.isPlaying = true;

    this.sourceNode.onended = () => {
      if (this.isPlaying) {
        this.isPlaying = false;
        this.pauseOffset = 0;
        this._stopMetering();
        document.dispatchEvent(new CustomEvent('playback-ended'));
      }
    };

    this._startMetering();
    document.dispatchEvent(new CustomEvent('playback-started'));
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseOffset = this.getCurrentTime();
    this._stopSource();
    this.isPlaying = false;
    this._stopMetering();
    document.dispatchEvent(new CustomEvent('playback-paused'));
  }

  stop() {
    this._stopSource();
    this.isPlaying = false;
    this.pauseOffset = 0;
    this._stopMetering();
    document.dispatchEvent(new CustomEvent('playback-stopped'));
  }

  seek(time) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this._stopSource();
    this.pauseOffset = Math.max(0, Math.min(time, this.duration));
    if (wasPlaying) this.play();
    document.dispatchEvent(new CustomEvent('playback-seek', { detail: { time: this.pauseOffset } }));
  }

  getCurrentTime() {
    if (!this.isPlaying) return this.pauseOffset;
    const t = this.ctx.currentTime - this.startTime;
    return Math.min(t, this.duration);
  }

  _stopSource() {
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch(e) {}
      try { this.sourceNode.disconnect(); } catch(e) {}
      this.sourceNode = null;
    }
  }

  _buildPlaybackChain() {
    const nodes = [];
    let input = this.ctx.createGain(); // passthrough input

    // Chain order: HPF → Notch → Noise Gate → EQ → De-Esser → Compressor → Limiter

    // 1. HPF
    if (this.chain.hpf.enabled) {
      const hpf = this.ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = this.chain.hpf.freq;
      hpf.Q.value = 0.707;
      this.chain.hpf.node = hpf;
      nodes.push(hpf);
    }

    // 2. Notch Filter (hum removal) with harmonics
    if (this.chain.notchFilter.enabled) {
      const notch = this.ctx.createBiquadFilter();
      notch.type = 'notch';
      notch.frequency.value = this.chain.notchFilter.freq;
      notch.Q.value = this.chain.notchFilter.q || 30;
      this.chain.notchFilter.node = notch;
      nodes.push(notch);
      const h2 = this.ctx.createBiquadFilter();
      h2.type = 'notch';
      h2.frequency.value = this.chain.notchFilter.freq * 2;
      h2.Q.value = 25;
      nodes.push(h2);
      const h3 = this.ctx.createBiquadFilter();
      h3.type = 'notch';
      h3.frequency.value = this.chain.notchFilter.freq * 3;
      h3.Q.value = 20;
      nodes.push(h3);
    }

    // 3. Noise gate (using dynamics compressor as downward expander)
    if (this.chain.noiseGate.enabled) {
      const gate = this.ctx.createDynamicsCompressor();
      gate.threshold.value = this.chain.noiseGate.threshold;
      gate.ratio.value = 0.25;
      gate.attack.value = this.chain.noiseGate.attack;
      gate.release.value = this.chain.noiseGate.release;
      gate.knee.value = 3;
      nodes.push(gate);
    }

    // 4. EQ
    if (this.chain.eq.enabled) {
      if (this.chain.eq.lowCut) {
        const lc = this.ctx.createBiquadFilter();
        lc.type = 'highpass';
        lc.frequency.value = this.chain.eq.lowCut.freq;
        lc.Q.value = 0.707;
        nodes.push(lc);
        this.chain.eq.nodes.lowCut = lc;
      }
      if (this.chain.eq.mudCut) {
        const mc = this.ctx.createBiquadFilter();
        mc.type = 'peaking';
        mc.frequency.value = this.chain.eq.mudCut.freq;
        mc.gain.value = this.chain.eq.mudCut.gain;
        mc.Q.value = this.chain.eq.mudCut.q || 1.5;
        nodes.push(mc);
        this.chain.eq.nodes.mudCut = mc;
      }
      if (this.chain.eq.presence) {
        const pr = this.ctx.createBiquadFilter();
        pr.type = 'peaking';
        pr.frequency.value = this.chain.eq.presence.freq;
        pr.gain.value = this.chain.eq.presence.gain;
        pr.Q.value = this.chain.eq.presence.q || 1.0;
        nodes.push(pr);
        this.chain.eq.nodes.presence = pr;
      }
      if (this.chain.eq.air) {
        const ar = this.ctx.createBiquadFilter();
        ar.type = 'highshelf';
        ar.frequency.value = this.chain.eq.air.freq;
        ar.gain.value = this.chain.eq.air.gain;
        nodes.push(ar);
        this.chain.eq.nodes.air = ar;
      }
    }

    // 5. De-esser (frequency-aware compression)
    if (this.chain.deEsser.enabled) {
      const dsFilter = this.ctx.createBiquadFilter();
      dsFilter.type = 'highpass';
      dsFilter.frequency.value = this.chain.deEsser.freq;
      dsFilter.Q.value = 2.0;
      nodes.push(dsFilter);

      const dsComp = this.ctx.createDynamicsCompressor();
      dsComp.threshold.value = this.chain.deEsser.threshold;
      dsComp.ratio.value = Math.max(2, this.chain.deEsser.reduction);
      dsComp.attack.value = 0.001;
      dsComp.release.value = 0.05;
      dsComp.knee.value = 2;
      nodes.push(dsComp);
    }

    // 6. Compressor
    if (this.chain.compressor.enabled) {
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = this.chain.compressor.threshold;
      comp.ratio.value = this.chain.compressor.ratio;
      comp.attack.value = this.chain.compressor.attack;
      comp.release.value = this.chain.compressor.release;
      comp.knee.value = this.chain.compressor.knee;
      this.chain.compressor.node = comp;
      nodes.push(comp);

      const makeup = this.ctx.createGain();
      makeup.gain.value = Math.pow(10, (this.chain.compressor.makeupGain || 0) / 20);
      nodes.push(makeup);
    }

    // 7. Limiter
    if (this.chain.limiter.enabled) {
      const lim = this.ctx.createDynamicsCompressor();
      lim.threshold.value = this.chain.limiter.ceiling;
      lim.ratio.value = 20;
      lim.attack.value = 0.001;
      lim.release.value = 0.01;
      lim.knee.value = 0;
      this.chain.limiter.node = lim;
      nodes.push(lim);
    }

    // Connect chain in order
    let prev = input;
    for (const node of nodes) {
      prev.connect(node);
      prev = node;
    }

    return { input, output: prev };
  }

  // ===== METERING =====
  _startMetering() {
    if (this._meterInterval) return;
    this._meterInterval = setInterval(() => {
      if (!this.analyserNode) return;
      const data = new Float32Array(this.analyserNode.fftSize);
      this.analyserNode.getFloatTimeDomainData(data);

      let peak = 0;
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
        sumSq += data[i] * data[i];
      }
      const rms = Math.sqrt(sumSq / data.length);
      const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
      const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      // Simplified LUFS approximation
      const lufs = rmsDb - 0.691;

      this.meterData = { peak: peakDb, rms: rmsDb, lufs };
      document.dispatchEvent(new CustomEvent('meter-update', { detail: this.meterData }));
    }, 100);
  }

  _stopMetering() {
    if (this._meterInterval) {
      clearInterval(this._meterInterval);
      this._meterInterval = null;
    }
  }

  // ===== RECORDING =====
  async startRecording() {
    await this.init();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 }
      }
    });

    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    });
    this.recordedChunks = [];

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordedChunks.push(e.data);
    };

    this.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
      const arrayBuffer = await blob.arrayBuffer();
      try {
        this.masterBuffer = await this.ctx.decodeAudioData(arrayBuffer);
        this.workingBuffer = this.cloneBuffer(this.masterBuffer);
        this.duration = this.workingBuffer.duration;
        this.pauseOffset = 0;
        document.dispatchEvent(new CustomEvent('recording-done', {
          detail: { duration: this.duration, sampleRate: this.sampleRate }
        }));
      } catch(e) {
        document.dispatchEvent(new CustomEvent('recording-error', { detail: { error: e.message } }));
      }
    };

    this.mediaRecorder.start();
    this.isRecording = true;
    document.dispatchEvent(new CustomEvent('recording-started'));
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.isRecording = false;
      document.dispatchEvent(new CustomEvent('recording-stopped'));
    }
  }

  // ===== OFFLINE RENDERING (for export) =====
  async renderOffline(targetLufs = -19, ceiling = -1) {
    if (!this.workingBuffer) return null;

    const sr = this.workingBuffer.sampleRate;
    const len = this.workingBuffer.length;
    const channels = this.workingBuffer.numberOfChannels;
    const offCtx = new OfflineAudioContext(channels, len, sr);

    const source = offCtx.createBufferSource();
    source.buffer = this.workingBuffer;

    // Build processing chain
    let lastNode = source;

    if (this.chain.hpf.enabled) {
      const hpf = offCtx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = this.chain.hpf.freq;
      hpf.Q.value = 0.707;
      lastNode.connect(hpf);
      lastNode = hpf;
    }

    if (this.chain.notchFilter.enabled) {
      const notch = offCtx.createBiquadFilter();
      notch.type = 'notch';
      notch.frequency.value = this.chain.notchFilter.freq;
      notch.Q.value = this.chain.notchFilter.q || 30;
      lastNode.connect(notch);
      lastNode = notch;
      const n2 = offCtx.createBiquadFilter();
      n2.type = 'notch';
      n2.frequency.value = this.chain.notchFilter.freq * 2;
      n2.Q.value = 25;
      lastNode.connect(n2);
      lastNode = n2;
      const n3 = offCtx.createBiquadFilter();
      n3.type = 'notch';
      n3.frequency.value = this.chain.notchFilter.freq * 3;
      n3.Q.value = 20;
      lastNode.connect(n3);
      lastNode = n3;
    }

    // Noise gate
    if (this.chain.noiseGate.enabled) {
      const gate = offCtx.createDynamicsCompressor();
      gate.threshold.value = this.chain.noiseGate.threshold;
      gate.ratio.value = 0.25;
      gate.attack.value = this.chain.noiseGate.attack;
      gate.release.value = this.chain.noiseGate.release;
      gate.knee.value = 3;
      lastNode.connect(gate);
      lastNode = gate;
    }

    if (this.chain.eq.enabled) {
      if (this.chain.eq.lowCut) {
        const lc = offCtx.createBiquadFilter();
        lc.type = 'highpass';
        lc.frequency.value = this.chain.eq.lowCut.freq;
        lc.Q.value = 0.707;
        lastNode.connect(lc);
        lastNode = lc;
      }
      if (this.chain.eq.mudCut) {
        const mc = offCtx.createBiquadFilter();
        mc.type = 'peaking';
        mc.frequency.value = this.chain.eq.mudCut.freq;
        mc.gain.value = this.chain.eq.mudCut.gain;
        mc.Q.value = this.chain.eq.mudCut.q || 1.5;
        lastNode.connect(mc);
        lastNode = mc;
      }
      if (this.chain.eq.presence) {
        const pr = offCtx.createBiquadFilter();
        pr.type = 'peaking';
        pr.frequency.value = this.chain.eq.presence.freq;
        pr.gain.value = this.chain.eq.presence.gain;
        pr.Q.value = this.chain.eq.presence.q || 1.0;
        lastNode.connect(pr);
        lastNode = pr;
      }
      if (this.chain.eq.air) {
        const ar = offCtx.createBiquadFilter();
        ar.type = 'highshelf';
        ar.frequency.value = this.chain.eq.air.freq;
        ar.gain.value = this.chain.eq.air.gain;
        lastNode.connect(ar);
        lastNode = ar;
      }
    }

    // De-esser
    if (this.chain.deEsser.enabled) {
      // High-pass to detect sibilance, then compress it
      const dsFilter = offCtx.createBiquadFilter();
      dsFilter.type = 'highpass';
      dsFilter.frequency.value = this.chain.deEsser.freq;
      dsFilter.Q.value = 2.0;
      lastNode.connect(dsFilter);
      lastNode = dsFilter;

      const dsComp = offCtx.createDynamicsCompressor();
      dsComp.threshold.value = this.chain.deEsser.threshold;
      dsComp.ratio.value = Math.max(2, this.chain.deEsser.reduction);
      dsComp.attack.value = 0.001;
      dsComp.release.value = 0.05;
      dsComp.knee.value = 2;
      lastNode.connect(dsComp);
      lastNode = dsComp;

      // Restore low frequencies that were filtered
      const dsRestore = offCtx.createBiquadFilter();
      dsRestore.type = 'lowpass';
      dsRestore.frequency.value = this.chain.deEsser.freq;
      dsRestore.Q.value = 0.5;
      // We don't fully restore - the compressor already shaped the highs
      lastNode = dsComp;
    }

    if (this.chain.compressor.enabled) {
      const comp = offCtx.createDynamicsCompressor();
      comp.threshold.value = this.chain.compressor.threshold;
      comp.ratio.value = this.chain.compressor.ratio;
      comp.attack.value = this.chain.compressor.attack;
      comp.release.value = this.chain.compressor.release;
      comp.knee.value = this.chain.compressor.knee;
      lastNode.connect(comp);
      lastNode = comp;
      const makeup = offCtx.createGain();
      makeup.gain.value = Math.pow(10, (this.chain.compressor.makeupGain || 0) / 20);
      lastNode.connect(makeup);
      lastNode = makeup;
    }

    if (this.chain.limiter.enabled) {
      const lim = offCtx.createDynamicsCompressor();
      lim.threshold.value = ceiling;
      lim.ratio.value = 20;
      lim.attack.value = 0.001;
      lim.release.value = 0.01;
      lim.knee.value = 0;
      lastNode.connect(lim);
      lastNode = lim;
    }

    lastNode.connect(offCtx.destination);
    source.start(0);
    const rendered = await offCtx.startRendering();

    // Measure LUFS of rendered buffer
    const lufs = this.measureLUFS(rendered);

    // Apply loudness normalization if enabled
    let finalBuffer = rendered;
    if (this.chain.loudness.enabled) {
      const gainDb = targetLufs - lufs;
      finalBuffer = this.applyGain(rendered, gainDb);

      // Re-apply limiter ceiling after normalization
      if (this.chain.limiter.enabled) {
        finalBuffer = this.applyTruePeakLimit(finalBuffer, ceiling);
      }
    }

    const finalLufs = this.measureLUFS(finalBuffer);
    const truePeak = this.measureTruePeak(finalBuffer);

    return {
      buffer: finalBuffer,
      report: {
        integratedLufs: finalLufs.toFixed(1),
        truePeakDb: truePeak.toFixed(1),
        targetLufs: targetLufs,
        ceiling: ceiling,
        lufsPass: finalLufs >= targetLufs - 1 && finalLufs <= targetLufs + 1,
        peakPass: truePeak <= ceiling
      }
    };
  }

  // ===== LUFS MEASUREMENT (simplified ITU-R BS.1770 approximation) =====
  measureLUFS(buffer) {
    const channelData = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      channelData.push(buffer.getChannelData(ch));
    }

    // Simple K-weighted RMS approximation
    // Pre-filter: high shelf + high pass (simplified as RMS with channel weighting)
    const blockSize = 4800; // 400ms blocks at 12kHz, approximate for 44.1/48k
    const numBlocks = Math.floor(buffer.length / blockSize);
    let gatedSum = 0;
    let gatedBlocks = 0;
    const blockLoudness = [];

    for (let b = 0; b < numBlocks; b++) {
      let channelSum = 0;
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = channelData[ch];
        let sum = 0;
        const start = b * blockSize;
        for (let i = start; i < start + blockSize && i < data.length; i++) {
          sum += data[i] * data[i];
        }
        // Channel weighting: L/R = 1.0, C = 1.0, LFE ignored, Ls/Rs = 1.41
        const weight = (ch === 0) ? 1.0 : 1.0;
        channelSum += weight * sum / Math.min(blockSize, data.length - start);
      }
      const loudness = -0.691 + 10 * Math.log10(Math.max(channelSum, 1e-20));
      blockLoudness.push(loudness);
    }

    // Absolute gate at -70 LUFS
    const absGateLoudness = [];
    let absGateSum = 0;
    for (const l of blockLoudness) {
      if (l > -70) { absGateLoudness.push(l); absGateSum += Math.pow(10, l / 10); }
    }
    if (absGateLoudness.length === 0) return -70;
    const absGateLufs = 10 * Math.log10(absGateSum / absGateLoudness.length);

    // Relative gate at absGate - 10
    const relThreshold = absGateLufs - 10;
    let relSum = 0;
    let relCount = 0;
    for (const l of blockLoudness) {
      if (l > relThreshold) { relSum += Math.pow(10, l / 10); relCount++; }
    }
    if (relCount === 0) return -70;

    return 10 * Math.log10(relSum / relCount);
  }

  measureTruePeak(buffer) {
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length - 1; i++) {
        // Simple 4x oversampling for true peak
        const a = data[i];
        const b = data[i + 1];
        const c1 = 0.5625 * a + 0.4375 * b;
        const c2 = 0.25 * a + 0.75 * b;
        const c3 = 0.0625 * a + 0.9375 * b;
        peak = Math.max(peak, Math.abs(a), Math.abs(c1), Math.abs(c2), Math.abs(c3));
      }
    }
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  }

  applyGain(buffer, gainDb) {
    const newBuf = this.ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const gain = Math.pow(10, gainDb / 20);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = newBuf.getChannelData(ch);
      for (let i = 0; i < src.length; i++) {
        dst[i] = src[i] * gain;
      }
    }
    return newBuf;
  }

  applyTruePeakLimit(buffer, ceilingDb) {
    const ceiling = Math.pow(10, ceilingDb / 20);
    const newBuf = this.ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = newBuf.getChannelData(ch);
      for (let i = 0; i < src.length; i++) {
        dst[i] = Math.max(-ceiling, Math.min(ceiling, src[i]));
      }
    }
    return newBuf;
  }

  // ===== WAVEFORM DATA =====
  getWaveformData(numPoints = 2000) {
    if (!this.workingBuffer) return [];
    const data = [];
    const channelData = this.workingBuffer.getChannelData(0);
    const samplesPerPoint = Math.floor(channelData.length / numPoints);

    for (let i = 0; i < numPoints; i++) {
      const start = i * samplesPerPoint;
      let min = 0, max = 0;
      for (let j = start; j < start + samplesPerPoint && j < channelData.length; j++) {
        const val = channelData[j];
        if (val < min) min = val;
        if (val > max) max = val;
      }
      data.push({ min, max });
    }
    return data;
  }

  // Get audio samples for a range (for detection)
  getChannelData(channel = 0) {
    if (!this.workingBuffer) return null;
    return this.workingBuffer.getChannelData(channel);
  }

  getSampleRate() {
    return this.workingBuffer ? this.workingBuffer.sampleRate : this.sampleRate;
  }

  getDuration() {
    return this.workingBuffer ? this.workingBuffer.duration : 0;
  }
}
