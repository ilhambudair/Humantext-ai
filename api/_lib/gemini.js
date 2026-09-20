// Gemini API adapter for HumanText AI.
// The API key is read from server-side environment variables only.

export class UpstreamError extends Error {
  constructor(code, status = 0, detail = "") {
    super(detail || code);
    this.name = "UpstreamError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export async function streamCompletion({
  cfg,
  model,
  prompt,
  signal,
  onDelta,
}) {
  const apiKey = cfg.apiKey;

  if (!apiKey) {
    throw new UpstreamError("not_configured", 503, "Gemini API key is missing");
  }

  const selectedModel = model || "gemini-2.5-flash-lite";

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(selectedModel)}:streamGenerateContent?alt=sse`;

  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: cfg.maxOutputTokens,
        },
      }),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new UpstreamError("cancelled", 499, "Request cancelled");
    }

    throw new UpstreamError(
      "upstream_error",
      502,
      error?.message || "Failed to connect to Gemini",
    );
  }

  if (!response.ok) {
    let detail = "";

    try {
      const data = await response.json();
      detail =
        data?.error?.message || data?.error?.status || JSON.stringify(data);
    } catch {
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }
    }

    if (response.status === 429) {
      throw new UpstreamError("rate_limited", 429, detail);
    }

    if (response.status === 400) {
      throw new UpstreamError("upstream_error", 400, detail);
    }

    throw new UpstreamError("upstream_error", response.status, detail);
  }

  if (!response.body) {
    throw new UpstreamError(
      "empty_completion",
      502,
      "Gemini returned no response body",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let stop = "end_turn";
  let emitted = false;

  const processEvent = (eventText) => {
    const lines = eventText.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line || line.startsWith(":")) continue;

      const data = line.startsWith("data:") ? line.slice(5).trim() : line;

      if (!data || data === "[DONE]") continue;

      let json;

      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }

      if (json?.error) {
        throw new UpstreamError(
          "upstream_error",
          502,
          json.error.message || JSON.stringify(json.error),
        );
      }

      const candidates = Array.isArray(json?.candidates) ? json.candidates : [];

      for (const candidate of candidates) {
        const parts = candidate?.content?.parts || [];

        for (const part of parts) {
          if (typeof part?.text === "string" && part.text) {
            emitted = true;
            onDelta(part.text);
          }
        }

        if (candidate?.finishReason) {
          stop = candidate.finishReason;
        }
      }
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";

      for (const event of events) {
        processEvent(event);
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      processEvent(buffer);
    }
  } catch (error) {
    if (error instanceof UpstreamError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new UpstreamError("cancelled", 499, "Request cancelled");
    }

    throw new UpstreamError(
      "upstream_error",
      502,
      error?.message || "Gemini streaming failed",
    );
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore release errors.
    }
  }

  if (!emitted) {
    throw new UpstreamError("empty_completion", 502, "Gemini returned no text");
  }

  return { stop };
}
