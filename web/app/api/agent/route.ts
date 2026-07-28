type ToolResult = Record<string, unknown> & { ok?: boolean };
type TraceStep = {
  step: number;
  thought: string;
  action: string;
  arguments: Record<string, unknown>;
  observation: ToolResult;
};

const toolGuide = `
Tools khả dụng:
- list_jobs(): đọc các vị trí thật trong MongoDB.
- get_job(job_id): đọc tiêu chí một vị trí.
- list_candidates(job_id?, min_score?, tier?): danh sách ứng viên/hồ sơ đã parse và chấm.
- get_candidate(candidate_id): thông tin AI trích xuất từ CV và các application.
- score_candidate(candidate_id, job_id): chấm lại theo tiêu chí hiện tại, không ghi dữ liệu.
- create_job_criteria(job_id?, title, department, must_have_skills, nice_to_have_skills, min_experience_years, ideal_experience_years, min_education, weights, thresholds): tạo/sửa JD; cần HR xác nhận.
- update_application_status(application_id, status): đổi trạng thái; cần HR xác nhận.
- send_interview_invite(application_id, interviewer_ids, interview_duration_minutes, interview_type, interview_round, available_slots, public_app_url): gửi email mời; cần HR xác nhận.
- cancel_interview(interview_id), reschedule_interview(interview_id, chosen_slot), send_reminder(interview_id): cần HR xác nhận.
HR có thể upload nhiều CV ngay trong khu vực Nạp CV của chat; hệ thống sẽ parse, chấm điểm và lưu MongoDB.
`;

const systemPrompt = `Bạn là RecruitFlow ReAct Agent cho HR. Bạn điều phối dữ liệu tuyển dụng thật.
Chỉ trả về đúng một JSON object, không markdown.
Khi cần dùng tool: {"thought":"lý do ngắn, không tiết lộ chuỗi suy luận riêng tư","action":"tên_tool","arguments":{...}}
Khi đã đủ dữ liệu: {"thought":"đã đủ dữ liệu","final_answer":"câu trả lời tiếng Việt, nêu số liệu và bước tiếp theo"}
Nếu thiếu job_id/candidate_id/application_id/khung giờ, dùng tool đọc để tìm; nếu vẫn mơ hồ thì hỏi lại trong final_answer.
Không bịa dữ liệu, ID, email, điểm hay lịch. Không dùng thuộc tính nhạy cảm để chấm.
Mọi tool ghi dữ liệu, gửi email, hủy/dời lịch đều bị hệ thống chặn để HR xác nhận.
Không đưa Thought nội bộ dài; thought chỉ là mô tả hành động phục vụ audit.
${toolGuide}`;

function apiBase() {
  const base = process.env.MONGO_API_URL;
  if (!base)
    throw new Error(
      "Chưa kết nối MongoDB API. Hãy chạy docker compose và mở web bằng run_web.py.",
    );
  return base.replace(/\/$/, "");
}

async function runTool(
  toolName: string,
  args: Record<string, unknown>,
  sessionId: string,
) {
  const response = await fetch(`${apiBase()}/agent-tools`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool_name: toolName,
      arguments: args,
      session_id: sessionId,
    }),
  });
  const data = (await response.json()) as ToolResult;
  if (!response.ok) {
    return {
      ok: false,
      error: String(data.detail || data.error || "Tool xử lý thất bại."),
    };
  }
  return data;
}

async function resolveConfirmation(confirmationId: string, confirmed: boolean) {
  const response = await fetch(`${apiBase()}/agent-tools`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      confirmation_id: confirmationId,
      confirmed,
    }),
  });
  const data = (await response.json()) as ToolResult;
  if (!response.ok)
    throw new Error(String(data.detail || "Không thể xử lý xác nhận."));
  return data;
}

async function geminiDecision(history: unknown[]) {
  const response = await fetch(`${apiBase()}/ai/gemini-generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(history) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    }),
  });
  const data = (await response.json()) as {
    candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
    error?: { message: string };
  };
  if (!response.ok)
    throw new Error(data.error?.message || "Gemini API không phản hồi.");
  return JSON.parse(
    data.candidates?.[0]?.content.parts[0]?.text || "{}",
  ) as Record<string, unknown>;
}

async function openAiCompatibleDecision(
  history: unknown[],
  provider: "openai" | "openrouter",
) {
  const isOpenRouter = provider === "openrouter";
  const key =
    process.env[isOpenRouter ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"];
  if (!key) throw new Error(`${provider} chưa được cấu hình.`);
  const model =
    process.env.LLM_PROVIDER === provider && process.env.LLM_MODEL
      ? process.env.LLM_MODEL
      : isOpenRouter
        ? "google/gemini-2.5-flash"
        : "gpt-4o-mini";
  const response = await fetch(
    isOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(history) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    },
  );
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(data.error?.message || `${provider} không phản hồi.`);
  return JSON.parse(data.choices?.[0]?.message?.content || "{}") as Record<
    string,
    unknown
  >;
}

async function anthropicDecision(history: unknown[]) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Anthropic chưa được cấu hình.");
  const model =
    process.env.LLM_PROVIDER === "anthropic" && process.env.LLM_MODEL
      ? process.env.LLM_MODEL
      : "claude-3-haiku-20240307";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.1,
      system: `${systemPrompt}\nChỉ xuất JSON thuần.`,
      messages: [{ role: "user", content: JSON.stringify(history) }],
    }),
  });
  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(data.error?.message || "Anthropic không phản hồi.");
  const text = data.content?.find((item) => item.type === "text")?.text || "{}";
  return JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")) as Record<
    string,
    unknown
  >;
}

async function llmDecision(history: unknown[]) {
  const selected = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  const providers = [
    selected,
    ...["gemini", "openai", "openrouter", "anthropic"].filter(
      (provider) => provider !== selected,
    ),
  ];
  const errors: string[] = [];
  for (const provider of providers) {
    try {
      if (provider === "gemini") return await geminiDecision(history);
      if (provider === "openai" || provider === "openrouter")
        return await openAiCompatibleDecision(history, provider);
      if (provider === "anthropic") return await anthropicDecision(history);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(
    "Các dịch vụ AI đang tạm hết hạn mức hoặc bận. Bạn vẫn có thể dùng các câu lệnh dữ liệu nhanh, hoặc thử lại sau ít phút.",
  );
}

async function localAnswer(query: string, sessionId: string) {
  const normalized = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
  if (/^(hi|hello|xin chao|chao|hey)[!?.\s]*$/.test(normalized))
    return {
      answer:
        "Chào bạn! Mình là RecruitFlow AI. Mình có thể đọc JD, nhận CV, chấm điểm, xếp hạng ứng viên và hỗ trợ lên lịch phỏng vấn.",
      trace: [],
      provider: "local",
    };
  if (
    normalized.includes("ban ten gi") ||
    normalized.includes("ten cua ban") ||
    normalized.includes("ban la ai")
  )
    return {
      answer:
        "Mình là RecruitFlow AI — trợ lý ReAct hỗ trợ HR điều phối toàn bộ pipeline tuyển dụng.",
      trace: [],
      provider: "local",
    };
  if (
    normalized.includes("vi tri dang tuyen") ||
    normalized.includes("danh sach vi tri") ||
    normalized.includes("liet ke vi tri")
  ) {
    const observation = await runTool("list_jobs", {}, sessionId);
    const jobs = (observation.jobs || []) as Array<Record<string, unknown>>;
    return {
      answer: jobs.length
        ? `Hiện có ${jobs.length} vị trí:\n${jobs.map((job) => `• ${job.title} (${job.job_id})`).join("\n")}`
        : "Hiện chưa có vị trí tuyển dụng nào trong MongoDB.",
      trace: [
        {
          step: 1,
          thought: "Đọc danh sách vị trí từ MongoDB.",
          action: "list_jobs",
          arguments: {},
          observation,
        },
      ],
      provider: "local",
    };
  }
  const jobId = query.match(/job_[a-z0-9_-]+/i)?.[0];
  const candidateId = query.match(/cand_[a-z0-9_-]+/i)?.[0];
  if (
    jobId &&
    (normalized.includes("tieu chi") || normalized.includes("yeu cau"))
  ) {
    const observation = await runTool("get_job", { job_id: jobId }, sessionId);
    if (observation.ok === false) return null;
    const job = observation.job as Record<string, any>;
    return {
      answer: `Tiêu chí ${job.title} (${job.job_id}):\n• Bắt buộc: ${(job.must_have_skills || []).join(", ") || "Không có"}\n• Ưu tiên: ${(job.nice_to_have_skills || []).join(", ") || "Không có"}\n• Kinh nghiệm tối thiểu: ${job.min_experience_years || 0} năm\n• Ngưỡng phù hợp cao: ${job.thresholds?.high || 80}%\n• Ngưỡng cần xem xét: ${job.thresholds?.review || 60}%`,
      trace: [
        {
          step: 1,
          thought: "Đọc tiêu chí JD từ MongoDB.",
          action: "get_job",
          arguments: { job_id: jobId },
          observation,
        },
      ],
      provider: "local",
    };
  }
  if (
    jobId &&
    (normalized.includes("ung vien") ||
      normalized.includes("xep hang") ||
      normalized.includes("diem cao"))
  ) {
    const observation = await runTool(
      "list_candidates",
      { job_id: jobId },
      sessionId,
    );
    const applications = (observation.applications || []) as Array<
      Record<string, any>
    >;
    return {
      answer: applications.length
        ? `Ứng viên của ${jobId}:\n${applications
            .slice(0, 10)
            .map(
              (application, index) =>
                `${index + 1}. ${application.candidate?.full_name || application.candidate_id} — ${application.match_score}% (${application.recommendation})`,
            )
            .join("\n")}`
        : `Chưa có ứng viên nào cho ${jobId}.`,
      trace: [
        {
          step: 1,
          thought: "Đọc và xếp hạng application từ MongoDB.",
          action: "list_candidates",
          arguments: { job_id: jobId },
          observation,
        },
      ],
      provider: "local",
    };
  }
  if (
    candidateId &&
    (normalized.includes("tai sao") ||
      normalized.includes("giai thich") ||
      normalized.includes("thong tin"))
  ) {
    const observation = await runTool(
      "get_candidate",
      { candidate_id: candidateId },
      sessionId,
    );
    if (observation.ok === false) return null;
    const candidate = observation.candidate as Record<string, any>;
    const applications = observation.applications as Array<Record<string, any>>;
    return {
      answer: `${candidate.full_name || candidateId}: kỹ năng ${(candidate.skills || []).join(", ") || "chưa trích xuất"}, kinh nghiệm ${candidate.experience_years || 0} năm.${applications?.[0] ? ` Điểm gần nhất ${applications[0].match_score}% — ${applications[0].explanation}` : " Chưa có kết quả chấm."}`,
      trace: [
        {
          step: 1,
          thought: "Đọc ứng viên và bằng chứng chấm điểm.",
          action: "get_candidate",
          arguments: { candidate_id: candidateId },
          observation,
        },
      ],
      provider: "local",
    };
  }
  if (
    normalized.includes("quy trinh") ||
    normalized.includes("pipeline") ||
    normalized.includes("lam duoc gi")
  )
    return {
      answer:
        "Quy trình hiện tại gồm: HR cấu hình tiêu chí JD → tải CV → AI trích xuất thông tin → chấm điểm theo trọng số → phân 3 tier → HR xem xét → gửi link chọn lịch → ứng viên xác nhận → lưu lịch và đánh giá sau phỏng vấn. Mọi dữ liệu đều lưu trong MongoDB; hành động gửi email hoặc thay đổi trạng thái cần HR xác nhận.",
      trace: [],
      provider: "local",
    };
  return null;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const jobId = String(form.get("job_id") || "");
      const sessionId = String(form.get("session_id") || "agent_upload");
      const files = form
        .getAll("files")
        .filter((item): item is File => item instanceof File && item.size > 0);
      if (!jobId || !files.length)
        return Response.json(
          { error: "Hãy chọn vị trí và ít nhất một file CV." },
          { status: 400 },
        );
      const jobResponse = await fetch(`${apiBase()}/agent-tools`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tool_name: "get_job",
          arguments: { job_id: jobId },
          session_id: sessionId,
        }),
      });
      const jobData = (await jobResponse.json()) as {
        job?: Record<string, unknown>;
        detail?: string;
      };
      if (!jobResponse.ok || !jobData.job)
        return Response.json(
          { error: jobData.detail || "Không tìm thấy tiêu chí JD." },
          { status: jobResponse.status },
        );

      const results: Record<string, unknown>[] = [];
      for (const file of files) {
        const upstreamForm = new FormData();
        upstreamForm.set("file", file, file.name);
        upstreamForm.set("criteria", JSON.stringify(jobData.job));
        upstreamForm.set("cover_letter", "");
        upstreamForm.set("expected_salary", "");
        upstreamForm.set("available_date", "");
        upstreamForm.set("screening_answer", "");
        const response = await fetch(`${apiBase()}/applications`, {
          method: "POST",
          body: upstreamForm,
        });
        const result = (await response.json()) as Record<string, unknown>;
        results.push({
          filename: file.name,
          ok: response.ok,
          ...(response.ok
            ? result
            : {
                error: String(
                  result.detail || result.error || "Không xử lý được CV.",
                ),
              }),
        });
      }
      const succeeded = results.filter((item) => item.ok).length;
      const failed = results.length - succeeded;
      return Response.json({
        session_id: sessionId,
        answer: `Đã hoàn tất pipeline ${succeeded}/${results.length} CV cho ${jobData.job.title || jobId}.${failed ? ` Có ${failed} file lỗi.` : ""} Candidate, Application, điểm và file gốc đã được lưu vào MongoDB.`,
        criteria: jobData.job,
        results,
        trace: [
          {
            step: 1,
            thought: "Đọc tiêu chí JD đã lưu.",
            action: "get_job",
            arguments: { job_id: jobId },
            observation: { ok: true, job_id: jobId },
          },
          {
            step: 2,
            thought: "Parse, chấm điểm và lưu từng CV.",
            action: "parse_and_score_cv",
            arguments: {
              job_id: jobId,
              filenames: files.map((file) => file.name),
            },
            observation: { ok: failed === 0, succeeded, failed },
          },
        ],
      });
    }
    const body = (await request.json()) as {
      query?: string;
      session_id?: string;
      confirmation_id?: string;
      confirmed?: boolean;
    };
    const sessionId =
      body.session_id || `agent_${crypto.randomUUID().replaceAll("-", "")}`;

    if (body.confirmation_id) {
      const result = await resolveConfirmation(
        body.confirmation_id,
        body.confirmed === true,
      );
      return Response.json({
        session_id: sessionId,
        answer: result.cancelled
          ? "Đã hủy hành động theo yêu cầu của HR."
          : "Đã được HR xác nhận và thực hiện thành công trên dữ liệu thật.",
        result,
      });
    }

    const query = body.query?.trim();
    if (!query)
      return Response.json(
        { error: "Vui lòng nhập yêu cầu." },
        { status: 400 },
      );

    const quickAnswer = await localAnswer(query, sessionId);
    if (quickAnswer)
      return Response.json({ ...quickAnswer, session_id: sessionId });

    const trace: TraceStep[] = [];
    const history: unknown[] = [{ role: "user", content: query }];
    const seen = new Set<string>();

    for (let step = 1; step <= 8; step++) {
      let decision: Record<string, unknown>;
      try {
        decision = await llmDecision(history);
      } catch {
        return Response.json({
          answer:
            "Các model AI đang tạm hết hạn mức nên mình chưa thể suy luận yêu cầu tự do này. Bạn vẫn có thể hỏi về vị trí, tiêu chí job_id, xếp hạng ứng viên, lý do một candidate_id bị loại hoặc tải CV để chấm điểm. Hệ thống sẽ tự thử lại model ở câu hỏi sau.",
          trace,
          session_id: sessionId,
          provider: "local_fallback",
          degraded: true,
        });
      }
      if (typeof decision.final_answer === "string") {
        return Response.json({
          answer: decision.final_answer,
          trace,
          session_id: sessionId,
          provider: "gemini",
        });
      }

      const action = String(decision.action || "");
      const args =
        decision.arguments && typeof decision.arguments === "object"
          ? (decision.arguments as Record<string, unknown>)
          : {};
      if (!action) throw new Error("Agent không chọn được tool phù hợp.");

      const signature = JSON.stringify([action, args]);
      if (seen.has(signature))
        return Response.json({
          answer: "Agent đã dừng an toàn vì phát hiện hành động lặp.",
          trace,
          session_id: sessionId,
          guardrail_triggered: true,
        });
      seen.add(signature);

      const observation = await runTool(action, args, sessionId);
      trace.push({
        step,
        thought: String(
          decision.thought || "Thực hiện bước tiếp theo trong pipeline.",
        ),
        action,
        arguments: args,
        observation,
      });

      if (observation.requires_confirmation) {
        return Response.json({
          answer:
            "Mình đã chuẩn bị hành động nhưng chưa thực hiện. HR cần xác nhận trước khi hệ thống thay đổi dữ liệu hoặc gửi thông báo thật.",
          trace,
          session_id: sessionId,
          confirmation: {
            confirmation_id: observation.confirmation_id,
            tool_name: observation.tool_name,
            arguments: observation.arguments,
          },
        });
      }

      history.push(
        { role: "assistant", content: decision },
        { role: "tool", name: action, content: observation },
      );

      if (observation.ok === false) {
        return Response.json({
          answer: `Không thể hoàn tất bước ${action}: ${observation.error}`,
          trace,
          session_id: sessionId,
        });
      }
    }

    return Response.json({
      answer: "Agent đã dừng an toàn sau 8 bước. Hãy thu hẹp yêu cầu.",
      trace,
      session_id: sessionId,
      guardrail_triggered: true,
    });
  } catch (caught) {
    return Response.json(
      {
        error: caught instanceof Error ? caught.message : "Lỗi không xác định.",
      },
      { status: 500 },
    );
  }
}
