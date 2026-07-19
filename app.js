// ===== PODCASTFORGE — Main App Controller =====

import { AudioEngine } from './audio-engine.js';
import { WaveformRenderer } from './waveform.js';
import { Editor } from './editor.js';
import { Detector } from './detector.js';
import { Exporter } from './exporter.js';

class PodcastForge {
  constructor() {
    this.engine = new AudioEngine();
    this.waveform = null;
    this.editor = null;
    this.detector = null;
    this.exporter = null;

    this.activeTab = 'effects';
    this.activeChainStep = null;
    this.clipType = 'vocal';

    this._animationFrame = null;
    this._audioLoaded = false;

    this._init();
  }

  _init() {
    this.editor = new Editor(this.engine);
    this.detector = new Detector(this.engine);
    this.exporter = new Exporter(this.engine);

    this._bindUI();
    this._bindTransport();
    this._bindTabs();
    this._bindEffects();
    this._bindEditTools();
    this._bindDetector();
    this._bindExporter();
    this._bindFileLoading();
    this._bindSettings();
    this._bindPlaybackEvents();

    // Load lamejs for MP3 export
    this._loadLamejs();
    this._bindKeyboard();
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't capture when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      switch(e.key) {
        case ' ':
          e.preventDefault();
          if (!this._audioLoaded) return;
          if (this.engine.isPlaying) this.engine.pause();
          else this.engine.play();
          break;
        case 's':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            // Could implement project save
          }
          break;
        case 'z':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) { if (this.editor.redo()) this._onBufferChanged(); }
            else { if (this.editor.undo()) this._onBufferChanged(); }
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (this.waveform?.getSelection()) {
            const sel = this.waveform.getSelection();
            this.editor.deleteRange(sel.start, sel.end);
            this.waveform.clearSelection();
            this._onBufferChanged();
          }
          break;
        case 'j':
          if (this._audioLoaded) this.engine.seek(Math.max(0, this.engine.getCurrentTime() - 1));
          break;
        case 'k':
          if (this._audioLoaded) this.engine.seek(Math.min(this.engine.getDuration(), this.engine.getCurrentTime() + 1));
          break;
        case 'Home':
          if (this._audioLoaded) this.engine.seek(0);
          break;
        case 'End':
          if (this._audioLoaded) this.engine.seek(this.engine.getDuration());
          break;
      }
    });
  }

  // ===== UI BINDING =====
  _bindUI() {
    // Project name editing
    const nameEl = document.getElementById('projectName');
    nameEl.addEventListener('dblclick', () => {
      const newName = prompt('Project name:', nameEl.textContent);
      if (newName) nameEl.textContent = newName;
    });

    // Open file from top bar
    document.getElementById('btnOpenFileTop').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });

    // Undo/Redo
    document.getElementById('btnUndo').addEventListener('click', () => {
      if (this.editor.undo()) {
        this._onBufferChanged();
      }
    });
    document.getElementById('btnRedo').addEventListener('click', () => {
      if (this.editor.redo()) {
        this._onBufferChanged();
      }
    });
  }

  _bindTransport() {
    const btnPlay = document.getElementById('btnPlayPause');
    const btnStop = null; // Using play/pause toggle
    const btnRec = document.getElementById('btnRecord');

    btnPlay.addEventListener('click', () => {
      if (!this._audioLoaded) return;
      if (this.engine.isPlaying) {
        this.engine.pause();
      } else {
        this.engine.play();
      }
    });

    document.getElementById('btnSkipBack5').addEventListener('click', () => {
      this.engine.seek(Math.max(0, this.engine.getCurrentTime() - 5));
    });
    document.getElementById('btnSkipBack1').addEventListener('click', () => {
      this.engine.seek(Math.max(0, this.engine.getCurrentTime() - 1));
    });
    document.getElementById('btnSkipFwd1').addEventListener('click', () => {
      this.engine.seek(Math.min(this.engine.getDuration(), this.engine.getCurrentTime() + 1));
    });
    document.getElementById('btnSkipFwd5').addEventListener('click', () => {
      this.engine.seek(Math.min(this.engine.getDuration(), this.engine.getCurrentTime() + 5));
    });

    btnRec.addEventListener('click', () => {
      if (this.engine.isRecording) {
        this.engine.stopRecording();
      } else {
        this._startRecording();
      }
    });

    // Zoom
    document.getElementById('btnZoomIn').addEventListener('click', () => {
      if (this.waveform) this.waveform.setZoom(this.waveform.pixelsPerSecond * 1.5);
    });
    document.getElementById('btnZoomOut').addEventListener('click', () => {
      if (this.waveform) this.waveform.setZoom(this.waveform.pixelsPerSecond / 1.5);
    });
    document.getElementById('btnZoomFit').addEventListener('click', () => {
      if (this.waveform) this.waveform.zoomToFit();
    });
    document.getElementById('zoomSlider').addEventListener('input', (e) => {
      if (this.waveform) this.waveform.setZoom(Number(e.target.value));
    });
  }

  _bindTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        panels.forEach(p => p.classList.remove('active'));
        document.getElementById(`panel${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
        this.activeTab = tab;
      });
    });
  }

  _bindEffects() {
    // Preset selector
    document.getElementById('voicePreset').addEventListener('change', (e) => {
      this._applyPreset(e.target.value);
    });

    // Render chain list
    this._renderChainList();
  }

  _renderChainList() {
    const list = document.getElementById('chainList');
    const steps = [
      { key: 'hpf', name: 'High-Pass Filter', desc: 'Cuts low rumble, plosives, handling noise', num: 1 },
      { key: 'noiseReduction', name: 'Noise Reduction', desc: 'Reduces constant background hiss & hum', num: 2 },
      { key: 'noiseGate', name: 'Noise Gate / Expander', desc: 'Mutes low-level noise between phrases', num: 3 },
      { key: 'notchFilter', name: 'Notch Filter (Hum)', desc: 'Removes 50/60 Hz mains hum & harmonics', num: 4 },
      { key: 'eq', name: 'EQ', desc: 'Shape voice: cut mud, boost presence & air', num: 5 },
      { key: 'deEsser', name: 'De-Esser', desc: 'Controls harsh S, SH, CH sibilance', num: 6 },
      { key: 'compressor', name: 'Compressor', desc: 'Steady, present, professional voice level', num: 7 },
      { key: 'limiter', name: 'Limiter', desc: 'Final protection against clipping', num: 8 },
      { key: 'loudness', name: 'Loudness Normalization', desc: 'Hit podcast LUFS targets on export', num: 9 }
    ];

    list.innerHTML = steps.map(step => {
      const stepData = this.engine.chain[step.key];
      const enabled = stepData.enabled;
      return `
        <div class="chain-step ${enabled ? '' : 'disabled'} ${this.activeChainStep === step.key ? 'active-step' : ''}" data-step="${step.key}">
          <div class="chain-step-num">${step.num}</div>
          <div class="chain-step-info">
            <div class="chain-step-name">${step.name}</div>
            <div class="chain-step-desc">${step.desc}</div>
          </div>
          <label class="chain-step-toggle" onclick="event.stopPropagation()">
            <input type="checkbox" ${enabled ? 'checked' : ''} data-toggle="${step.key}">
            <span class="toggle-slider"></span>
          </label>
        </div>
      `;
    }).join('');

    // Bind clicks
    list.querySelectorAll('.chain-step').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.chain-step-toggle')) return;
        this._openChainStepDetail(el.dataset.step);
      });
    });

    // Bind toggles
    list.querySelectorAll('input[data-toggle]').forEach(el => {
      el.addEventListener('change', (e) => {
        const key = el.dataset.toggle;
        this.engine.chain[key].enabled = el.checked;
        el.closest('.chain-step').classList.toggle('disabled', !el.checked);
      });
    });
  }

  _openChainStepDetail(stepKey) {
    this.activeChainStep = stepKey;
    const chain = this.engine.chain[stepKey];
    const modal = document.getElementById('chainModal');
    const title = document.getElementById('chainModalTitle');
    const body = document.getElementById('chainModalBody');

    const stepNames = {
      hpf: 'High-Pass Filter',
      noiseReduction: 'Noise Reduction',
      noiseGate: 'Noise Gate',
      notchFilter: 'Notch Filter (Hum Removal)',
      eq: 'EQ',
      deEsser: 'De-Esser',
      compressor: 'Compressor',
      limiter: 'Limiter',
      loudness: 'Loudness Normalization'
    };

    title.textContent = stepNames[stepKey] || stepKey;

    let html = '';
    switch (stepKey) {
      case 'hpf':
        html = `
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Cutoff Frequency</span><span class="chain-control-val" id="hpfFreqVal">${chain.freq} Hz</span></div>
            <input type="range" min="20" max="300" value="${chain.freq}" id="hpfFreq">
          </div>
        `;
        break;
      case 'noiseReduction':
        html = `
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Strength</span><span class="chain-control-val" id="nrStrVal">${(chain.strength * 100).toFixed(0)}%</span></div>
            <input type="range" min="0" max="100" value="${chain.strength * 100}" id="nrStrength">
          </div>
          <p style="font-size:12px;color:var(--text-secondary);margin-top:8px">Light noise reduction preserves natural voice quality. Use with noise gate for best results.</p>
        `;
        break;
      case 'noiseGate':
        html = `
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Threshold</span><span class="chain-control-val" id="ngThVal">${chain.threshold} dB</span></div>
            <input type="range" min="-80" max="-10" value="${chain.threshold}" id="ngThreshold">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Attack</span><span class="chain-control-val" id="ngAtkVal">${(chain.attack * 1000).toFixed(0)} ms</span></div>
            <input type="range" min="1" max="50" value="${chain.attack * 1000}" id="ngAttack">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Release</span><span class="chain-control-val" id="ngRelVal">${(chain.release * 1000).toFixed(0)} ms</span></div>
            <input type="range" min="10" max="500" value="${chain.release * 1000}" id="ngRelease">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Floor</span><span class="chain-control-val" id="ngFlrVal">${chain.floor} dB</span></div>
            <input type="range" min="-100" max="-20" value="${chain.floor}" id="ngFloor">
          </div>
        `;
        break;
      case 'notchFilter':
        html = `
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Frequency</span><span class="chain-control-val" id="nfFreqVal">${chain.freq} Hz</span></div>
            <input type="range" min="40" max="200" value="${chain.freq}" id="nfFreq">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Q (Width)</span><span class="chain-control-val" id="nfQVal">${chain.q}</span></div>
            <input type="range" min="5" max="100" value="${chain.q}" id="nfQ">
          </div>
          <p style="font-size:12px;color:var(--text-secondary);margin-top:8px">Set to 60 Hz for US power hum, 50 Hz for EU/Asia. Harmonics at 2× and 3× are also removed.</p>
        `;
        break;
      case 'eq':
        html = `
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Low Cut</span><span class="chain-control-val" id="eqLcVal">${chain.eq.lowCut.freq} Hz</span></div>
            <input type="range" min="20" max="200" value="${chain.eq.lowCut.freq}" id="eqLowCut">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Mud Cut</span><span class="chain-control-val" id="eqMcVal">${chain.eq.mudCut.gain > 0 ? '+' : ''}${chain.eq.mudCut.gain} dB @ ${chain.eq.mudCut.freq} Hz</span></div>
            <input type="range" min="-12" max="6" value="${chain.eq.mudCut.gain}" id="eqMudCut">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Presence Boost</span><span class="chain-control-val" id="eqPrVal">${chain.eq.presence.gain > 0 ? '+' : ''}${chain.eq.presence.gain} dB @ ${chain.eq.presence.freq} Hz</span></div>
            <input type="range" min="-6" max="12" value="${chain.eq.presence.gain}" id="eqPresence">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Air</span><span class="chain-control-val" id="eqArVal">${chain.eq.air.gain > 0 ? '+' : ''}${chain.eq.air.gain} dB @ ${chain.eq.air.freq} Hz</span></div>
            <input type="range" min="-6" max="6" value="${chain.eq.air.gain}" id="eqAir">
          </div>
        `;
        break;
      case 'deEsser':
        html = `
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Target Frequency</span><span class="chain-control-val" id="dsFreqVal">${chain.freq} Hz</span></div>
            <input type="range" min="3000" max="10000" value="${chain.freq}" id="dsFreq">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Threshold</span><span class="chain-control-val" id="dsThVal">${chain.threshold} dB</span></div>
            <input type="range" min="-40" max="0" value="${chain.threshold}" id="dsThreshold">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Reduction</span><span class="chain-control-val" id="dsRedVal">${chain.reduction} dB</span></div>
            <input type="range" min="0" max="20" value="${chain.reduction}" id="dsReduction">
          </div>
        `;
        break;
      case 'compressor':
        html = `
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Threshold</span><span class="chain-control-val" id="cmpThVal">${chain.threshold} dB</span></div>
            <input type="range" min="-40" max="0" value="${chain.threshold}" id="cmpThreshold">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Ratio</span><span class="chain-control-val" id="cmpRtVal">${chain.ratio}:1</span></div>
            <input type="range" min="1" max="20" value="${chain.ratio}" id="cmpRatio">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Attack</span><span class="chain-control-val" id="cmpAtkVal">${(chain.attack * 1000).toFixed(0)} ms</span></div>
            <input type="range" min="1" max="100" value="${chain.attack * 1000}" id="cmpAttack">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Release</span><span class="chain-control-val" id="cmpRelVal">${(chain.release * 1000).toFixed(0)} ms</span></div>
            <input type="range" min="10" max="500" value="${chain.release * 1000}" id="cmpRelease">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Knee</span><span class="chain-control-val" id="cmpKnVal">${chain.knee} dB</span></div>
            <input type="range" min="0" max="30" value="${chain.knee}" id="cmpKnee">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Makeup Gain</span><span class="chain-control-val" id="cmpMgVal">${chain.makeupGain} dB</span></div>
            <input type="range" min="0" max="24" value="${chain.makeupGain}" id="cmpMakeup">
          </div>
        `;
        break;
      case 'limiter':
        html = `
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Output Ceiling</span><span class="chain-control-val" id="limCeVal">${chain.ceiling} dBTP</span></div>
            <input type="range" min="-3" max="0" step="0.1" value="${chain.ceiling}" id="limCeiling">
          </div>
          <p style="font-size:12px;color:var(--text-secondary);margin-top:8px">Apple & Spotify recommend -1 dBTP to prevent distortion in lossy encoding.</p>
        `;
        break;
      case 'loudness':
        html = `
          <div class="chain-control-group">
            <div class="chain-control-label"><span>Target LUFS</span><span class="chain-control-val" id="lnLufsVal">${chain.target} LUFS</span></div>
            <input type="range" min="-24" max="-10" value="${chain.target}" id="lnTarget">
          </div>
          <div class="chain-control-group">
            <div class="chain-control-label"><span>True Peak Ceiling</span><span class="chain-control-val" id="lnCeVal">${chain.ceiling} dBTP</span></div>
            <input type="range" min="-3" max="0" step="0.1" value="${chain.ceiling}" id="lnCeiling">
          </div>
          <p style="font-size:12px;color:var(--text-secondary);margin-top:8px">
            Apple Podcasts: -16 LUFS stereo / -19 LUFS mono<br>
            Spotify: -14 LUFS (playback normalized)<br>
            True peak should not exceed -1 dBTP
          </p>
        `;
        break;
    }

    body.innerHTML = html;

    // Bind control changes
    this._bindChainControls(stepKey);

    modal.style.display = 'flex';
    document.getElementById('closeChainModal').addEventListener('click', () => {
      modal.style.display = 'none';
      this.activeChainStep = null;
      this._renderChainList();
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
        this.activeChainStep = null;
        this._renderChainList();
      }
    });
  }

  _bindChainControls(stepKey) {
    const chain = this.engine.chain[stepKey];

    const bind = (id, prop, display, format) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        const val = Number(el.value);
        if (prop.includes('.')) {
          const parts = prop.split('.');
          let obj = chain;
          for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
          obj[parts[parts.length - 1]] = val;
        } else {
          chain[prop] = val;
        }
        if (display) {
          const dispEl = document.getElementById(display);
          if (dispEl && format) dispEl.textContent = format(val);
        }
      });
    };

    switch (stepKey) {
      case 'hpf':
        bind('hpfFreq', 'freq', 'hpfFreqVal', v => `${v} Hz`);
        break;
      case 'noiseReduction':
        bind('nrStrength', 'strength', 'nrStrVal', v => `${v}%`);
        chain.strength = Number(document.getElementById('nrStrength')?.value || chain.strength * 100) / 100;
        break;
      case 'noiseGate':
        bind('ngThreshold', 'threshold', 'ngThVal', v => `${v} dB`);
        bind('ngAttack', 'attack', 'ngAtkVal', v => `${v} ms`);
        bind('ngRelease', 'release', 'ngRelVal', v => `${v} ms`);
        bind('ngFloor', 'floor', 'ngFlrVal', v => `${v} dB`);
        // Convert ms back to seconds for attack/release
        document.getElementById('ngAttack')?.addEventListener('change', (e) => { chain.attack = Number(e.target.value) / 1000; });
        document.getElementById('ngRelease')?.addEventListener('change', (e) => { chain.release = Number(e.target.value) / 1000; });
        break;
      case 'notchFilter':
        bind('nfFreq', 'freq', 'nfFreqVal', v => `${v} Hz`);
        bind('nfQ', 'q', 'nfQVal', v => `${v}`);
        break;
      case 'eq':
        bind('eqLowCut', 'eq.lowCut.freq', 'eqLcVal', v => `${v} Hz`);
        bind('eqMudCut', 'eq.mudCut.gain', 'eqMcVal', v => `${v > 0 ? '+' : ''}${v} dB @ ${chain.eq.mudCut.freq} Hz`);
        bind('eqPresence', 'eq.presence.gain', 'eqPrVal', v => `${v > 0 ? '+' : ''}${v} dB @ ${chain.eq.presence.freq} Hz`);
        bind('eqAir', 'eq.air.gain', 'eqArVal', v => `${v > 0 ? '+' : ''}${v} dB @ ${chain.eq.air.freq} Hz`);
        break;
      case 'deEsser':
        bind('dsFreq', 'freq', 'dsFreqVal', v => `${v} Hz`);
        bind('dsThreshold', 'threshold', 'dsThVal', v => `${v} dB`);
        bind('dsReduction', 'reduction', 'dsRedVal', v => `${v} dB`);
        break;
      case 'compressor':
        bind('cmpThreshold', 'threshold', 'cmpThVal', v => `${v} dB`);
        bind('cmpRatio', 'ratio', 'cmpRtVal', v => `${v}:1`);
        bind('cmpAttack', 'attack', 'cmpAtkVal', v => `${v} ms`);
        bind('cmpRelease', 'release', 'cmpRelVal', v => `${v} ms`);
        bind('cmpKnee', 'knee', 'cmpKnVal', v => `${v} dB`);
        bind('cmpMakeup', 'makeupGain', 'cmpMgVal', v => `${v} dB`);
        document.getElementById('cmpAttack')?.addEventListener('change', (e) => { chain.attack = Number(e.target.value) / 1000; });
        document.getElementById('cmpRelease')?.addEventListener('change', (e) => { chain.release = Number(e.target.value) / 1000; });
        break;
      case 'limiter':
        bind('limCeiling', 'ceiling', 'limCeVal', v => `${v} dBTP`);
        break;
      case 'loudness':
        bind('lnTarget', 'target', 'lnLufsVal', v => `${v} LUFS`);
        bind('lnCeiling', 'ceiling', 'lnCeVal', v => `${v} dBTP`);
        break;
    }
  }

  _applyPreset(presetName) {
    const preset = this.engine.presets[presetName];
    if (!preset) return;

    // Deep copy preset into chain
    const chain = this.engine.chain;
    for (const key of Object.keys(preset)) {
      if (key === 'name') continue;
      const presetVal = preset[key];
      const chainVal = chain[key];

      if (typeof presetVal === 'object' && presetVal !== null) {
        for (const subKey of Object.keys(presetVal)) {
          if (typeof presetVal[subKey] === 'object' && presetVal[subKey] !== null && !Array.isArray(presetVal[subKey])) {
            if (!chainVal[subKey]) chainVal[subKey] = {};
            for (const sk2 of Object.keys(presetVal[subKey])) {
              chainVal[subKey][sk2] = presetVal[subKey][sk2];
            }
          } else {
            chainVal[subKey] = presetVal[subKey];
          }
        }
      } else {
        chain[key] = presetVal;
      }
    }

    this._renderChainList();
    this._toast(`Applied "${preset.name}" preset`);
  }

  _bindEditTools() {
    // Clip type buttons
    document.querySelectorAll('.clip-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.clip-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.clipType = btn.dataset.type;
      });
    });

    // Edit tool buttons
    document.getElementById('btnSplit').addEventListener('click', () => {
      if (!this._audioLoaded) return;
      const time = this.engine.getCurrentTime();
      const result = this.editor.splitAt(time);
      if (result) {
        this._toast(`Split at ${this._formatTime(time)}`);
        this._onBufferChanged();
      }
    });

    document.getElementById('btnDelete').addEventListener('click', () => {
      if (!this._audioLoaded) return;
      const sel = this.waveform?.getSelection();
      if (sel) {
        this.editor.deleteRange(sel.start, sel.end);
        this.waveform.clearSelection();
        this._toast('Deleted selection');
        this._onBufferChanged();
      } else {
        this._toast('Select a region first (drag on waveform)');
      }
    });

    document.getElementById('btnRippleDelete').addEventListener('click', () => {
      if (!this._audioLoaded) return;
      const sel = this.waveform?.getSelection();
      if (sel) {
        this.editor.rippleDelete(sel.start, sel.end);
        this.waveform.clearSelection();
        this._toast('Ripple deleted selection');
        this._onBufferChanged();
      } else {
        this._toast('Select a region first');
      }
    });

    document.getElementById('btnTrimToSel').addEventListener('click', () => {
      if (!this._audioLoaded) return;
      const sel = this.waveform?.getSelection();
      if (sel) {
        this.editor.trimToSelection(sel.start, sel.end);
        this.waveform.clearSelection();
        this._toast('Trimmed to selection');
        this._onBufferChanged();
      } else {
        this._toast('Select a region first');
      }
    });

    document.getElementById('btnCrossfade').addEventListener('click', () => {
      if (!this._audioLoaded) return;
      const time = this.engine.getCurrentTime();
      this.editor.crossfade(time - 0.05, time + 0.05, 0.05);
      this._toast('Applied crossfade at cursor');
      this._onBufferChanged();
    });

    document.getElementById('btnFadeIn').addEventListener('click', () => {
      if (!this._audioLoaded) return;
      const sel = this.waveform?.getSelection();
      if (sel) {
        this.editor.fadeIn(sel.start, sel.end);
        this._toast('Applied fade in');
        this._onBufferChanged();
      } else {
        // Fade in from cursor for 1 second
        const time = this.engine.getCurrentTime();
        this.editor.fadeIn(time, time + 1);
        this._toast('Applied 1s fade in');
        this._onBufferChanged();
      }
    });

    document.getElementById('btnFadeOut').addEventListener('click', () => {
      if (!this._audioLoaded) return;
      const sel = this.waveform?.getSelection();
      if (sel) {
        this.editor.fadeOut(sel.start, sel.end);
        this._toast('Applied fade out');
        this._onBufferChanged();
      } else {
        const time = this.engine.getCurrentTime();
        this.editor.fadeOut(time - 1, time);
        this._toast('Applied 1s fade out');
        this._onBufferChanged();
      }
    });

    document.getElementById('btnInsertSilence').addEventListener('click', () => {
      if (!this._audioLoaded) return;
      const time = this.engine.getCurrentTime();
      const dur = prompt('Silence duration (seconds):', '0.5');
      if (dur && Number(dur) > 0) {
        this.editor.insertSilence(time, Number(dur));
        this._toast(`Inserted ${dur}s silence`);
        this._onBufferChanged();
      }
    });

    document.getElementById('btnDuplicate').addEventListener('click', () => {
      if (!this._audioLoaded) return;
      const sel = this.waveform?.getSelection();
      if (sel) {
        this.editor.duplicate(sel.start, sel.end);
        this._toast('Duplicated selection');
        this._onBufferChanged();
      } else {
        this._toast('Select a region first');
      }
    });

    document.getElementById('btnHealGap').addEventListener('click', () => {
      if (!this._audioLoaded) return;
      const sel = this.waveform?.getSelection();
      if (sel) {
        this.editor.healGap(sel.start, sel.end);
        this.waveform.clearSelection();
        this._toast('Healed gap');
        this._onBufferChanged();
      } else {
        this._toast('Select a gap to heal');
      }
    });
  }

  _bindDetector() {
    const btnSilence = document.getElementById('btnDetectSilence');
    const btnFillers = document.getElementById('btnDetectFillers');
    const progressEl = document.getElementById('detectProgress');
    const progressFill = document.getElementById('detectProgressFill');
    const progressText = document.getElementById('detectProgressText');

    // Threshold slider
    document.getElementById('silenceThreshold').addEventListener('input', (e) => {
      document.getElementById('silenceThresholdVal').textContent = e.target.value;
    });
    document.getElementById('minSilenceDur').addEventListener('input', (e) => {
      document.getElementById('minSilenceDurVal').textContent = e.target.value;
    });

    // Filler word tags
    document.querySelectorAll('.filler-tag').forEach(tag => {
      tag.classList.add('active');
      tag.addEventListener('click', () => tag.classList.toggle('active'));
    });

    btnSilence.addEventListener('click', async () => {
      if (!this._audioLoaded || this.detector.isAnalyzing) return;
      progressEl.style.display = 'block';
      btnSilence.disabled = true;

      const threshold = Number(document.getElementById('silenceThreshold').value);
      const minDur = Number(document.getElementById('minSilenceDur').value);

      await this.detector.detectSilences(threshold, minDur, (p) => {
        progressFill.style.width = (p * 100) + '%';
        progressText.textContent = `Analyzing silences... ${Math.round(p * 100)}%`;
      });

      progressEl.style.display = 'none';
      btnSilence.disabled = false;
      this._renderMarkerList();
      this._renderMarkerFlags();
      this._toast(`Found ${this.detector.getMarkers('silence').length} silences`);
    });

    btnFillers.addEventListener('click', async () => {
      if (!this._audioLoaded || this.detector.isAnalyzing) return;
      progressEl.style.display = 'block';
      btnFillers.disabled = true;

      await this.detector.detectFillers((p) => {
        progressFill.style.width = (p * 100) + '%';
        progressText.textContent = `Analyzing fillers... ${Math.round(p * 100)}%`;
      });

      progressEl.style.display = 'none';
      btnFillers.disabled = false;
      this._renderMarkerList();
      this._renderMarkerFlags();
      this._toast(`Found ${this.detector.getMarkers('filler').length} potential filler words`);
    });

    // Approve/Reject all
    document.getElementById('btnApproveAll').addEventListener('click', () => {
      this.detector.approveAll();
      this._renderMarkerList();
      this._renderMarkerFlags();
    });
    document.getElementById('btnRejectAll').addEventListener('click', () => {
      this.detector.rejectAll();
      this._renderMarkerList();
      this._renderMarkerFlags();
    });

    // Apply cuts
    document.getElementById('btnApplyCuts').addEventListener('click', () => {
      const approved = this.detector.getApprovedMarkers();
      if (approved.length === 0) {
        this._toast('No approved markers to cut');
        return;
      }
      const count = this.editor.applyMarkerCuts(this.detector.markers);
      // Remove applied markers
      this.detector.markers = this.detector.markers.filter(m => !m.approved);
      this._renderMarkerList();
      this._renderMarkerFlags();
      this._onBufferChanged();
      this._toast(`Applied ${count} cuts`);
    });
  }

  _renderMarkerList() {
    const list = document.getElementById('markerList');
    const actions = document.getElementById('markerActions');
    const markers = this.detector.getMarkers();

    if (markers.length === 0) {
      list.innerHTML = '<div class="marker-empty">No markers yet. Run detection above.</div>';
      actions.style.display = 'none';
      return;
    }

    actions.style.display = 'flex';

    list.innerHTML = markers.map(m => {
      const typeIcon = m.type === 'silence' ? '⏸' : '💬';
      const timeStr = this._formatTime(m.time);
      const detail = m.type === 'silence'
        ? `${m.duration.toFixed(1)}s silence`
        : `${m.label || m.word || 'filler'}`;

      return `
        <div class="marker-item ${m.approved ? 'approved' : ''} ${m.rejected ? 'rejected' : ''}" data-id="${m.id}">
          <div class="marker-icon ${m.type}">${typeIcon}</div>
          <div class="marker-info">
            <div class="marker-time">${timeStr}</div>
            <div class="marker-detail">${detail}</div>
          </div>
          <div class="marker-actions-inline">
            <button class="marker-act-btn preview" data-preview="${m.id}" title="Preview">▶</button>
            <button class="marker-act-btn approve" data-approve="${m.id}" title="Approve">✓</button>
            <button class="marker-act-btn reject" data-reject="${m.id}" title="Reject">✗</button>
          </div>
        </div>
      `;
    }).join('');

    // Bind marker actions
    list.querySelectorAll('[data-preview]').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = this.detector.markers.find(m => m.id === btn.dataset.preview);
        if (m) {
          // Preview: play a bit before and after the marker
          this.engine.seek(Math.max(0, m.time - 0.3));
          this.engine.play();
          setTimeout(() => this.engine.pause(), Math.min((m.duration || 0.5) * 1000 + 600, 2000));
        }
      });
    });

    list.querySelectorAll('[data-approve]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.detector.approveMarker(btn.dataset.approve);
        this._renderMarkerList();
        this._renderMarkerFlags();
      });
    });

    list.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.detector.rejectMarker(btn.dataset.reject);
        this._renderMarkerList();
        this._renderMarkerFlags();
      });
    });
  }

  _renderMarkerFlags() {
    const overlay = document.getElementById('markersOverlay');
    if (!this.waveform || !overlay) return;

    overlay.innerHTML = '';
    const markers = this.detector.getMarkers();

    for (const m of markers) {
      const x = this.waveform.timeToX(m.time);
      if (x < -10 || x > this.waveform.displayWidth + 10) continue;

      const flag = document.createElement('div');
      flag.className = `marker-flag ${m.type} ${m.approved ? 'approved' : ''} ${m.rejected ? 'rejected' : ''}`;
      flag.style.left = x + 'px';
      flag.setAttribute('data-label', m.type === 'silence' ? `⏸ ${m.duration.toFixed(1)}s` : `💬 ${m.word || 'filler'}`);
      flag.addEventListener('click', () => {
        this.engine.seek(m.time);
      });
      overlay.appendChild(flag);
    }
  }

  _bindExporter() {
    // Format buttons
    document.querySelectorAll('.format-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Show/hide bitrate row for lossy formats
        const fmt = btn.dataset.format;
        document.getElementById('bitrateRow').style.display = (fmt === 'mp3' || fmt === 'aac') ? 'flex' : 'none';
      });
    });

    // Loudness buttons
    document.querySelectorAll('.loudness-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.loudness-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Add chapter
    document.getElementById('btnAddChapter').addEventListener('click', () => {
      const time = this.engine.getCurrentTime();
      const name = prompt('Chapter name:', `Chapter ${document.querySelectorAll('.chapter-item').length + 1}`);
      if (name) {
        this._addChapter(time, name);
      }
    });

    // Export button
    document.getElementById('btnExport').addEventListener('click', async () => {
      if (!this._audioLoaded) return;
      await this._doExport();
    });
  }

  _addChapter(time, name) {
    const list = document.getElementById('chapterList');
    const empty = list.querySelector('.chapter-empty');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'chapter-item';
    item.innerHTML = `
      <span class="ch-time">${this._formatTime(time)}</span>
      <span class="ch-title">${name}</span>
      <button class="ch-del">✕</button>
    `;
    item.querySelector('.ch-del').addEventListener('click', () => item.remove());
    list.appendChild(item);
  }

  async _doExport() {
    const btn = document.getElementById('btnExport');
    const progressEl = document.getElementById('exportProgress');
    const progressFill = document.getElementById('exportProgressFill');
    const progressText = document.getElementById('exportProgressText');
    const reportEl = document.getElementById('exportReport');

    btn.disabled = true;
    progressEl.style.display = 'block';
    reportEl.style.display = 'none';

    const activeFormat = document.querySelector('.format-btn.active')?.dataset.format || 'wav';
    const activeLoudness = document.querySelector('.loudness-btn.active')?.dataset.lufs || '-19';

    try {
      const result = await this.exporter.exportFile({
        format: activeFormat,
        sampleRate: Number(document.getElementById('exportSampleRate').value),
        bitDepth: Number(document.getElementById('exportBitDepth').value),
        channels: Number(document.getElementById('exportChannels').value),
        bitrate: Number(document.getElementById('exportBitrate').value),
        targetLufs: Number(activeLoudness),
        ceiling: Number(document.getElementById('exportTruePeak').value),
        metadata: {
          title: document.getElementById('metaTitle').value || 'episode',
          artist: document.getElementById('metaArtist').value,
          episode: document.getElementById('metaEpisode').value,
          year: document.getElementById('metaYear').value
        },
        onProgress: (p, msg) => {
          progressFill.style.width = (p * 100) + '%';
          progressText.textContent = msg;
        }
      });

      // Download
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);

      // Show report
      const r = result.report;
      reportEl.style.display = 'block';
      reportEl.innerHTML = `
        <strong>Loudness Report</strong><br>
        Integrated Loudness: <span class="${r.lufsPass ? 'pass' : 'fail'}">${r.integratedLufs} LUFS</span> (target: ${r.targetLufs} LUFS)<br>
        True Peak: <span class="${r.peakPass ? 'pass' : 'fail'}">${r.truePeakDb} dBTP</span> (ceiling: ${r.ceiling} dBTP)<br>
        Format: ${activeFormat.toUpperCase()}<br>
        <span class="${r.lufsPass && r.peakPass ? 'pass' : 'fail'}">${r.lufsPass && r.peakPass ? '✓ PASS — Ready for delivery' : '⚠ Review needed'}</span>
      `;

      this._toast(`Exported ${result.filename}`);
    } catch (e) {
      this._toast(`Export failed: ${e.message}`);
      console.error(e);
    }

    btn.disabled = false;
    progressEl.style.display = 'none';
  }

  _bindFileLoading() {
    const fileInput = document.getElementById('fileInput');
    const btnOpen = document.getElementById('btnOpenFile');
    const btnRecord = document.getElementById('btnRecordNew');
    const overlay = document.getElementById('welcomeOverlay');

    btnOpen.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (files.length > 0) {
        await this._loadAudioFile(files[0]);
        overlay.style.display = 'none';
        // Reset file input so same file can be re-opened
        e.target.value = '';
      }
    });

    btnRecord.addEventListener('click', async () => {
      overlay.style.display = 'none';
      await this._startRecording();
    });

    // Drag and drop on entire page
    document.addEventListener('dragover', (e) => { e.preventDefault(); });
    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].type.startsWith('audio/')) {
        await this._loadAudioFile(files[0]);
        overlay.style.display = 'none';
      }
    });
  }

  async _loadAudioFile(file) {
    try {
      this._toast('Loading audio...');
      const info = await this.engine.loadFile(file);
      this._audioLoaded = true;

      document.getElementById('projectName').textContent = file.name.replace(/\.[^.]+$/, '');

      // Init waveform
      const canvas = document.getElementById('waveformCanvas');
      if (this.waveform) this.waveform.destroy();
      this.waveform = new WaveformRenderer(canvas, this.engine);
      this.waveform.refreshData();

      // Update time display
      this._updateTimeDisplay();

      // Render track headers
      this._renderTrackHeaders();

      // Hide hint after a few seconds
      setTimeout(() => {
        const hint = document.getElementById('waveformHint');
        if (hint) hint.style.opacity = '0';
      }, 3000);

      this._toast(`Loaded: ${info.name} (${this._formatTime(info.duration)})`);
    } catch (e) {
      this._toast(`Error loading file: ${e.message}`);
      console.error(e);
    }
  }

  async _startRecording() {
    try {
      const btnRec = document.getElementById('btnRecord');
      btnRec.classList.add('recording');

      await this.engine.startRecording();

      // Show recording indicator
      const indicator = document.createElement('div');
      indicator.className = 'recording-indicator';
      indicator.textContent = '● REC';
      indicator.id = 'recIndicator';
      document.body.appendChild(indicator);

      // Wait for stop
      const stopHandler = () => {
        this.engine.stopRecording();
        btnRec.classList.remove('recording');
        const ind = document.getElementById('recIndicator');
        if (ind) ind.remove();
        this.engine.pauseOffset = 0;

        // Remove one-time listener
        btnRec.removeEventListener('click', stopHandler);
      };

      btnRec.addEventListener('click', stopHandler, { once: true });

      // Listen for recording done
      document.addEventListener('recording-done', (e) => {
        this._audioLoaded = true;
        document.getElementById('projectName').textContent = 'New Recording';

        const canvas = document.getElementById('waveformCanvas');
        if (this.waveform) this.waveform.destroy();
        this.waveform = new WaveformRenderer(canvas, this.engine);
        this.waveform.refreshData();

        this._updateTimeDisplay();
        this._renderTrackHeaders();

        this._toast(`Recorded ${this._formatTime(e.detail.duration)}`);
      }, { once: true });

    } catch (e) {
      this._toast(`Recording error: ${e.message}`);
    }
  }

  _bindSettings() {
    const btnSettings = document.getElementById('btnSettings');
    const modal = document.getElementById('settingsModal');

    btnSettings.addEventListener('click', () => { modal.style.display = 'flex'; });
    document.getElementById('closeSettings').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  }

  _bindPlaybackEvents() {
    document.addEventListener('playback-started', () => {
      document.getElementById('iconPlay').style.display = 'none';
      document.getElementById('iconPause').style.display = 'block';
      this._startAnimationLoop();
    });

    document.addEventListener('playback-paused', () => {
      document.getElementById('iconPlay').style.display = 'block';
      document.getElementById('iconPause').style.display = 'none';
    });

    document.addEventListener('playback-stopped', () => {
      document.getElementById('iconPlay').style.display = 'block';
      document.getElementById('iconPause').style.display = 'none';
      if (this.waveform) this.waveform.updatePlayhead(0);
    });

    document.addEventListener('playback-ended', () => {
      document.getElementById('iconPlay').style.display = 'block';
      document.getElementById('iconPause').style.display = 'none';
      if (this.waveform) this.waveform.updatePlayhead(0);
      this._updateTimeDisplay();
    });

    document.addEventListener('meter-update', (e) => {
      const badge = document.getElementById('loudnessBadge');
      if (badge) {
        const lufs = e.detail.lufs;
        badge.textContent = isFinite(lufs) ? `${lufs.toFixed(0)} LUFS` : '-- LUFS';
      }
    });

    document.addEventListener('zoom-change', (e) => {
      const slider = document.getElementById('zoomSlider');
      if (slider) slider.value = Math.round(e.detail.pps);
    });
  }

  _startAnimationLoop() {
    const update = () => {
      if (!this.engine.isPlaying) return;

      const time = this.engine.getCurrentTime();
      this._updateTimeDisplay(time);

      if (this.waveform) {
        this.waveform.updatePlayhead(time);
      }

      this._animationFrame = requestAnimationFrame(update);
    };
    update();
  }

  _updateTimeDisplay(currentTime) {
    const ct = currentTime !== undefined ? currentTime : this.engine.getCurrentTime();
    const total = this.engine.getDuration();
    document.getElementById('timeCurrent').textContent = this._formatTime(ct);
    document.getElementById('timeTotal').textContent = this._formatTime(total);
  }

  _onBufferChanged() {
    this.engine.duration = this.engine.getDuration();
    if (this.waveform) {
      this.waveform.refreshData();
    }
    this._updateTimeDisplay();
    this._renderMarkerFlags();
  }

  _renderTrackHeaders() {
    const headers = document.getElementById('trackHeaders');
    const numCh = this.engine.workingBuffer ? this.engine.workingBuffer.numberOfChannels : 1;
    const typeIcons = { vocal: '🎤', cohost: '🗣', guest: '👤', remote: '📞' };
    const icon = typeIcons[this.clipType] || '🎤';

    headers.innerHTML = '';
    for (let i = 0; i < Math.max(1, numCh); i++) {
      const label = numCh === 1 ? 'Voice' : (i === 0 ? 'L' : 'R');
      headers.innerHTML += `
        <div class="track-header">
          <span class="track-type">${icon}</span>
          <span class="track-label">${label}</span>
          <button class="track-mute" data-track="${i}" title="Mute">M</button>
          <button class="track-solo" data-track="${i}" title="Solo">S</button>
        </div>
      `;
    }
  }

  _loadLamejs() {
    // Try to load lamejs from CDN for MP3 encoding
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
    script.onload = () => console.log('lamejs loaded for MP3 export');
    script.onerror = () => console.log('lamejs not available — MP3 export will fallback to WAV');
    document.head.appendChild(script);
  }

  _formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '00:00.000';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
  }

  _toast(message, duration = 2500) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, duration);
  }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  window.podcastForge = new PodcastForge();
});
