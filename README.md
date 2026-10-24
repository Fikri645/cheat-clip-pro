# 🎬 Cheat Clip PRO

> **AI Powered Auto Clipper — Turn long YouTube, Google Drive, and uploaded videos into viral TikToks, Shorts, and Reels with animated subtitles, face centering, and music in minutes.**

---

## ⚡ Quick Start & Setup

Follow these steps to set up and run Cheat Clip PRO locally on **Windows**, **macOS**, or **Linux**.

### Step 1: Prerequisites

Make sure you have the following installed:

1. **[Git](https://git-scm.com/)**
   * **Windows:** `winget install Git.Git` or download from [git-scm.com](https://git-scm.com/)
   * **macOS:** `brew install git`
   * **Linux:** `sudo apt install git`
2. **[Node.js](https://nodejs.org/)** (v22.13 or newer)
   * Download from [nodejs.org](https://nodejs.org/) or install via your package manager.
3. **[Python](https://www.python.org/)** (v3.10 or newer)
   * **Windows:** Install from [python.org](https://www.python.org/downloads/) (make sure to check *"Add Python to PATH"* during setup) or from Microsoft Store.
   * **macOS:** `brew install python`
   * **Linux:** `sudo apt install python3 python3-pip python3-venv`
4. **FFmpeg & yt-dlp** (Required to download, slice, and render clips)
   * **Windows (PowerShell):**
     ```powershell
     winget install Gyan.FFmpeg
     winget install yt-dlp.yt-dlp
     ```
     *(Close and reopen your terminal after installing so Windows recognizes them)*
   * **macOS (Terminal):**
     ```bash
     brew install ffmpeg-full yt-dlp
     ```
      `ffmpeg-full` is required for the libass subtitle filter used by rendered captions.
   * **Linux:**
     ```bash
     sudo apt update && sudo apt install ffmpeg
     pip install yt-dlp
     ```

---

### Step 2: Clone the Repository

Open your terminal and clone the repository:

```bash
git clone https://github.com/galihjuansaputra/cheat-clip-pro.git
cd cheat-clip-pro
```

---

### Step 3: Install Dependencies

#### 1. Frontend Dependencies
```bash
npm install
```

#### 2. Backend Dependencies
We recommend setting up a Python virtual environment:

* **Windows:**
  ```powershell
  python -m venv venv
  venv\Scripts\activate
  pip install -r backend/requirements.txt
  ```

* **macOS / Linux:**
  ```bash
  python3 -m venv venv
  source venv/bin/activate
  pip install -r backend/requirements.txt
  ```

---

### Step 4: Run the App

Launch both the frontend and backend servers concurrently:

```bash
npm run dev
```

* **Web App:** [`http://localhost:5173`](http://localhost:5173)
* **Backend API:** [`http://localhost:8000`](http://localhost:8000)
* **API Documentation:** [`http://localhost:8000/docs`](http://localhost:8000/docs)

---

## 🔄 Updating to the Latest Version

To update Cheat Clip PRO to the latest release:

```bash
git pull
npm install
pip install -r backend/requirements.txt
```
*(Make sure your virtual environment is activated if you created one)*

---

## 🔑 Free Google Gemini API Key (Takes 1 Minute)

Cheat Clip PRO uses Google's AI to find the best viral moments for free:
1. Go to **[Google AI Studio](https://aistudio.google.com/)** and sign in with any Google account.
2. Click **"Get API key"** (or **"Create API key"**).
3. Copy your key (starts with `AIzaSy...`).
4. Paste it into the **Gemini API Key** field in the app.

> 💡 **Tip:** You can also type `mock` in the API Key box to test out the app with sample data without an API key!

---

## 🎯 How to Use

1. **Paste a YouTube URL** — Enter any podcast, stream, or video link.
2. **Choose Duration** — Pick `~15s` (fast hooks), `~30s` (standard shorts), or `~60s` (story clips).
3. **Click "Analyze Video"** — AI selects clips from the transcript and uses public YouTube replay peaks when available. Uploaded video uses audio energy instead; neither signal is a measured retention rate or a prediction of going viral.
4. **Customize in Clip Studio** — Adjust your video style:
   * **Frame & Crop**: Fullscreen 9:16 vertical, square, or split-screen facecam.
   * **Face Tracking**: Automatically keeps the speaker in the center of the frame.
   * **Subtitles**: Choose viral animated karaoke caption styles and fonts.
   * **Branding & Audio**: Add your watermark logo, background music, and hook sound effects.
   * **Hardware Acceleration**: Choose your graphics card (NVIDIA, AMD, Intel) or CPU.
5. **Batch Render & Download** — Click **Batch Render**, then download all your finished videos together in one **.ZIP** file!

---

## ❓ Common Problems & Easy Fixes

### 1. "Failed to render video" or `The system cannot find the file specified`
* **Cause:** `ffmpeg` or `yt-dlp` is missing on your computer.
* **Fix:**
  * **Windows (PowerShell):**
    ```powershell
    winget install Gyan.FFmpeg
    winget install yt-dlp.yt-dlp
    ```
    *(Then close and reopen your terminal)*
  * **Mac (Terminal):**
    ```bash
    brew install ffmpeg-full yt-dlp
    ```
  * Or install directly via Python: `pip install yt-dlp`

### 2. `No such filter: 'subtitles'`
* **Cause:** FFmpeg was installed without the libass subtitle filter.
* **Fix (macOS):**
  ```bash
  brew install ffmpeg-full
  ```
  Restart the backend after installation. The app automatically prefers Homebrew's subtitle-capable `ffmpeg-full` binary.

### 3. "Sign in to confirm you're not a bot"
* **Cause:** YouTube blocks video downloads if too many requests are sent without logging in.
* **Fix:** Click the 🍪 **Cookies** button in the top navigation bar, export your YouTube cookies using a free browser extension (like *Get cookies.txt locally*), and paste them into the app.

### 4. Does this work on AMD graphics cards and Mac?
* **Yes!** Cheat Clip PRO automatically supports:
  * **NVIDIA** (`h264_nvenc`)
  * **AMD** (`h264_amf` on Radeon GPUs & Ryzen CPUs)
  * **Intel** (`h264_qsv` on Arc & UHD Graphics)
  * **Apple Mac & CPU Software** (`libx264` universal high-speed fallback)
* You can switch your preferred hardware acceleration encoder anytime in the Render Settings or History card.

---

## 📄 License

Distributed under the **MIT License**. Free for personal and commercial use!


## Reliable rendering and storage

- Server renders run in an isolated worker with a SQLite queue (`backend/data/jobs.sqlite3`). The worker checkpoints completed clips and resumes interrupted clips after restart. One worker owns a database at a time. Run one API process per installation, and put the database on a local persistent disk.
- The browser remembers the last server batch and reconnects to progress after reload or a network interruption. Completed outputs remain downloadable from the recovery panel.
- Cookies are passed to the live worker in memory and are never saved in the job database. After a crash, a private YouTube source may require Retry with fresh browser cookies. Local sources and public downloads can resume automatically.
- GPU and WASM browser renders share framing, animated captions, title, watermark, music, SFX and voice-volume settings. GPU encodes composited frames; WASM mixes AAC audio and muxes it without re-encoding the GPU video. Browsers without native decoding use bounded software-decoded frame groups. Software exports are slower than hardware encoding.
- Tracking samples faces through the clip, smooths framing within a shot, and resets at scene cuts. Speaker selection uses face continuity and mouth-region motion; overlapping speakers and occlusions can still need a manual framing choice.
- Clip scores explain hook, context and ending separately. AI assessments and transcript-based fallbacks are identified; scores are content-selection estimates, not probabilities of social-media success. Overlapping clips are removed after boundary adjustment.
- Internal audio assets use extensionless binary URLs so download-manager integrations do not mistake editor fetches for downloads.

### Retention configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `JOB_DATABASE_PATH` | `backend/data/jobs.sqlite3` | Persistent render queue |
| `TEMP_MAX_AGE_SECONDS` | `3600` | Scratch-file lifetime |
| `UPLOAD_MAX_AGE_SECONDS` | `86400` | Source-upload lifetime |
| `EXPORT_MAX_AGE_SECONDS` | `604800` | Completed-export lifetime |
| `TEMP_STORAGE_QUOTA_GB` | `5` | Shared media quota |
| `CLEANUP_INTERVAL_SECONDS` | `1800` | Cleanup interval |
| `WHISPER_MODEL` | `small` | Word transcription model |

Cleanup counts each path once and protects queued/running render inputs and outputs. Under quota pressure it evicts the oldest unused files (excluding files less than 90 seconds old); if active files alone exceed the quota, it reports that condition instead of deleting them. Automatic TTLs and pressure eviction are distinct policies. History entries may outlive their media files.

Docker mounts the actual backend media, font and job directories. Existing installations that mounted `/app/uploads` or `/app/exports` should back up any files in the old container before recreating it; this change does not move existing container data automatically.

### Validation

```powershell
.\.venv\Scripts\python.exe -m pip install pytest httpx
.\.venv\Scripts\python.exe -m pytest tests -q
npm test
npm run build
npm run lint
```

The integration suite uses real FFmpeg output, terminates a worker, starts a replacement, and checks that completed clips are preserved. No paid AI call is needed. Browser export checks additionally require a real browser and video/audio fixtures. Frontend validation includes ESLint with no errors or warnings, TypeScript, and a production build.


### Entering your AI API key

1. Start the app with `npm run dev` and open `http://localhost:5173`.
2. In **AI Engine Settings**, select **Google Gemini** and fill **Gemini API Key**, or select **OpenRouter (Multi-LLM)** and fill **OpenRouter API Key**.
3. Select a model and analyze your video. The interface remembers your provider and key in the current browser.

Optional server defaults can be configured as `GEMINI_API_KEY` or `OPENROUTER_API_KEY` in `backend/.env` (see `backend/.env.template`).
