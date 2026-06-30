# Listen Large

Listen Large is a simple iPhone/iPad-friendly speech transcriber for English and Thai. It is designed for large text,
large tap targets, automatic language detection, and a calm one-screen workflow.

## Use It From GitHub Pages

1. Open the repository settings on GitHub.
2. Go to **Pages**.
3. Set the source to **Deploy from a branch**.
4. Choose the `main` branch and `/root`.
5. Open the published Pages URL on an iPhone or iPad.
6. In Chrome or Safari, use the share menu and choose **Add to Home Screen** if it is available.

On iPhone and iPad, Chrome still uses Apple's iOS browser engine. For the most dependable English/Thai auto-detection,
use the optional OpenAI relay mode.

## Transcription Options

The app has two modes:

- **Browser speech recognition:** runs from the static GitHub Pages app when the browser supports it.
- **OpenAI relay endpoint:** uses the included Cloudflare Worker example for more reliable English and Thai
  transcription without exposing your OpenAI API key in the browser.

The **Auto** language setting works best with the OpenAI relay. Browser speech recognition usually requires a specific
locale, so browser-only Auto mode falls back to the device's preferred language.

GitHub Pages cannot safely store private API keys, so do not put an OpenAI API key directly in the frontend.

## Optional OpenAI Relay

Deploy `worker/openai-relay.js` as a Cloudflare Worker and set an `OPENAI_API_KEY` secret on that Worker. Then open
Listen Large, tap settings, switch **Transcription method** to **OpenAI relay endpoint**, and paste the Worker URL.

The app sends short microphone chunks to:

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

Browser speech recognition may use the browser vendor's speech service. OpenAI relay mode sends short audio chunks to
your relay endpoint and then to OpenAI for transcription.
