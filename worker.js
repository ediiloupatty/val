// Origins allowed to call this API.
const ALLOWED_ORIGINS = [
  "https://aimku.xyz",
  "https://www.aimku.xyz",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    // Allow Vercel preview deploys (e.g. https://val-xxxx.vercel.app)
    return /\.vercel\.app$/.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function corsFor(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    // Echo the origin when allowed; otherwise lock responses to the prod domain.
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://aimku.xyz",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = corsFor(request);

    // Handle CORS preflight request
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Check Cloudflare D1 Database binding
    if (!env.DB) {
      return new Response(
        JSON.stringify({ success: false, error: "Cloudflare D1 Database binding 'DB' not found" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // GET /api/profile?deviceId=...
    if (path === "/api/profile" && request.method === "GET") {
      const deviceId = url.searchParams.get("deviceId");
      if (!deviceId) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing required 'deviceId' parameter" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      try {
        const { results } = await env.DB.prepare(
          "SELECT name, score, accuracy, split FROM profiles WHERE device_id = ?"
        ).bind(deviceId).all();

        if (!results || results.length === 0) {
          // fallback if profile not saved in SQLite yet
          return new Response(
            JSON.stringify({
              success: true,
              exists: false,
              data: { name: "Agent", best: { score: 0, accuracy: 0, split: 0 } }
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const row = results[0];
        const profileData = {
          name: row.name,
          best: {
            score: Number(row.score) || 0,
            accuracy: Number(row.accuracy) || 0,
            split: Number(row.split) || 0
          }
        };

        return new Response(
          JSON.stringify({ success: true, exists: true, data: profileData }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: "Database error fetching profile: " + err.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // POST /api/profile
    if (path === "/api/profile" && request.method === "POST") {
      try {
        const body = await request.json();
        const { deviceId, name, best } = body;

        if (!deviceId || !name || !best) {
          return new Response(
            JSON.stringify({ success: false, error: "Missing required fields: deviceId, name, best" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        const score = Number(best.score) || 0;
        const accuracy = Number(best.accuracy) || 0;
        const split = Number(best.split) || 0;
        const updatedAt = new Date().toISOString();

        // SQL Upsert statement
        await env.DB.prepare(`
          INSERT INTO profiles (device_id, name, score, accuracy, split, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET
            name = excluded.name,
            score = excluded.score,
            accuracy = excluded.accuracy,
            split = excluded.split,
            updated_at = excluded.updated_at
        `).bind(deviceId, name, score, accuracy, split, updatedAt).run();

        const profileData = {
          name,
          best: { score, accuracy, split },
          updatedAt
        };

        return new Response(
          JSON.stringify({ success: true, data: profileData }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: "Database error saving profile: " + err.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // POST /api/score — log one finished session (feeds the weekly leaderboard)
    if (path === "/api/score" && request.method === "POST") {
      try {
        const body = await request.json();
        const { deviceId, name, score, accuracy, split } = body;

        if (!deviceId || !name || score == null) {
          return new Response(
            JSON.stringify({ success: false, error: "Missing required fields: deviceId, name, score" }),
            { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        await env.DB.prepare(
          "INSERT INTO scores (device_id, name, score, accuracy, split, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(
          deviceId,
          String(name).slice(0, 20),
          Math.round(Number(score)) || 0,
          Number(accuracy) || 0,
          Number(split) || 0,
          new Date().toISOString()
        ).run();

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: "Database error saving score: " + err.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // GET /api/leaderboard — top 10 scores achieved in the last 7 days.
    // SQLite "bare column" rule: with a single MAX(), the name/accuracy/split
    // columns are taken from the same row as that max score (one per device).
    if (path === "/api/leaderboard" && request.method === "GET") {
      try {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { results } = await env.DB.prepare(`
          SELECT COALESCE(p.name, s.name) AS name, MAX(s.score) AS score, s.accuracy, s.split
          FROM scores s
          LEFT JOIN profiles p ON s.device_id = p.device_id
          WHERE s.created_at >= ?
          GROUP BY s.device_id
          ORDER BY score DESC
          LIMIT 10
        `).bind(weekAgo).all();

        const data = (results || []).map((row) => ({
          name: row.name,
          score: Number(row.score) || 0,
          accuracy: Number(row.accuracy) || 0,
          split: Number(row.split) || 0,
        }));

        return new Response(
          JSON.stringify({ success: true, data }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, error: "Database error fetching leaderboard: " + err.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
