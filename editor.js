// ===== EDITOR — Split, Delete, Ripple, Crossfade, etc. =====

export class Editor {
  constructor(engine) {
    this.engine = engine;
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndo = 50;
  }

  _saveUndo() {
    this.undoStack.push({
      buffer: this.engine.cloneBuffer(this.engine.workingBuffer),
      scrollOffset: 0,
      selection: null
    });
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    this.redoStack = [];
    this._updateUndoButtons();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push({
      buffer: this.engine.cloneBuffer(this.engine.workingBuffer)
    });
    const state = this.undoStack.pop();
    this.engine.workingBuffer = state.buffer;
    this.engine.duration = state.buffer.duration;
    this._updateUndoButtons();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push({
      buffer: this.engine.cloneBuffer(this.engine.workingBuffer)
    });
    const state = this.redoStack.pop();
    this.engine.workingBuffer = state.buffer;
    this.engine.duration = state.buffer.duration;
    this._updateUndoButtons();
    return true;
  }

  _updateUndoButtons() {
    const undoBtn = document.getElementById('btnUndo');
    const redoBtn = document.getElementById('btnRedo');
    if (undoBtn) undoBtn.disabled = this.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
  }

  // Split at a time position
  splitAt(time) {
    this._saveUndo();
    const buf = this.engine.workingBuffer;
    if (!buf || time <= 0 || time >= buf.duration) return null;

    const sr = buf.sampleRate;
    const splitSample = Math.round(time * sr);
    const numChannels = buf.numberOfChannels;

    // Create two new buffers
    const buf1 = this.engine.ctx.createBuffer(numChannels, splitSample, sr);
    const buf2 = this.engine.ctx.createBuffer(numChannels, buf.length - splitSample, sr);

    for (let ch = 0; ch < numChannels; ch++) {
      const src = buf.getChannelData(ch);
      const d1 = buf1.getChannelData(ch);
      const d2 = buf2.getChannelData(ch);
      d1.set(src.subarray(0, splitSample));
      d2.set(src.subarray(splitSample));
    }

    return { before: buf1, after: buf2, splitTime: time };
  }

  // Delete a time range (non-ripple)
  deleteRange(start, end) {
    this._saveUndo();
    const buf = this.engine.workingBuffer;
    if (!buf) return;

    start = Math.max(0, start);
    end = Math.min(buf.duration, end);
    if (start >= end) return;

    const sr = buf.sampleRate;
    const numChannels = buf.numberOfChannels;
    const startSample = Math.round(start * sr);
    const endSample = Math.round(end * sr);
    const newLength = buf.length - (endSample - startSample);

    if (newLength <= 0) return;

    const newBuf = this.engine.ctx.createBuffer(numChannels, newLength, sr);
    for (let ch = 0; ch < numChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = newBuf.getChannelData(ch);
      dst.set(src.subarray(0, startSample));
      dst.set(src.subarray(endSample), startSample);
    }

    this.engine.workingBuffer = newBuf;
    this.engine.duration = newBuf.duration;
    if (this.engine.pauseOffset > start) {
      this.engine.pauseOffset = Math.max(start, this.engine.pauseOffset - (end - start));
    }
  }

  // Ripple delete — removes range and joins the gap
  rippleDelete(start, end) {
    // Same as deleteRange for a single-track editor
    this.deleteRange(start, end);
  }

  // Trim to selection — keep only the selected range
  trimToSelection(start, end) {
    this._saveUndo();
    const buf = this.engine.workingBuffer;
    if (!buf) return;

    const sr = buf.sampleRate;
    const numChannels = buf.numberOfChannels;
    const startSample = Math.round(start * sr);
    const endSample = Math.round(end * sr);
    const newLength = endSample - startSample;

    if (newLength <= 0) return;

    const newBuf = this.engine.ctx.createBuffer(numChannels, newLength, sr);
    for (let ch = 0; ch < numChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = newBuf.getChannelData(ch);
      dst.set(src.subarray(startSample, endSample));
    }

    this.engine.workingBuffer = newBuf;
    this.engine.duration = newBuf.duration;
    this.engine.pauseOffset = 0;
  }

  // Insert silence at position
  insertSilence(time, duration) {
    this._saveUndo();
    const buf = this.engine.workingBuffer;
    if (!buf) return;

    const sr = buf.sampleRate;
    const numChannels = buf.numberOfChannels;
    const insertSample = Math.round(time * sr);
    const silenceSamples = Math.round(duration * sr);
    const newLength = buf.length + silenceSamples;

    const newBuf = this.engine.ctx.createBuffer(numChannels, newLength, sr);
    for (let ch = 0; ch < numChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = newBuf.getChannelData(ch);
      dst.set(src.subarray(0, insertSample));
      // Silence is already zero-filled
      dst.set(src.subarray(insertSample), insertSample + silenceSamples);
    }

    this.engine.workingBuffer = newBuf;
    this.engine.duration = newBuf.duration;
  }

  // Apply fade in
  fadeIn(start, end) {
    this._saveUndo();
    const buf = this.engine.workingBuffer;
    if (!buf) return;

    const sr = buf.sampleRate;
    const startSample = Math.round(start * sr);
    const endSample = Math.round(end * sr);
    const fadeLength = endSample - startSample;

    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = startSample; i < endSample && i < data.length; i++) {
        const t = (i - startSample) / fadeLength;
        data[i] *= t * t; // Quadratic fade
      }
    }
  }

  // Apply fade out
  fadeOut(start, end) {
    this._saveUndo();
    const buf = this.engine.workingBuffer;
    if (!buf) return;

    const sr = buf.sampleRate;
    const startSample = Math.round(start * sr);
    const endSample = Math.round(end * sr);
    const fadeLength = endSample - startSample;

    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = startSample; i < endSample && i < data.length; i++) {
        const t = 1 - (i - startSample) / fadeLength;
        data[i] *= t * t;
      }
    }
  }

  // Crossfade between two points (short overlap)
  crossfade(start, end, fadeDuration = 0.05) {
    this._saveUndo();
    // Apply fade out at start region and fade in at end region
    const fadeStart = end - fadeDuration;
    const fadeEnd = end + fadeDuration;

    const buf = this.engine.workingBuffer;
    if (!buf) return;

    const sr = buf.sampleRate;
    const fs = Math.round(fadeStart * sr);
    const fe = Math.round(fadeEnd * sr);
    const fd = fe - fs;

    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = fs; i < fe && i < data.length; i++) {
        const t = (i - fs) / fd;
        // Equal power crossfade
        data[i] *= Math.cos(t * Math.PI / 2);
      }
    }
  }

  // Duplicate selection
  duplicate(start, end) {
    this._saveUndo();
    const buf = this.engine.workingBuffer;
    if (!buf) return;

    const sr = buf.sampleRate;
    const startSample = Math.round(start * sr);
    const endSample = Math.round(end * sr);
    const selLen = endSample - startSample;
    const newLength = buf.length + selLen;

    const newBuf = this.engine.ctx.createBuffer(buf.numberOfChannels, newLength, sr);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = newBuf.getChannelData(ch);
      // Copy before
      dst.set(src.subarray(0, endSample));
      // Copy selection (duplicate)
      dst.set(src.subarray(startSample, endSample), endSample);
      // Copy after
      dst.set(src.subarray(endSample), endSample + selLen);
    }

    this.engine.workingBuffer = newBuf;
    this.engine.duration = newBuf.duration;
  }

  // Heal gap — crossfade across a gap
  healGap(start, end) {
    this._saveUndo();
    // First delete the gap, then crossfade the join
    const crossfadeDur = Math.min(0.05, (end - start) * 0.5);
    this.deleteRange(start, end);
    // Apply a short crossfade at the join point
    this.crossfade(start - crossfadeDur, start + crossfadeDur, crossfadeDur);
  }

  // Apply approved marker cuts
  applyMarkerCuts(markers) {
    // Sort markers by time (reverse order to preserve positions)
    const approved = markers
      .filter(m => m.approved && !m.rejected)
      .sort((a, b) => b.time - a.time); // Reverse order!

    if (approved.length === 0) return;

    this._saveUndo();

    for (const marker of approved) {
      const start = marker.time;
      const end = marker.time + (marker.duration || 0.3);
      this.deleteRange(start, end);
    }

    return approved.length;
  }
}
