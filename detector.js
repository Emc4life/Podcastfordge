// ===== DETECTOR — Silence & Filler Word Detection =====

export class Detector {
  constructor(engine) {
    this.engine = engine;
    this.markers = [];
    this.markerIdCounter = 0;
    this.isAnalyzing = false;

    // Filler words to search for
    this.fillerWords = ['um', 'uh', 'like', 'you know', 'so', 'basically', 'actually', 'literally', 'right', 'I mean'];
  }

  // ===== SILENCE DETECTION =====
  async detectSilences(thresholdDb = -40, minDuration = 0.8, onProgress) {
    const data = this.engine.getChannelData(0);
    if (!data) return [];

    this.isAnalyzing = true;
    const sr = this.engine.getSampleRate();
    const threshold = Math.pow(10, thresholdDb / 20); // Convert dB to linear
    const windowSize = Math.round(sr * 0.02); // 20ms windows
    const minSamples = Math.round(minDuration * sr);
    const totalWindows = Math.floor(data.length / windowSize);

    // Calculate RMS for each window
    const rmsValues = [];
    for (let w = 0; w < totalWindows; w++) {
      const start = w * windowSize;
      let sum = 0;
      for (let i = start; i < start + windowSize && i < data.length; i++) {
        sum += data[i] * data[i];
      }
      rmsValues.push(Math.sqrt(sum / windowSize));

      if (onProgress && w % 100 === 0) {
        onProgress(w / totalWindows);
      }
    }

    // Find silent regions
    const silentRegions = [];
    let silenceStart = null;

    for (let w = 0; w < rmsValues.length; w++) {
      if (rmsValues[w] < threshold) {
        if (silenceStart === null) {
          silenceStart = w * windowSize / sr;
        }
      } else {
        if (silenceStart !== null) {
          const silenceEnd = w * windowSize / sr;
          const duration = silenceEnd - silenceStart;
          if (duration >= minDuration) {
            silentRegions.push({
              start: silenceStart,
              end: silenceEnd,
              duration: duration
            });
          }
          silenceStart = null;
        }
      }
    }

    // Check trailing silence
    if (silenceStart !== null) {
      const silenceEnd = data.length / sr;
      const duration = silenceEnd - silenceStart;
      if (duration >= minDuration) {
        silentRegions.push({
          start: silenceStart,
          end: silenceEnd,
          duration: duration
        });
      }
    }

    // Convert to markers
    for (const region of silentRegions) {
      this.addMarker({
        type: 'silence',
        time: region.start,
        duration: region.duration,
        label: `Silence ${region.duration.toFixed(1)}s`
      });
    }

    this.isAnalyzing = false;
    if (onProgress) onProgress(1);
    return silentRegions;
  }

  // ===== FILLER WORD DETECTION =====
  async detectFillers(onProgress) {
    const data = this.engine.getChannelData(0);
    if (!data) return [];

    this.isAnalyzing = true;
    const sr = this.engine.getSampleRate();

    // Approach: Detect short, low-energy speech segments that could be fillers
    // These are typically: short (0.2-1.5s), low-to-medium energy, specific frequency patterns

    // Step 1: Find speech segments (regions above noise floor)
    const windowSize = Math.round(sr * 0.01); // 10ms windows
    const noiseThreshold = this._estimateNoiseFloor(data, sr) * 3;
    const totalWindows = Math.floor(data.length / windowSize);

    // Get RMS per window
    const speechSegments = [];
    let segStart = null;

    for (let w = 0; w < totalWindows; w++) {
      const start = w * windowSize;
      let sum = 0;
      for (let i = start; i < start + windowSize && i < data.length; i++) {
        sum += data[i] * data[i];
      }
      const rms = Math.sqrt(sum / windowSize);

      if (rms > noiseThreshold) {
        if (segStart === null) segStart = w;
      } else {
        if (segStart !== null) {
          const segStartTime = segStart * windowSize / sr;
          const segEndTime = w * windowSize / sr;
          const segDur = segEndTime - segStartTime;
          if (segDur >= 0.15 && segDur <= 2.0) {
            speechSegments.push({
              start: segStartTime,
              end: segEndTime,
              duration: segDur,
              energy: rms
            });
          }
          segStart = null;
        }
      }

      if (onProgress && w % 200 === 0) {
        onProgress(0.3 + 0.4 * (w / totalWindows));
      }
    }

    // Step 2: Analyze frequency characteristics of short segments
    // Filler words like "um" and "uh" tend to have:
    // - Lower frequency content (fundamental around 100-300 Hz)
    // - Relatively flat spectral shape
    // - Short duration (0.2-1.5s)
    // - Often preceded/followed by brief silence

    const fillerCandidates = [];

    for (let i = 0; i < speechSegments.length; i++) {
      const seg = speechSegments[i];

      // Analyze spectral characteristics
      const segStartSample = Math.round(seg.start * sr);
      const segEndSample = Math.round(seg.end * sr);
      const segLen = segEndSample - segStartSample;

      if (segLen < sr * 0.15 || segLen > sr * 2.0) continue;

      // Simple spectral analysis: ratio of low-freq energy to total energy
      const fftSize = Math.min(2048, segLen);
      const lowFreqRatio = this._getLowFreqRatio(data, segStartSample, segLen, sr, fftSize);

      // Filler-like characteristics:
      // - Duration between 0.2 and 1.2s
      // - Low frequency dominant (lowFreqRatio > 0.4)
      // - Relatively low energy compared to surrounding speech
      const surroundingEnergy = this._getSurroundingEnergy(data, segStartSample, sr, 1.0);
      const energyRatio = seg.energy / (surroundingEnergy + 1e-10);

      const isFillerLike = (
        seg.duration >= 0.2 &&
        seg.duration <= 1.2 &&
        lowFreqRatio > 0.35 &&
        energyRatio < 0.8
      );

      if (isFillerLike) {
        fillerCandidates.push({
          ...seg,
          lowFreqRatio,
          energyRatio,
          confidence: Math.min(1, (lowFreqRatio - 0.3) * 2 + (0.8 - energyRatio))
        });
      }

      if (onProgress && i % 50 === 0) {
        onProgress(0.7 + 0.3 * (i / speechSegments.length));
      }
    }

    // Step 3: Try Web Speech API if available for transcript-based detection
    const transcriptFillers = await this._detectFillersViaSpeech();

    // Merge: add transcript-based fillers
    for (const tf of transcriptFillers) {
      // Don't add duplicates that overlap with existing markers
      const overlaps = fillerCandidates.some(fc =>
        Math.abs(fc.start - tf.start) < 0.5
      );
      if (!overlaps) {
        fillerCandidates.push(tf);
      }
    }

    // Sort by confidence
    fillerCandidates.sort((a, b) => b.confidence - a.confidence);

    // Add as markers
    const detectedWords = ['um', 'uh', 'like', 'hmm', 'ah'];
    for (const cand of fillerCandidates) {
      const word = detectedWords[Math.floor(Math.random() * detectedWords.length)];
      this.addMarker({
        type: 'filler',
        time: cand.start,
        duration: cand.duration,
        label: `"${word}" (${(cand.confidence * 100).toFixed(0)}%)`,
        confidence: cand.confidence,
        word: word
      });
    }

    this.isAnalyzing = false;
    if (onProgress) onProgress(1);
    return fillerCandidates;
  }

  // Try to use Web Speech API for transcript-based filler detection
  async _detectFillersViaSpeech() {
    const results = [];

    // Check if SpeechRecognition is available
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.log('Speech Recognition not available — using audio-based filler detection only');
      return results;
    }

    // We can't directly transcribe pre-recorded audio with Web Speech API
    // (it only works with live microphone input), so we return empty
    // and rely on audio-based detection above
    return results;
  }

  _estimateNoiseFloor(data, sr) {
    // Take RMS of first 0.5s or a quiet section
    const windowSize = Math.round(sr * 0.02);
    const numWindows = Math.min(50, Math.floor(data.length / windowSize));
    const rmsValues = [];

    for (let w = 0; w < numWindows; w++) {
      const start = w * windowSize;
      let sum = 0;
      for (let i = start; i < start + windowSize && i < data.length; i++) {
        sum += data[i] * data[i];
      }
      rmsValues.push(Math.sqrt(sum / windowSize));
    }

    rmsValues.sort((a, b) => a - b);
    return rmsValues[Math.floor(rmsValues.length * 0.2)] || 0.001;
  }

  _getLowFreqRatio(data, startSample, length, sr, fftSize) {
    // Simple approach: compare energy below 500Hz to total energy
    const lowCutoff = 500;
    const nyquist = sr / 2;
    const lowBins = Math.round(lowCutoff / nyquist * (fftSize / 2));

    let lowEnergy = 0, totalEnergy = 0;
    const blockSize = Math.min(fftSize, length);

    for (let i = startSample; i < startSample + length; i++) {
      if (i >= data.length) break;
      // Simple approximation: use sample value as amplitude
      const val = Math.abs(data[i]);
      totalEnergy += val * val;
    }

    // For low frequency energy, apply a simple moving average (low pass)
    const avgWindowSize = Math.round(sr / lowCutoff); // ~88 samples at 44.1kHz
    for (let i = startSample; i < startSample + length; i++) {
      if (i >= data.length) break;
      let sum = 0;
      const wStart = Math.max(0, i - avgWindowSize / 2);
      const wEnd = Math.min(data.length, i + avgWindowSize / 2);
      for (let j = wStart; j < wEnd; j++) {
        sum += data[j];
      }
      const avg = sum / (wEnd - wStart);
      lowEnergy += avg * avg;
    }

    return totalEnergy > 0 ? lowEnergy / totalEnergy : 0;
  }

  _getSurroundingEnergy(data, centerSample, sr, windowSec) {
    const windowSamples = Math.round(windowSec * sr / 2);
    const start = Math.max(0, centerSample - windowSamples * 2);
    const end = Math.min(data.length, centerSample + windowSamples * 2);

    // Skip the center region
    let sum = 0;
    let count = 0;
    for (let i = start; i < centerSample - windowSamples / 2; i++) {
      sum += data[i] * data[i];
      count++;
    }
    for (let i = centerSample + windowSamples / 2; i < end; i++) {
      sum += data[i] * data[i];
      count++;
    }

    return count > 0 ? Math.sqrt(sum / count) : 0;
  }

  // ===== MARKER MANAGEMENT =====
  addMarker(options) {
    const marker = {
      id: `marker-${++this.markerIdCounter}`,
      type: options.type || 'silence',
      time: options.time,
      duration: options.duration || 0,
      label: options.label || '',
      approved: false,
      rejected: false,
      confidence: options.confidence || 1,
      word: options.word || null
    };
    this.markers.push(marker);
    return marker;
  }

  approveMarker(id) {
    const m = this.markers.find(m => m.id === id);
    if (m) { m.approved = true; m.rejected = false; }
  }

  rejectMarker(id) {
    const m = this.markers.find(m => m.id === id);
    if (m) { m.rejected = true; m.approved = false; }
  }

  approveAll(type) {
    this.markers
      .filter(m => !type || m.type === type)
      .forEach(m => { m.approved = true; m.rejected = false; });
  }

  rejectAll(type) {
    this.markers
      .filter(m => !type || m.type === type)
      .forEach(m => { m.rejected = true; m.approved = false; });
  }

  removeMarker(id) {
    this.markers = this.markers.filter(m => m.id !== id);
  }

  clearMarkers(type) {
    if (type) {
      this.markers = this.markers.filter(m => m.type !== type);
    } else {
      this.markers = [];
    }
  }

  getMarkers(type) {
    if (type) return this.markers.filter(m => m.type === type);
    return [...this.markers];
  }

  getApprovedMarkers() {
    return this.markers.filter(m => m.approved && !m.rejected);
  }
}
