/**
 * Netlify Serverless Function: /.netlify/functions/download
 * Proxies to Cobalt API to get YouTube MP4 / MP3 download links
 *
 * Deploy env var required (set in Netlify dashboard):
 *   COBALT_API  →  https://api.cobalt.tools   (or your self-hosted URL)
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export async function handler(event) {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed." }),
    };
  }

  const params = event.queryStringParameters || {};
  const videoUrl = params.url;
  const format = params.format || "mp4";   // mp4 | mp3
  const quality = params.quality || "720"; // 240|360|480|720|1080

  if (!videoUrl) {
    return json(400, { error: "Missing url parameter." });
  }

  if (!isYouTubeUrl(videoUrl)) {
    return json(400, { error: "Only YouTube URLs are supported." });
  }

  const cobaltBase = process.env.COBALT_API || "https://api.cobalt.tools";

  try {
    // --- Step 1: Call Cobalt API ---
    const cobaltBody = {
      url: videoUrl,
      videoQuality: quality,
      filenameStyle: "basic",
      ...(format === "mp3"
        ? { downloadMode: "audio", audioFormat: "mp3", audioBitrate: "320" }
        : { downloadMode: "auto" }
      ),
    };

    const cobaltRes = await fetch(`${cobaltBase}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "YTDrop-Netlify/1.0",
      },
      body: JSON.stringify(cobaltBody),
    });

    if (!cobaltRes.ok) {
      const errText = await cobaltRes.text();
      throw new Error(`Cobalt API error ${cobaltRes.status}: ${errText.slice(0, 200)}`);
    }

    const cobalt = await cobaltRes.json();

    if (cobalt.status === "error") {
      throw new Error(cobalt.error?.code || "Cobalt returned an error.");
    }

    // --- Step 2: Fetch YouTube metadata (no API key needed) ---
    const meta = await fetchYouTubeMeta(videoUrl);

    // --- Step 3: Build download list ---
    let downloads = [];

    if (["redirect", "stream", "tunnel"].includes(cobalt.status)) {
      downloads = [
        {
          url: cobalt.url,
          format,
          label: format === "mp4" ? `MP4 ${quality}p` : "MP3 320kbps",
          size: "",
        },
      ];
    } else if (cobalt.status === "picker") {
      downloads = (cobalt.picker || []).slice(0, 4).map((p, i) => ({
        url: p.url,
        format: "mp4",
        label: `MP4 Option ${i + 1}`,
        size: "",
      }));
    }

    if (downloads.length === 0) {
      throw new Error(
        "No download links found. The video may be private or unavailable."
      );
    }

    return json(200, {
      title: meta.title || "YouTube Video",
      author: meta.author_name || "",
      thumbnail: meta.thumbnail_url || "",
      duration: "",
      downloads,
    });
  } catch (err) {
    console.error("[YTDrop]", err.message);
    return json(500, {
      error: err.message || "Failed to process this video. Please try another link.",
    });
  }
}

// ── Helpers ────────────────────────────────────────────────

function json(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

function isYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url);
}

async function fetchYouTubeMeta(videoUrl) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
      { headers: { "User-Agent": "YTDrop/1.0" } }
    );
    if (res.ok) return res.json();
  } catch (_) {}
  return {};
}
