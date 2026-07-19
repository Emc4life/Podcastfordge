// ===== WAVEFORM — Canvas Rendering & Interaction =====

export class WaveformRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;

    // View state
    this.pixelsPerSecond = 50;
    this.scrollOffset = 0; // in seconds
    this.trackHeight = 64;
    this.numTracks = 1;

    // Interaction state
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartScroll = 0;
    this.isSelecting = false;
    this.selectionStart = null; // in seconds
    this.selectionEnd = null;

    // Touch tracking
    this.lastTouchDist = 0;
    this.lastTouchX = 0;

    // Waveform cache
    this.waveformData = [];
    this._resizeObserver = null;

    this._initResize();
    this._initInteraction();
  }

  _initResize() {
    const resize = () => {
      const container = this.canvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = container.clientWidth * dpr;
      this.canvas.height = container.clientHeight * dpr;
      this.canvas.style.width = container.clientWidth + 'px';
      this.canvas.style.height = container.clientHeight + 'px';
      this.ctx.scale(dpr, dpr);
      this.displayWidth = container.clientWidth;
      this.displayHeight = container.clientHeight;
      this.render();
    };

    this._resizeObserver = new ResizeObserver(resize);
    this._resizeObserver.observe(this.canvas.parentElement);
    resize();
  }

  _initInteraction() {
    // Mouse
    this.canvas.addEventListener('mousedown', (e) => this._onPointerDown(e));
    window.addEventListener('mousemove', (e) => this._onPointerMove(e));
    window.addEventListener('mouseup', (e) => this._onPointerUp(e));

    // Touch
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        this._onPointerDown(e.touches[0]);
      } else if (e.touches.length === 2) {
        this._onPinchStart(e);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        this._onPointerMove(e.touches[0]);
      } else if (e.touches.length === 2) {
        this._onPinchMove(e);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      this._onPointerUp(e);
    });
  }

  _onPointerDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX || e.pageX) - rect.left;
    const y = (e.clientY || e.pageY) - rect.top;

    this.isDragging = true;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartScroll = this.scrollOffset;
    this._dragMoved = false;

    // Check if shift or ctrl for selection mode, or if there's an existing selection
    if (e.shiftKey || e.ctrlKey) {
      this.isSelecting = true;
      const time = this.xToTime(x);
      this.selectionStart = time;
      this.selectionEnd = time;
    } else {
      this.isSelecting = false;
    }
  }

  _onPointerMove(e) {
    if (!this.isDragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX || e.pageX) - rect.left;

    const moveDistance = Math.abs(x - this.dragStartX);
    if (moveDistance > 5) this._dragMoved = true;

    if (this.isSelecting) {
      this.selectionEnd = this.xToTime(x);
      this._updateSelectionOverlay();
      this.render();
    } else if (this._dragMoved) {
      // Scroll
      const dx = x - this.dragStartX;
      const timeDelta = dx / this.pixelsPerSecond;
      this.scrollOffset = Math.max(0, this.dragStartScroll - timeDelta);
      const maxScroll = Math.max(0, this.engine.getDuration() - this.displayWidth / this.pixelsPerSecond);
      this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
      this.render();
    }
  }

  _onPointerUp(e) {
    if (this.isDragging) {
      if (!this._dragMoved && !this.isSelecting) {
        // Simple tap — place playhead at click position
        const time = this.xToTime(this.dragStartX);
        this.engine.seek(Math.max(0, Math.min(time, this.engine.getDuration())));
        this.updatePlayhead(time);
      } else if (this.isSelecting && this.selectionStart !== null && this.selectionEnd !== null) {
        if (Math.abs(this.selectionEnd - this.selectionStart) < 0.05) {
          // Too small selection — treat as click to seek
          this.selectionStart = null;
          this.selectionEnd = null;
          this._updateSelectionOverlay();
          const time = this.xToTime(this.dragStartX);
          this.engine.seek(Math.max(0, Math.min(time, this.engine.getDuration())));
          this.updatePlayhead(time);
        }
      }
    }

    this.isDragging = false;
    this.isSelecting = false;
    this._dragMoved = false;
  }

  _onPinchStart(e) {
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    this.lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }

  _onPinchMove(e) {
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const scale = dist / this.lastTouchDist;

    this.pixelsPerSecond = Math.max(5, Math.min(2000, this.pixelsPerSecond * scale));
    this.lastTouchDist = dist;

    // Update zoom slider
    document.dispatchEvent(new CustomEvent('zoom-change', { detail: { pps: this.pixelsPerSecond } }));
    this.render();
  }

  xToTime(x) {
    return this.scrollOffset + x / this.pixelsPerSecond;
  }

  timeToX(time) {
    return (time - this.scrollOffset) * this.pixelsPerSecond;
  }

  setZoom(pps) {
    this.pixelsPerSecond = Math.max(5, Math.min(2000, pps));
    this.render();
  }

  zoomToFit() {
    const dur = this.engine.getDuration();
    if (dur <= 0) return;
    this.pixelsPerSecond = this.displayWidth / dur;
    this.scrollOffset = 0;
    this.render();
  }

  scrollToTime(time) {
    const visibleDur = this.displayWidth / this.pixelsPerSecond;
    if (time < this.scrollOffset || time > this.scrollOffset + visibleDur) {
      this.scrollOffset = Math.max(0, time - visibleDur * 0.1);
      this.render();
    }
  }

  updatePlayhead(time) {
    const el = document.getElementById('playhead');
    if (!el) return;
    const x = this.timeToX(time);
    el.style.left = x + 'px';

    // Auto-scroll
    const follow = document.getElementById('scrollFollow');
    if (follow && follow.checked) {
      const visibleDur = this.displayWidth / this.pixelsPerSecond;
      if (time > this.scrollOffset + visibleDur * 0.8 || time < this.scrollOffset) {
        this.scrollOffset = Math.max(0, time - visibleDur * 0.2);
        this.render();
      }
    }
  }

  _updateSelectionOverlay() {
    const el = document.getElementById('selectionOverlay');
    if (!this.selectionStart || !this.selectionEnd || Math.abs(this.selectionEnd - this.selectionStart) < 0.01) {
      el.style.display = 'none';
      return;
    }
    const start = Math.min(this.selectionStart, this.selectionEnd);
    const end = Math.max(this.selectionStart, this.selectionEnd);
    const x1 = this.timeToX(start);
    const x2 = this.timeToX(end);
    el.style.display = 'block';
    el.style.left = x1 + 'px';
    el.style.width = (x2 - x1) + 'px';
  }

  setSelection(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
    this._updateSelectionOverlay();
    this.render();
  }

  clearSelection() {
    this.selectionStart = null;
    this.selectionEnd = null;
    this._updateSelectionOverlay();
    this.render();
  }

  getSelection() {
    if (!this.selectionStart || !this.selectionEnd) return null;
    return {
      start: Math.min(this.selectionStart, this.selectionEnd),
      end: Math.max(this.selectionStart, this.selectionEnd)
    };
  }

  refreshData() {
    this.waveformData = this.engine.getWaveformData(Math.max(2000, Math.ceil(this.engine.getDuration() * 100)));
    this.render();
  }

  render() {
    if (!this.displayWidth) return;
    const ctx = this.ctx;
    const w = this.displayWidth;
    const h = this.displayHeight;
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0d0d20';
    ctx.fillRect(0, 0, w, h);

    // Grid lines (time markers)
    this._drawGrid(ctx, w, h);

    // Draw waveform
    this._drawWaveform(ctx, w, h);

    // Draw markers
    // (markers are rendered as DOM overlays, not canvas)

    ctx.restore();
  }

  _drawGrid(ctx, w, h) {
    const dur = this.engine.getDuration();
    if (dur <= 0) return;

    // Determine grid interval
    const visibleDur = w / this.pixelsPerSecond;
    let interval;
    if (visibleDur > 600) interval = 60;
    else if (visibleDur > 120) interval = 30;
    else if (visibleDur > 60) interval = 10;
    else if (visibleDur > 30) interval = 5;
    else if (visibleDur > 10) interval = 2;
    else if (visibleDur > 5) interval = 1;
    else if (visibleDur > 2) interval = 0.5;
    else interval = 0.1;

    ctx.strokeStyle = '#1a1a3a';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#555580';
    ctx.font = '10px Inter, sans-serif';

    const startSec = Math.floor(this.scrollOffset / interval) * interval;
    for (let t = startSec; t < this.scrollOffset + visibleDur + interval; t += interval) {
      const x = this.timeToX(t);
      if (x < 0 || x > w) continue;

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      // Label
      const mins = Math.floor(t / 60);
      const secs = (t % 60).toFixed(interval < 1 ? 1 : 0);
      const label = `${mins}:${secs.padStart(interval < 1 ? 4 : 2, '0')}`;
      ctx.fillText(label, x + 3, 12);
    }

    // Center line
    const cy = h / 2;
    ctx.strokeStyle = '#2a2a4a';
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
  }

  _drawWaveform(ctx, w, h) {
    const buffer = this.engine.workingBuffer;
    if (!buffer) return;

    const channelData = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const cy = h / 2;
    const amplitude = h / 2 - 4;

    // Draw using pixel-based approach for performance
    ctx.fillStyle = '#6C3AFF';
    ctx.globalAlpha = 0.85;

    const startSample = Math.floor(this.scrollOffset * sr);
    const endSample = Math.ceil((this.scrollOffset + w / this.pixelsPerSecond) * sr);
    const samplesPerPixel = sr / this.pixelsPerSecond;

    for (let px = 0; px < w; px++) {
      const s0 = Math.floor(startSample + px * samplesPerPixel);
      const s1 = Math.floor(startSample + (px + 1) * samplesPerPixel);

      let min = 0, max = 0;
      for (let i = s0; i < s1 && i < channelData.length; i++) {
        const val = channelData[i];
        if (val < min) min = val;
        if (val > max) max = val;
      }

      const top = cy - max * amplitude;
      const bottom = cy - min * amplitude;
      ctx.fillRect(px, top, 1, Math.max(1, bottom - top));
    }

    // Selection highlight
    if (this.selectionStart !== null && this.selectionEnd !== null) {
      const sStart = Math.min(this.selectionStart, this.selectionEnd);
      const sEnd = Math.max(this.selectionStart, this.selectionEnd);
      const x1 = this.timeToX(sStart);
      const x2 = this.timeToX(sEnd);
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#6C3AFF';
      ctx.fillRect(x1, 0, x2 - x1, h);
    }

    ctx.globalAlpha = 1.0;
  }

  destroy() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
  }
}
