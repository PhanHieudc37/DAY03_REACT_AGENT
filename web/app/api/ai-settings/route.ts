function apiBase() {
  const value = process.env.MONGO_API_URL;
  if (!value) throw new Error("Chưa kết nối MongoDB API.");
  return value.replace(/\/$/, "");
}

export async function GET() {
  try {
    const response = await fetch(`${apiBase()}/ai-settings/gemini`, {
      cache: "no-store",
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Không đọc được cấu hình.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { keys?: string };
    const response = await fetch(`${apiBase()}/ai-settings/gemini`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: body.keys || "" }),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Không lưu được cấu hình.",
      },
      { status: 500 },
    );
  }
}
