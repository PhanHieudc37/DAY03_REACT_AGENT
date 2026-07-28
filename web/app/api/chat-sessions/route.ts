function apiBase() {
  const base = process.env.MONGO_API_URL;
  if (!base) throw new Error("Chưa kết nối MongoDB API.");
  return base.replace(/\/$/, "");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id");
    const endpoint = sessionId
      ? `/chat-sessions/${encodeURIComponent(sessionId)}`
      : "/chat-sessions";
    const response = await fetch(`${apiBase()}${endpoint}`, {
      cache: "no-store",
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Không tải được lịch sử." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = String(body.session_id || "");
    if (!sessionId) return Response.json({ error: "Thiếu session_id." }, { status: 400 });
    const response = await fetch(
      `${apiBase()}/chat-sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body.message),
      },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Không lưu được tin nhắn." },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const sessionId = new URL(request.url).searchParams.get("session_id");
    if (!sessionId) return Response.json({ error: "Thiếu session_id." }, { status: 400 });
    const response = await fetch(
      `${apiBase()}/chat-sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Không xóa được hội thoại." },
      { status: 503 },
    );
  }
}
