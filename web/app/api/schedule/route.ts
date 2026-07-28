function apiBase() {
  return process.env.MONGO_API_URL || "";
}

export async function GET(request: Request) {
  const inviteId = new URL(request.url).searchParams.get("invite_id");
  if (!inviteId)
    return Response.json(
      { ok: false, error: "Thiếu mã lời mời." },
      { status: 400 },
    );
  if (!apiBase())
    return Response.json(
      {
        ok: false,
        error: "Trang đặt lịch chỉ hoạt động khi kết nối MongoDB API.",
      },
      { status: 503 },
    );
  const upstream = await fetch(
    `${apiBase()}/public/invites/${encodeURIComponent(inviteId)}`,
    { cache: "no-store" },
  );
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    invite_id?: string;
    chosen_slot?: string;
  };
  if (!body.invite_id || !body.chosen_slot)
    return Response.json(
      { ok: false, error: "Thiếu mã lời mời hoặc khung giờ." },
      { status: 400 },
    );
  if (!apiBase())
    return Response.json(
      {
        ok: false,
        error: "Trang đặt lịch chỉ hoạt động khi kết nối MongoDB API.",
      },
      { status: 503 },
    );
  const upstream = await fetch(
    `${apiBase()}/public/invites/${encodeURIComponent(body.invite_id)}/confirm`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chosen_slot: body.chosen_slot }),
    },
  );
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
