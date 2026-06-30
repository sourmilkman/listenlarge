export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    if (url.pathname !== "/transcribe" || request.method !== "POST") {
      return withCors(Response.json({ error: "Not found" }, { status: 404 }));
    }

    if (!env.OPENAI_API_KEY) {
      return withCors(Response.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 }));
    }

    const incoming = await request.formData();
    const audio = incoming.get("audio");

    if (!audio || typeof audio === "string") {
      return withCors(Response.json({ error: "Missing audio file" }, { status: 400 }));
    }

    const translationBody = new FormData();
    translationBody.append("file", audio, "speech.webm");
    translationBody.append("model", "whisper-1");
    translationBody.append("response_format", "verbose_json");

    const transcriptionBody = new FormData();
    transcriptionBody.append("file", audio, "speech.webm");
    transcriptionBody.append("model", "whisper-1");
    transcriptionBody.append("response_format", "verbose_json");

    const [translation, transcription] = await Promise.all([
      fetch("https://api.openai.com/v1/audio/translations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`
        },
        body: translationBody
      }),
      fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`
        },
        body: transcriptionBody
      })
    ]);

    const translationPayload = await translation.text();
    if (!translation.ok) {
      return withCors(new Response(translationPayload, {
        status: translation.status,
        headers: { "content-type": translation.headers.get("content-type") || "application/json" }
      }));
    }

    const transcriptionPayload = await transcription.text();
    const translated = JSON.parse(translationPayload);
    const original = transcription.ok ? JSON.parse(transcriptionPayload) : {};
    const payload = JSON.stringify({
      ...translated,
      language: original.language || translated.language,
      original_text: original.text || ""
    });

    return withCors(new Response(payload, {
      status: translation.status,
      headers: { "content-type": translation.headers.get("content-type") || "application/json" }
    }));
  }
};

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
