# PodcastForge

**Pro podcast audio editor — clean voices, fast edits, platform-safe exports.**

A mobile-first, browser-based podcast editor built around three principles:
1. Making voices sound clean and natural
2. Making editing fast
3. Making export platform-safe for podcast delivery

## Features

### 🎙️ Voice Processing Chain (correct signal order)
1. **High-Pass Filter** — cuts rumble, plosives, handling noise
2. **Noise Reduction** — reduces constant background hiss
3. **Noise Gate / Expander** — mutes low-level noise between phrases
4. **Notch Filter** — removes 50/60 Hz mains hum & harmonics
5. **EQ** — mud cut, presence boost, air shelf
6. **De-Esser** — controls harsh sibilance
7. **Compressor** — steady, present, professional voice level
8. **Limiter** — final clipping protection (-1 dBTP)
9. **Loudness Normalization** — hits podcast LUFS targets on export

Three one-click presets: **Clear Podcast Voice**, **Warm & Rich**, **Studio Clean**

### ✂️ Editing
- Split at playhead, trim, delete, ripple delete
- Crossfades, fade in/out
- Insert silence, duplicate clips, heal gaps
- Full undo/redo history

### 🔍 Detect & Review
- **Silence detection** — adjustable threshold and minimum duration
- **Filler word detection** — finds um, uh, like, you know, basically, etc.
- Each detection shows as a colored flag on the waveform
- **Review before cutting:** Preview each marker, approve or reject, then apply only approved cuts
- Nothing is removed until you explicitly approve and apply

### 📤 Export
- **WAV** master (16-bit or 24-bit)
- **MP3** for RSS delivery
- **AAC/M4A** for Apple Podcasts
- Loudness targets: -16 LUFS stereo, -19 LUFS mono, -14 LUFS streaming
- True peak protection (-1 dBTP or -2 dBTP)
- Loudness pass/fail report on every export
- Metadata and chapter markers

### 📱 Mobile-First
- Touch: tap to seek, pinch to zoom, swipe to scroll
- Installable PWA (add to home screen)
- Record directly from phone microphone
- Works offline after first load

## Deploy to GitHub Pages

1. Create a new GitHub repository
2. Push this folder's contents to the repo
3. Go to **Settings → Pages**
4. Set source to **main** branch, root `/`
5. Your app will be live at `https://yourusername.github.io/podcastforge/`

## Run Locally

Because the app uses ES modules, you need an HTTP server (not `file://`):

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .

# Then open http://localhost:8080
```

## Tech Stack

- **Web Audio API** — all audio processing, playback, recording
- **OfflineAudioContext** — offline rendering for export with full processing chain
- **Canvas** — waveform rendering with zoom/scroll
- **ES Modules** — clean architecture, no build step needed
- **Service Worker** — offline caching via PWA
- **lamejs** (CDN) — MP3 encoding on export

## Browser Support

- Chrome 80+ / Edge 80+
- Safari 14+
- Firefox 80+
- Mobile Chrome & Safari

## License

MIT
