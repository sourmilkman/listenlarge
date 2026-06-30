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
    const language = incoming.get("language");

    if (!audio || typeof audio === "string") {
      return withCors(Response.json({ error: "Missing audio file" }, { status: 400 }));
    }

    const body = new FormData();
    body.append("file", audio, "speech.webm");
    body.append("model", "gpt-4o-transcribe");
    if (language) body.append("language", language);

    const openai = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body
    });

    const payload = await openai.text();
    return withCors(new Response(payload, {
      status: openai.status,
      headers: { "content-type": openai.headers.get("content-type") || "application/json" }
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
