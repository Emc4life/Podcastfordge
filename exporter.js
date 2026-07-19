// ===== EXPORTER — WAV, MP3 Export with Loudness Normalization =====

export class Exporter {
  constructor(engine) {
    this.engine = engine;
  }

  // Export as WAV
  exportWAV(buffer, bitDepth = 16) {
    const numChannels = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = length * blockAlign;
    const headerSize = 44;

    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);

    // RIFF header
    this._writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this._writeString(view, 8, 'WAVE');

    // fmt chunk
    this._writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);

    // data chunk
    this._writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write samples
    let offset = 44;
    const channelData = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channelData.push(buffer.getChannelData(ch));
    }

    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = channelData[ch][i];
        sample = Math.max(-1, Math.min(1, sample));

        if (bitDepth === 16) {
          const val = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          view.setInt16(offset, val | 0, true);
          offset += 2;
        } else if (bitDepth === 24) {
          const val = sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF;
          const intVal = val | 0;
          view.setUint8(offset, intVal & 0xFF);
          view.setUint8(offset + 1, (intVal >> 8) & 0xFF);
          view.setUint8(offset + 2, (intVal >> 16) & 0xFF);
          offset += 3;
        } else if (bitDepth === 32) {
          view.setFloat32(offset, sample, true);
          offset += 4;
        }
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  // Export as MP3 using lamejs (if available) or fallback to WAV
  async exportMP3(buffer, bitrate = 128) {
    // Try to use lamejs if available
    if (window.lamejs) {
      return this._exportMP3Lame(buffer, bitrate);
    }

    // Fallback: Export as WAV with note
    console.warn('MP3 encoding requires lamejs. Falling back to WAV.');
    return this.exportWAV(buffer, 16);
  }

  _exportMP3Lame(buffer, bitrate) {
    const mp3encoder = new window.lamejs.Mp3Encoder(buffer.numberOfChannels, buffer.sampleRate, bitrate);
    const mp3Data = [];
    const sampleBlockSize = 1152;

    const leftChannel = buffer.getChannelData(0);
    const rightChannel = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

    const leftInt16 = this._floatTo16(leftChannel);
    const rightInt16 = rightChannel ? this._floatTo16(rightChannel) : null;

    for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
      const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
      let mp3buf;
      if (rightInt16) {
        const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
        mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      } else {
        mp3buf = mp3encoder.encodeBuffer(leftChunk);
      }
      if (mp3buf.length > 0) mp3Data.push(mp3buf);
    }

    const end = mp3encoder.flush();
    if (end.length > 0) mp3Data.push(end);

    return new Blob(mp3Data, { type: 'audio/mp3' });
  }

  _floatTo16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  // Full export pipeline
  async exportFile(options = {}) {
    const {
      format = 'wav',
      sampleRate = 44100,
      bitDepth = 16,
      channels = 1,
      bitrate = 128,
      targetLufs = -19,
      ceiling = -1,
      metadata = {},
      onProgress
    } = options;

    if (onProgress) onProgress(0.1, 'Rendering audio...');

    // Render with processing chain
    const result = await this.engine.renderOffline(targetLufs, ceiling);
    if (!result) throw new Error('No audio to export');

    if (onProgress) onProgress(0.7, 'Encoding file...');

    // Resample if needed
    let exportBuffer = result.buffer;
    if (exportBuffer.sampleRate !== sampleRate) {
      exportBuffer = await this._resample(exportBuffer, sampleRate);
    }

    // Convert channels if needed
    if (channels === 1 && exportBuffer.numberOfChannels > 1) {
      exportBuffer = this._toMono(exportBuffer);
    } else if (channels === 2 && exportBuffer.numberOfChannels === 1) {
      exportBuffer = this._toStereo(exportBuffer);
    }

    let blob;
    let filename;
    let mimeType;

    switch (format) {
      case 'wav':
        blob = this.exportWAV(exportBuffer, bitDepth);
        filename = `${metadata.title || 'episode'}.wav`;
        mimeType = 'audio/wav';
        break;
      case 'mp3':
        blob = await this.exportMP3(exportBuffer, bitrate);
        filename = `${metadata.title || 'episode'}.mp3`;
        mimeType = 'audio/mp3';
        break;
      case 'aac':
        // Try MediaRecorder for AAC
        blob = await this._exportAAC(exportBuffer, bitrate);
        filename = `${metadata.title || 'episode'}.m4a`;
        mimeType = 'audio/mp4';
        break;
      case 'flac':
        // FLAC not directly supported in browser, fall back to WAV
        blob = this.exportWAV(exportBuffer, 24);
        filename = `${metadata.title || 'episode'}.wav`;
        mimeType = 'audio/wav';
        break;
      default:
        blob = this.exportWAV(exportBuffer, bitDepth);
        filename = `${metadata.title || 'episode'}.wav`;
        mimeType = 'audio/wav';
    }

    if (onProgress) onProgress(1, 'Done!');

    return {
      blob,
      filename,
      mimeType,
      report: result.report
    };
  }

  async _resample(buffer, targetSr) {
    if (buffer.sampleRate === targetSr) return buffer;

    const offlineCtx = new OfflineAudioContext(
      buffer.numberOfChannels,
      Math.ceil(buffer.duration * targetSr),
      targetSr
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    return await offlineCtx.startRendering();
  }

  _toMono(buffer) {
    const mono = new AudioBuffer({
      numberOfChannels: 1,
      length: buffer.length,
      sampleRate: buffer.sampleRate
    });
    const monoData = mono.getChannelData(0);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        monoData[i] += data[i] / buffer.numberOfChannels;
      }
    }
    return mono;
  }

  _toStereo(buffer) {
    const stereo = new AudioBuffer({
      numberOfChannels: 2,
      length: buffer.length,
      sampleRate: buffer.sampleRate
    });
    const data = buffer.getChannelData(0);
    stereo.getChannelData(0).set(data);
    stereo.getChannelData(1).set(data);
    return stereo;
  }

  async _exportAAC(buffer, bitrate) {
    // Try using MediaRecorder for AAC/M4A
    const mimeTypes = [
      'audio/mp4;codecs=aac',
      'audio/mp4',
      'audio/aac',
      'audio/webm;codecs=opus'
    ];

    let selectedMime = null;
    for (const mime of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mime)) {
        selectedMime = mime;
        break;
      }
    }

    if (!selectedMime) {
      // Fallback to WAV
      return this.exportWAV(buffer, 16);
    }

    // Create a MediaStream from the buffer
    const audioCtx = new AudioContext({ sampleRate: buffer.sampleRate });
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);

    const recorder = new MediaRecorder(dest.stream, {
      mimeType: selectedMime,
      audioBitsPerSecond: bitrate * 1000
    });

    const chunks = [];
    return new Promise((resolve) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        audioCtx.close();
        resolve(new Blob(chunks, { type: selectedMime }));
      };
      recorder.start();
      source.start(0);
      source.onended = () => {
        setTimeout(() => recorder.stop(), 100);
      };
    });
  }

  _writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}
