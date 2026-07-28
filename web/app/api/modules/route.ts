type Criteria = {
  job_id?: string;
  title: string;
  department: string;
  description: string;
  must_have_skills: string[];
  nice_to_have_skills: string[];
  level?: string;
  headcount?: number;
  required_certifications?: string[];
  language?: string;
  language_level?: string;
  ideal_experience_years?: number;
  experience_domains?: string[];
  min_education: string;
  preferred_majors?: string[];
  work_mode?: string;
  location: string;
  salary_min?: number;
  salary_max?: number;
  contract_type?: string;
  desired_start_date?: string;
  thresholds?: { high: number; review: number };
  screening_questions?: Array<{
    question: string;
    required_answer: string;
    hard_filter: boolean;
  }>;
  min_experience_years: number;
  weights: {
    skills: number;
    experience: number;
    education: number;
    other: number;
  };
};
type Candidate = {
  full_name: string;
  email: string;
  phone: string;
  skills: string[];
  experience_years: number;
  work_history: unknown[];
  education: Array<{ degree: string; school: string; major: string }>;
  certifications?: string[];
  languages?: Array<{ language: string; level: string }>;
  experience_domains?: string[];
  cover_letter?: string;
  expected_salary?: string;
  available_date?: string;
  screening_answer?: string;
};

function jsonError(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}
function normalize(criteria: Criteria) {
  const { _id, ...safeCriteria } = criteria as Criteria & { _id?: string };
  criteria = safeCriteria as Criteria;
  const sum = Object.values(criteria.weights).reduce(
    (a, b) => a + Number(b),
    0,
  );
  if (Math.abs(sum - 100) > 0.01)
    throw new Error(`Tổng trọng số phải bằng 100% (hiện tại ${sum}%).`);
  if (!criteria.title.trim() || !criteria.must_have_skills.length)
    throw new Error("Tên vị trí và kỹ năng bắt buộc không được để trống.");
  const high = Number(criteria.thresholds?.high ?? 80),
    review = Number(criteria.thresholds?.review ?? 60);
  if (review < 0 || high > 100 || review >= high)
    throw new Error("Ngưỡng xem xét phải nhỏ hơn ngưỡng phù hợp cao.");
  return {
    ...criteria,
    thresholds: { high, review },
    job_id: criteria.job_id || `job_${Date.now()}`,
    weights: {
      skills: criteria.weights.skills / 100,
      experience: criteria.weights.experience / 100,
      education: criteria.weights.education / 100,
      other: criteria.weights.other / 100,
    },
  };
}
function score(candidate: Candidate, criteria: ReturnType<typeof normalize>) {
  const skills = new Set(candidate.skills.map((x) => x.toLowerCase()));
  const must = criteria.must_have_skills.map((x) => x.toLowerCase());
  const nice = criteria.nice_to_have_skills.map((x) => x.toLowerCase());
  const matchedMust = must.filter((x) => skills.has(x));
  const missingMust = must.filter((x) => !skills.has(x));
  const matchedNice = nice.filter((x) => skills.has(x));
  const skillsScore =
    Math.round(
      (80 * (matchedMust.length / Math.max(must.length, 1)) +
        20 * (matchedNice.length / Math.max(nice.length, 1))) *
        10,
    ) / 10;
  const ideal = Math.max(
    Number(criteria.ideal_experience_years || criteria.min_experience_years),
    1,
  );
  const experienceScore = Math.min(
    100,
    Math.round((candidate.experience_years / ideal) * 100),
  );
  const levels: Record<string, number> = {
    high_school: 1,
    college: 2,
    bachelor: 3,
    master: 4,
    phd: 5,
  };
  const candidateLevel = Math.max(
    0,
    ...candidate.education.map((x) => levels[x.degree] || 0),
  );
  const educationScore =
    candidateLevel >= (levels[criteria.min_education] || 0)
      ? 100
      : Math.round(
          (candidateLevel / Math.max(levels[criteria.min_education] || 1, 1)) *
            100,
        );
  const certs = new Set(
    (candidate.certifications || []).map((x) => x.toLowerCase()),
  );
  const requiredCerts = (criteria.required_certifications || []).map((x) =>
    x.toLowerCase(),
  );
  const certRatio = requiredCerts.length
    ? requiredCerts.filter((x) => certs.has(x)).length / requiredCerts.length
    : 1;
  const majors = (criteria.preferred_majors || []).map((x) => x.toLowerCase());
  const majorMatch =
    !majors.length ||
    candidate.education.some((x) =>
      majors.some((m) => x.major?.toLowerCase().includes(m)),
    );
  const otherScore = Math.round(
    100 * (0.6 * certRatio + 0.4 * (majorMatch ? 1 : 0)),
  );
  const matchScore =
    Math.round(
      (skillsScore * criteria.weights.skills +
        experienceScore * criteria.weights.experience +
        educationScore * criteria.weights.education +
        otherScore * criteria.weights.other) *
        10,
    ) / 10;
  const screening = criteria.screening_questions?.[0];
  const failedScreening = Boolean(
    screening?.hard_filter &&
    candidate.screening_answer &&
    candidate.screening_answer !== screening.required_answer,
  );
  const hardRejected = missingMust.length > 0 || failedScreening;
  const tier = hardRejected
    ? "rejected"
    : matchScore >= criteria.thresholds.high
      ? "high"
      : matchScore >= criteria.thresholds.review
        ? "review"
        : "rejected";
  return {
    candidate_id: `cand_${Date.now()}`,
    job_id: criteria.job_id,
    match_score: matchScore,
    breakdown: {
      skills_score: skillsScore,
      experience_score: experienceScore,
      education_score: educationScore,
      other_score: otherScore,
    },
    missing_must_have: missingMust,
    matched_nice_to_have: matchedNice,
    hard_rejected: hardRejected,
    tier,
    recommendation:
      tier === "high"
        ? "Phù hợp cao"
        : tier === "review"
          ? "Cần xem xét"
          : "Không phù hợp",
    next_action:
      tier === "high"
        ? "Đưa vào danh sách hẹn phỏng vấn"
        : tier === "review"
          ? "Đưa vào hàng chờ HR review"
          : "Tự động loại và chuẩn bị email từ chối",
    stage:
      tier === "high"
        ? "interview_ready"
        : tier === "review"
          ? "review_queue"
          : "rejected",
    email_status: tier === "rejected" ? "rejection_pending" : "not_required",
    explanation: hardRejected
      ? missingMust.length
        ? `Loại cứng vì thiếu kỹ năng bắt buộc: ${missingMust.join(", ")}.`
        : "Loại cứng vì câu trả lời sàng lọc không đạt yêu cầu."
      : `Khớp đủ kỹ năng bắt buộc; ${candidate.experience_years}/${ideal} năm kinh nghiệm lý tưởng; điểm tổng ${matchScore}/100.`,
  };
}
async function parseWithGemini(
  file: File,
  extra: Record<string, string>,
): Promise<Candidate> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Chưa cấu hình Gemini để parse CV.");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("CV vượt quá giới hạn 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const base64 = btoa(binary);
  const prompt = `Trích xuất CV thành JSON thuần theo schema:
{"full_name":"","email":"","phone":"","skills":[],"experience_years":0,"experience_domains":[],"certifications":[],"languages":[{"language":"","level":""}],"work_history":[{"company":"","role":"","duration":""}],"education":[{"degree":"high_school|college|bachelor|master|phd","school":"","major":""}]}
Không suy đoán dữ liệu không có. Thông tin form bổ sung: ${JSON.stringify(extra)}`;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${process.env.LLM_MODEL || "gemini-2.5-flash"}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: file.type || "application/pdf",
                  data: base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
        },
      }),
    },
  );
  const data = (await response.json()) as {
    candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  if (!response.ok) throw new Error("Gemini không thể đọc CV này.");
  return {
    ...JSON.parse(data.candidates?.[0]?.content.parts[0]?.text || "{}"),
    ...extra,
  };
}
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const mongoApi = process.env.MONGO_API_URL;
    if (!mongoApi)
      return jsonError(
        "Chưa kết nối MongoDB API. Hãy chạy docker compose và mở web bằng run_web.py.",
        503,
      );
    if (mongoApi) {
      if (contentType.includes("multipart/form-data")) {
        const upstream = await fetch(`${mongoApi}/applications`, {
          method: "POST",
          body: await request.formData(),
        });
        return new Response(await upstream.text(), {
          status: upstream.status,
          headers: { "content-type": "application/json" },
        });
      }
      const body = (await request.json()) as Record<string, unknown>;
      const interviewActions = [
        "approve_application",
        "create_invite",
        "confirm_slot",
        "reschedule",
        "cancel",
        "remind",
        "complete",
        "submit_feedback",
      ];
      if (body.action === "delete_job") {
        const upstream = await fetch(
          `${mongoApi}/jobs/${encodeURIComponent(String(body.job_id || ""))}`,
          { method: "DELETE" },
        );
        return new Response(await upstream.text(), {
          status: upstream.status,
          headers: { "content-type": "application/json" },
        });
      }
      const endpoint =
        body.action === "configure_job"
          ? "/jobs"
          : body.action === "schedule_interview"
            ? "/interviews"
            : interviewActions.includes(String(body.action))
              ? "/interview-actions"
              : "";
      if (!endpoint) return jsonError("Action không hợp lệ.");
      const payload =
        body.action === "configure_job"
          ? body.criteria
          : body.action === "schedule_interview"
            ? { ...(body.input as object), hr_approved: body.hr_approved }
            : body;
      const upstream = await fetch(`${mongoApi}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "content-type": "application/json" },
      });
    }
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !file.size)
        return jsonError("File CV là bắt buộc.");
      const criteria = normalize(
        JSON.parse(String(form.get("criteria") || "{}")),
      );
      const extra = {
        cover_letter: String(form.get("cover_letter") || ""),
        expected_salary: String(form.get("expected_salary") || ""),
        available_date: String(form.get("available_date") || ""),
        screening_answer: String(form.get("screening_answer") || ""),
      };
      const candidate = await parseWithGemini(file, extra);
      return Response.json({
        ok: true,
        parsed_candidate: candidate,
        matching: score(candidate, criteria),
      });
    }
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "configure_job")
      return Response.json({
        ok: true,
        criteria: normalize(body.criteria as Criteria),
      });
    if (body.action === "delete_job")
      return Response.json({ ok: true, deleted_job_id: body.job_id });
    if (body.action === "schedule_interview") {
      if (!body.hr_approved)
        return jsonError("HR phải duyệt ứng viên trước khi đặt lịch.");
      const input = body.input as Record<string, unknown>;
      for (const key of [
        "application_id",
        "scheduled_time",
        "interviewer",
        "duration_minutes",
      ])
        if (!input?.[key]) return jsonError(`Thiếu trường ${key}.`);
      return Response.json({
        ok: true,
        interview: {
          interview_id: `int_${Date.now()}`,
          scheduled_time: input.scheduled_time,
          interviewer: input.interviewer,
          duration_minutes: Number(input.duration_minutes),
          meeting_link: "https://meet.google.com/demo-room",
          calendar_event_id: `cal_evt_${Date.now()}`,
          status: "confirmed",
        },
      });
    }
    if (body.action === "create_invite")
      return Response.json({
        ok: true,
        invite: {
          invite_id: `invite_${Date.now()}`,
          application_id: body.application_id,
          available_slots: [
            "2026-08-01T09:00:00+07:00",
            "2026-08-01T14:00:00+07:00",
            "2026-08-02T10:00:00+07:00",
          ],
          booking_link: "https://yourapp.com/schedule/demo",
          status: "sent_to_candidate",
          delivery_mode: "simulated",
        },
      });
    if (body.action === "approve_application")
      return Response.json({
        ok: true,
        application: {
          application_id: body.application_id,
          stage: "interview_ready",
          hr_approved: true,
        },
      });
    if (body.action === "confirm_slot")
      return Response.json({
        ok: true,
        interview: {
          interview_id: `int_${Date.now()}`,
          application_id: body.application_id,
          scheduled_time: body.chosen_slot,
          interviewer: "Trần Thị B",
          meeting_link: "https://meet.google.com/demo-room",
          calendar_event_id: `cal_evt_${Date.now()}`,
          status: "confirmed",
          reminders_scheduled: ["24h_before", "1h_before"],
          integration_mode: "simulated",
        },
      });
    if (
      ["reschedule", "cancel", "remind", "complete"].includes(
        String(body.action),
      )
    )
      return Response.json({
        ok: true,
        action: body.action,
        status:
          body.action === "cancel"
            ? "cancelled"
            : body.action === "complete"
              ? "completed"
              : "updated",
      });
    if (body.action === "submit_feedback")
      return Response.json({
        ok: true,
        application_id: body.application_id,
        stage: "interview_1_completed",
        next_action: String(body.result).toLowerCase().includes("vòng 2")
          ? "schedule_round_2"
          : "offer_review",
        final_status: "in_progress",
      });
    return jsonError("Action không hợp lệ.");
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Lỗi xử lý module.",
      500,
    );
  }
}

export async function GET() {
  const mongoApi = process.env.MONGO_API_URL;
  if (!mongoApi)
    return Response.json(
      {
        ok: false,
        error: "Chưa kết nối MongoDB API. Hệ thống không sử dụng dữ liệu demo.",
      },
      { status: 503 },
    );
  try {
    const upstream = await fetch(`${mongoApi}/dashboard`, {
      cache: "no-store",
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return Response.json(
      { ok: false, error: "Không kết nối được MongoDB API." },
      { status: 503 },
    );
  }
}
