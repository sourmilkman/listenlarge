# Listen Large

Free, one-screen live captions in large text, in **Thai or English**. Built for an iPad, and also works on iPhone and Android.

No API keys, no server, no charges. It uses the browser's built-in speech recognition only.

## How it works

- Tap **Start**. Captions appear as people speak: **Thai in yellow, English in blue**.
- **Auto-switch** (on by default): Thai is the home mode because it hears both languages (English comes out in English letters). When a full English sentence is heard, the app switches to English mode for better English accuracy. English mode can't hear Thai, so it goes back to Thai after two very short results in a row (how misheard Thai shows up) or 10 seconds of quiet. The first sentence after a switch may be missed or garbled.
- The **ไทย / EN** button on the status bar switches language by hand. After a manual tap, auto-switch pauses for 20 seconds so it doesn't flip straight back.
- **Repeat** shows the last 30 seconds again. **History** keeps the last 2 hours on the device.
- The screen stays awake while listening.

## iPad setup (one-off)

1. **Settings › General › Keyboard › Enable Dictation**: on. Make sure **Thai** is among the keyboards/dictation languages.
2. Open the app in **Safari**, tap Share › **Add to Home Screen**.
3. Open it from the Home Screen, tap **Start**, and allow the microphone.

If captions never appear from the Home Screen icon, try it in a normal Safari tab. Speech recognition in Home Screen apps has been less reliable on some iPadOS versions.

## Caregiver settings

Hidden from the daily screen. Open with `?settings=1` on the URL, or tap the **Listen Large** title five times. Settings: auto-switch on/off, text size, white/yellow theme.

## Speech test page

Open `test.html` on the iPad to see exactly what the speech engine hears in each language mode (with confidence and script counts). This is useful for tuning auto-switch.

## Hosting on GitHub Pages

Repository **Settings › Pages ›** Deploy from a branch › `main` / root. Open the published URL.

## Privacy

Apple (Safari) or Google (Chrome) may process the audio on their servers to recognise speech. Nothing is sent anywhere by this app itself.

## Local preview

```sh
npx serve .
```
