# Listen Large

Listen Large is a one-screen PWA for large live captions. Senior Mode is the default UI: it auto-starts, shows one large caption at a time, keeps the screen awake while listening, and exposes only Stop/Start, Repeat, and History.

## Use It From GitHub Pages

1. Open the repository settings on GitHub.
2. Go to **Pages**.
3. Set the source to **Deploy from a branch**.
4. Choose the `main` branch and `/root`.
5. Open the published Pages URL.
6. Use the browser share menu and choose **Add to Home Screen** or **Install app**.

## Caregiver Settings

Settings are hidden from the daily UI. Open them by either:

- adding `?settings=1` to the app URL, or
- tapping the **Listen Large** title five times.

The settings panel controls transcription method, relay URL, browser language, text size, and white/yellow high-contrast theme. Thai/English auto-detection requires the OpenAI relay; browser speech recognition can only listen in one selected language at a time.

## Transcription Options

- **Browser speech recognition:** runs from the static app when the browser supports it.
- **OpenAI relay endpoint:** uses the included Cloudflare Worker and OpenAI audio translations so Thai speech is returned as English text, while English speech passes through as English.

GitHub Pages cannot safely store private API keys, so do not put an OpenAI API key directly in the frontend.

## Optional OpenAI Relay

Deploy `worker/openai-relay.js` as a Cloudflare Worker and set an `OPENAI_API_KEY` secret on that Worker. Then open caregiver settings, switch **Transcription method** to **OpenAI relay endpoint**, and paste the Worker URL.

The app sends non-silent microphone chunks to:

```text
https://your-worker.example.workers.dev/transcribe
```

## Local Preview

Any static web server works. For example:

```sh
npx serve .
```

Then open the local URL in a browser.

## Privacy Note

Browser speech recognition may use the browser vendor's speech service. OpenAI relay mode sends short non-silent audio chunks to your relay endpoint and then to OpenAI for translation/transcription.
