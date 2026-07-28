"use client";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Tab = "pipeline" | "criteria" | "cv" | "interview" | "assistant";
type BatchItem = {
  id: string;
  filename: string;
  status: "uploading" | "extracting" | "scoring" | "done" | "error";
  progress: number;
  result?: any;
  error?: string;
};
const defaultCriteria = {
  job_id: "job_001",
  title: "Backend Developer",
  department: "Engineering",
  level: "middle",
  headcount: 2,
  description: "Xây dựng API và dịch vụ backend ổn định.",
  must_have_skills: ["Python", "SQL", "Docker"],
  nice_to_have_skills: ["AWS", "Kubernetes"],
  required_certifications: [],
  language: "Tiếng Anh",
  language_level: "Giao tiếp",
  min_experience_years: 2,
  ideal_experience_years: 4,
  experience_domains: ["Fintech", "E-commerce"],
  min_education: "bachelor",
  preferred_majors: ["Công nghệ thông tin", "Khoa học máy tính"],
  work_mode: "hybrid",
  location: "Hà Nội",
  salary_min: 25000000,
  salary_max: 40000000,
  contract_type: "full_time",
  desired_start_date: "",
  weights: { skills: 40, experience: 30, education: 15, other: 15 },
  thresholds: { high: 80, review: 60 },
  screening_questions: [
    {
      question: "Bạn có sẵn sàng đi công tác không?",
      required_answer: "yes",
      hard_filter: false,
    },
  ],
};
const tabs: Array<{ id: Tab; icon: string; label: string }> = [
  { id: "pipeline", icon: "◈", label: "Tổng quan" },
  { id: "criteria", icon: "⚙", label: "1. Tiêu chí JD" },
  { id: "cv", icon: "▤", label: "2. Xử lý CV" },
  { id: "interview", icon: "◷", label: "3. Phỏng vấn" },
  { id: "assistant", icon: "✦", label: "Trợ lý ReAct" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [criteria, setCriteria] = useState(defaultCriteria);
  const [saved, setSaved] = useState(false);
  const [moduleResult, setModuleResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(false);
  const [applicationId, setApplicationId] = useState("");
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [dbStatus, setDbStatus] = useState<
    "checking" | "connected" | "demo" | "offline"
  >("checking");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [interviewData, setInterviewData] = useState<{
    jobs: any[];
    candidates: any[];
    applications: any[];
    interviews: any[];
    invites: any[];
  }>({
    jobs: [],
    candidates: [],
    applications: [],
    interviews: [],
    invites: [],
  });
  const weightTotal = useMemo(
    () => Object.values(criteria.weights).reduce((a, b) => a + Number(b), 0),
    [criteria],
  );
  useEffect(() => {
    let active = true;
    const refresh = () =>
      fetch("/api/modules")
        .then(async (r) => {
          const d = await r.json();
          if (!active) return;
          setCounts(d.counts || {});
          setInterviewData({
            jobs: d.jobs || [],
            candidates: d.candidates || [],
            applications: d.applications || [],
            interviews: d.interviews || [],
            invites: d.invites || [],
          });
          setDbStatus(
            r.ok ? (d.database === "demo" ? "demo" : "connected") : "offline",
          );
        })
        .catch(() => setDbStatus("offline"));
    refresh();
    const timer = setInterval(refresh, 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [moduleResult]);
  useEffect(() => {
    if (tab !== "cv" || !interviewData.jobs.length) return;
    if (
      !interviewData.jobs.some((job: any) => job.job_id === criteria.job_id)
    ) {
      const { _id, ...firstJob } = interviewData.jobs[0];
      setCriteria({ ...criteria, ...firstJob });
    }
  }, [tab, interviewData.jobs]);
  async function saveCriteria(e: FormEvent) {
    e.preventDefault();
    await post({ action: "configure_job", criteria }, (d) => {
      setCriteria({
        ...criteria,
        ...(d.criteria as typeof criteria),
        weights: criteria.weights,
      });
      setSaved(true);
    });
  }
  async function post(
    body: unknown,
    onDone?: (data: Record<string, unknown>) => void,
  ) {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/modules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as Record<string, unknown>;
      if (!r.ok)
        throw new Error(
          String(d.error || d.detail || "Không thể hoàn tất yêu cầu."),
        );
      setModuleResult(d);
      onDone?.(d);
      return d;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }
  async function uploadCV(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const source = new FormData(e.currentTarget);
    const files = source
      .getAll("files")
      .filter((x): x is File => x instanceof File && x.size > 0);
    if (!files.length) {
      setError("Vui lòng chọn ít nhất một CV.");
      return;
    }
    const seed = files.map((file, i) => ({
      id: `${Date.now()}_${i}`,
      filename: file.name,
      status: "uploading" as const,
      progress: 10,
    }));
    setBatchItems(seed);
    setLoading(true);
    setError("");
    const patch = (id: string, value: Partial<BatchItem>) =>
      setBatchItems((old) =>
        old.map((x) => (x.id === id ? { ...x, ...value } : x)),
      );
    for (let i = 0; i < files.length; i++) {
      const file = files[i],
        id = seed[i].id;
      try {
        patch(id, { status: "extracting", progress: 35 });
        const form = new FormData();
        form.set("file", file);
        form.set("criteria", JSON.stringify(criteria));
        for (const key of [
          "cover_letter",
          "expected_salary",
          "available_date",
          "screening_answer",
        ])
          form.set(key, String(source.get(key) || ""));
        const r = await fetch("/api/modules", { method: "POST", body: form });
        patch(id, { status: "scoring", progress: 75 });
        const d = (await r.json()) as Record<string, unknown>;
        if (!r.ok)
          throw new Error(String(d.error || d.detail || "Không đọc được CV"));
        const batchResults = (d.results as any[]) || [];
        if (batchResults.length) {
          patch(id, {
            status: "done",
            progress: 100,
            filename: batchResults[0].cv_filename || file.name,
            result: {
              matching: batchResults[0],
              parsed_candidate: batchResults[0],
            },
          });
          if (batchResults.length > 1)
            setBatchItems((old) => [
              ...old,
              ...batchResults.slice(1).map((result, index) => ({
                id: `${id}_zip_${index}`,
                filename: result.cv_filename || `CV ${index + 2}`,
                status: "done" as const,
                progress: 100,
                result: { matching: result, parsed_candidate: result },
              })),
            ]);
        } else patch(id, { status: "done", progress: 100, result: d });
        setModuleResult(d);
        setApproved(false);
      } catch (err) {
        patch(id, {
          status: "error",
          progress: 100,
          error: err instanceof Error ? err.message : "File lỗi",
        });
      }
    }
    setLoading(false);
  }
  async function schedule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await post({
      action: "schedule_interview",
      hr_approved: approved,
      input: Object.fromEntries(f.entries()),
    });
  }
  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <div className="mark">R</div>
          <div>
            <strong>RecruitFlow</strong>
            <span>AI tuyển dụng có kiểm soát</span>
          </div>
        </div>
        <div className="top-actions">
          <span className={`safe-pill db-${dbStatus}`}>
            <i />{" "}
            {dbStatus === "connected"
              ? "MongoDB đã kết nối"
              : dbStatus === "checking"
                ? "Đang kiểm tra dữ liệu"
                : dbStatus === "demo"
                  ? "Chế độ demo"
                  : "MongoDB offline"}
          </span>
          <div className="avatar">HR</div>
        </div>
      </header>
      <div className="shell">
        <aside>
          <nav>
            {tabs.map((x) => (
              <button
                key={x.id}
                className={tab === x.id ? "active" : ""}
                onClick={() => {
                  setTab(x.id);
                  setModuleResult(null);
                  setError("");
                }}
              >
                <span className="nav-icon">{x.icon}</span>
                {x.label}
              </button>
            ))}
          </nav>
          <div className="aside-note">
            <div className="shield">✓</div>
            <span>Human-in-the-loop</span>
            <p>AI chấm điểm và giải thích. HR duyệt trước khi đặt lịch.</p>
          </div>
        </aside>
        <section className="workspace module-workspace">
          <div className="module-head">
            <div>
              <p className="eyebrow">INPUT → PROCESS → OUTPUT</p>
              <h1>
                {tab === "pipeline"
                  ? "Tuyển đúng người,"
                  : tab === "criteria"
                    ? "Cấu hình tiêu chí"
                    : tab === "cv"
                      ? "Parse & chấm CV"
                      : tab === "interview"
                        ? "Hẹn phỏng vấn"
                        : "Trợ lý ReAct"}
                <br />
                <em>
                  {tab === "pipeline"
                    ? "bằng quyết định có căn cứ."
                    : tab === "criteria"
                      ? "cho vị trí tuyển dụng."
                      : tab === "cv"
                        ? "có giải thích rõ ràng."
                        : tab === "interview"
                          ? "sau khi HR phê duyệt."
                          : "hỗ trợ toàn pipeline."}
                </em>
              </h1>
            </div>
            <div className="job-badge">
              <small>VỊ TRÍ HIỆN TẠI</small>
              <strong>{criteria.title}</strong>
              <span>{criteria.job_id} · Chính sách 3 tier</span>
            </div>
          </div>
          {error && (
            <div className="error-box">
              <strong>Chưa thể hoàn tất</strong>
              <p>{error}</p>
            </div>
          )}
          {tab === "pipeline" && <Pipeline setTab={setTab} counts={counts} />}
          {tab === "criteria" && (
            <>
              <SavedJobs
                jobs={interviewData.jobs}
                activeJobId={criteria.job_id}
                loading={loading}
                onEdit={(job: any) => {
                  const { _id, ...safeJob } = job;
                  setCriteria({ ...defaultCriteria, ...safeJob });
                  setSaved(true);
                  setModuleResult(null);
                }}
                onNew={() => {
                  setCriteria({
                    ...defaultCriteria,
                    job_id: `job_${Date.now().toString().slice(-6)}`,
                    title: "",
                  });
                  setSaved(false);
                  setModuleResult(null);
                }}
                onDelete={async (jobId: string) => {
                  if (
                    !window.confirm(`Bạn chắc chắn muốn xóa vị trí ${jobId}?`)
                  ) {
                    return;
                  }
                  await post({ action: "delete_job", job_id: jobId });
                  if (criteria.job_id === jobId) {
                    setCriteria({
                      ...defaultCriteria,
                      job_id: `job_${Date.now().toString().slice(-6)}`,
                      title: "",
                    });
                    setSaved(false);
                  }
                }}
              />
              <CriteriaForm
                criteria={criteria}
                setCriteria={setCriteria}
                total={weightTotal}
                saved={saved}
                loading={loading}
                onSubmit={saveCriteria}
              />
            </>
          )}
          {tab === "cv" && (
            <CVForm
              criteria={criteria}
              jobs={interviewData.jobs}
              onJobChange={(jobId: string) => {
                const job = interviewData.jobs.find(
                  (x: any) => x.job_id === jobId,
                );
                if (job) {
                  const { _id, ...safeJob } = job;
                  setCriteria({ ...criteria, ...safeJob });
                  setBatchItems([]);
                  setModuleResult(null);
                }
              }}
              loading={loading}
              onSubmit={uploadCV}
              items={batchItems}
              onDetail={setModuleResult}
              onInvite={async (id: string) => {
                setApplicationId(id);
                setApproved(true);
                await post({
                  action: "approve_application",
                  application_id: id,
                });
                setTab("interview");
              }}
            />
          )}
          {tab === "interview" && (
            <InterviewForm
              approved={approved}
              setApproved={setApproved}
              applicationId={applicationId}
              loading={loading}
              onSubmit={schedule}
              data={interviewData}
              onAction={(body: any) => post(body)}
            />
          )}
          {tab === "assistant" && <Assistant jobs={interviewData.jobs} />}
          {moduleResult && (
            <OutputPanel
              data={moduleResult}
              onApprove={() => {
                setApplicationId(
                  String((moduleResult.matching as any)?.application_id || ""),
                );
                setApproved(true);
                setTab("interview");
                setModuleResult(null);
              }}
            />
          )}
        </section>
      </div>
    </main>
  );
}
function Pipeline({
  setTab,
  counts,
}: {
  setTab: (t: Tab) => void;
  counts: Record<string, number>;
}) {
  return (
    <>
      <div className="data-stats">
        {[
          ["Vị trí", counts.jobs || 0],
          ["Ứng viên", counts.candidates || 0],
          ["Hồ sơ", counts.applications || 0],
          ["Phỏng vấn", counts.interviews || 0],
        ].map((x) => (
          <div key={x[0]}>
            <strong>{x[1]}</strong>
            <span>{x[0]} trong MongoDB</span>
          </div>
        ))}
      </div>
      <div className="pipeline-art">
        <img src="/hero-pixel.png" alt="RecruitFlow pixel-art pipeline" />
        <div className="pipeline-caption">
          <span>
            <i /> RECRUITMENT PIPELINE ONLINE
          </span>
          <p>Ba module, một luồng dữ liệu minh bạch.</p>
        </div>
      </div>
      <div className="flow-grid">
        {[
          [
            "01",
            "JD Criteria",
            "Định nghĩa kỹ năng, kinh nghiệm, trọng số và chính sách 3 tier.",
            "criteria",
            "Cấu hình vị trí",
          ],
          [
            "02",
            "CV Processing",
            "Upload CV → parse JSON → matching → explanation.",
            "cv",
            "Xử lý CV",
          ],
          [
            "03",
            "Interview",
            "HR duyệt → chọn interviewer, slot và thời lượng.",
            "interview",
            "Đặt lịch",
          ],
        ].map((x) => (
          <article key={x[0]}>
            <b>{x[0]}</b>
            <div className="flow-icon">
              {x[0] === "01" ? "⚙" : x[0] === "02" ? "▤" : "◷"}
            </div>
            <h3>{x[1]}</h3>
            <p>{x[2]}</p>
            <button onClick={() => setTab(x[3] as Tab)}>{x[4]} →</button>
          </article>
        ))}
      </div>
    </>
  );
}
function SavedJobs({
  jobs,
  activeJobId,
  onEdit,
  onNew,
  onDelete,
  loading,
}: any) {
  return (
    <section className="saved-jobs">
      <div className="saved-jobs-head">
        <div>
          <span className="card-label">DỮ LIỆU MONGODB</span>
          <h3>Vị trí & bộ tiêu chí đã lưu</h3>
          <p>HR có thể mở lại để kiểm tra, chỉnh sửa hoặc tạo vị trí mới.</p>
        </div>
        <button type="button" onClick={onNew}>
          ＋ Tạo vị trí mới
        </button>
      </div>
      {jobs.length ? (
        <div className="saved-jobs-grid">
          {jobs.map((job: any) => (
            <article
              key={job.job_id}
              className={job.job_id === activeJobId ? "active" : ""}
            >
              <div>
                <small>{job.job_id}</small>
                <strong>{job.title}</strong>
                <span>
                  {job.department} · {job.level || "Chưa đặt cấp bậc"}
                </span>
              </div>
              <div className="job-summary">
                <span>{job.must_have_skills?.length || 0} must-have</span>
                <span>≥ {job.thresholds?.high || 80}% phù hợp cao</span>
                <span>{job.headcount || 1} vị trí</span>
              </div>
              <footer>
                <button type="button" onClick={() => onEdit(job)}>
                  Mở & chỉnh sửa
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={loading}
                  onClick={() => onDelete(job.job_id)}
                >
                  Xóa
                </button>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="saved-jobs-empty">
          <span>◇</span>
          <p>MongoDB chưa có vị trí nào. Hãy tạo vị trí đầu tiên.</p>
        </div>
      )}
    </section>
  );
}
function TagInput({
  value,
  onChange,
  placeholder,
  required = false,
}: {
  value: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [draft, setDraft] = useState(value.join(", "));
  const commit = (text: string) => {
    const items = [
      ...new Set(
        text
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ];
    onChange(items);
    setDraft(items.join(", "));
  };
  return (
    <input
      required={required}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        onChange(
          text
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        );
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(e.currentTarget.value);
        }
      }}
    />
  );
}
function CriteriaForm({
  criteria,
  setCriteria,
  total,
  saved,
  loading,
  onSubmit,
}: any) {
  const text = (k: string) => (e: any) =>
    setCriteria({ ...criteria, [k]: e.target.value });
  const setTags = (k: string) => (items: string[]) =>
    setCriteria({ ...criteria, [k]: items });
  const weight = (k: string) => (e: any) =>
    setCriteria({
      ...criteria,
      weights: { ...criteria.weights, [k]: Number(e.target.value) },
    });
  const number = (k: string) => (e: any) =>
    setCriteria({ ...criteria, [k]: Number(e.target.value) });
  const threshold = (k: string) => (e: any) =>
    setCriteria({
      ...criteria,
      thresholds: { ...criteria.thresholds, [k]: Number(e.target.value) },
    });
  const question = criteria.screening_questions?.[0] || {
    question: "",
    required_answer: "yes",
    hard_filter: false,
  };
  const setQuestion = (patch: Record<string, unknown>) =>
    setCriteria({
      ...criteria,
      screening_questions: [{ ...question, ...patch }],
    });
  const thresholdsValid =
    criteria.thresholds.review >= 0 &&
    criteria.thresholds.review < criteria.thresholds.high &&
    criteria.thresholds.high <= 100;
  return (
    <form className="module-form" onSubmit={onSubmit}>
      <div className="form-section">
        <div className="section-title">
          <b>01</b>
          <div>
            <h3>Thông tin cơ bản vị trí</h3>
            <p>Xác định nhu cầu tuyển dụng và JD gốc để AI tham chiếu.</p>
          </div>
        </div>
        <div className="field-grid">
          <label>
            Tên vị trí
            <input required value={criteria.title} onChange={text("title")} />
          </label>
          <label>
            Mã vị trí (Job ID)
            <input
              required
              value={criteria.job_id}
              onChange={text("job_id")}
              placeholder="VD: job_backend_001"
            />
          </label>
          <label>
            Phòng ban
            <select value={criteria.department} onChange={text("department")}>
              <option>Engineering</option>
              <option>Product</option>
              <option>Marketing</option>
            </select>
          </label>
          <label>
            Cấp bậc
            <select value={criteria.level} onChange={text("level")}>
              {["intern", "junior", "middle", "senior", "lead"].map((x) => (
                <option key={x} value={x}>
                  {x[0].toUpperCase() + x.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Số lượng cần tuyển
            <input
              type="number"
              min="1"
              value={criteria.headcount}
              onChange={number("headcount")}
            />
          </label>
          <label className="wide">
            JD gốc
            <textarea
              required
              value={criteria.description}
              onChange={text("description")}
            />
          </label>
        </div>
      </div>
      <div className="form-section">
        <div className="section-title">
          <b>02</b>
          <div>
            <h3>Tiêu chí kỹ năng</h3>
            <p>
              Must-have là điều kiện loại cứng; các danh sách cách nhau bằng dấu
              phẩy.
            </p>
          </div>
        </div>
        <div className="field-grid">
          <label className="wide">
            Kỹ năng bắt buộc
            <TagInput
              key={`${criteria.job_id}-must`}
              required
              value={criteria.must_have_skills}
              onChange={setTags("must_have_skills")}
              placeholder="Python, SQL, Docker"
            />
            <small>
              {criteria.must_have_skills.map((x: string) => (
                <i key={x}>{x}</i>
              ))}
            </small>
          </label>
          <label className="wide">
            Kỹ năng ưu tiên
            <TagInput
              key={`${criteria.job_id}-nice`}
              value={criteria.nice_to_have_skills}
              onChange={setTags("nice_to_have_skills")}
              placeholder="AWS, Kubernetes"
            />
          </label>
          <label className="wide">
            Chứng chỉ yêu cầu
            <TagInput
              key={`${criteria.job_id}-certs`}
              value={criteria.required_certifications}
              onChange={setTags("required_certifications")}
              placeholder="AWS Certified, PMP"
            />
          </label>
          <label>
            Ngoại ngữ
            <input value={criteria.language} onChange={text("language")} />
          </label>
          <label>
            Mức độ
            <select
              value={criteria.language_level}
              onChange={text("language_level")}
            >
              <option>Giao tiếp</option>
              <option>Khá</option>
              <option>Thành thạo</option>
              <option>Bản ngữ</option>
            </select>
          </label>
        </div>
      </div>
      <div className="form-section">
        <div className="section-title">
          <b>03</b>
          <div>
            <h3>Kinh nghiệm & học vấn</h3>
            <p>Dùng mốc lý tưởng để điểm tăng mượt theo kinh nghiệm.</p>
          </div>
        </div>
        <div className="field-grid">
          <label>
            Số năm tối thiểu
            <input
              type="number"
              min="0"
              value={criteria.min_experience_years}
              onChange={(e) =>
                setCriteria({
                  ...criteria,
                  min_experience_years: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Số năm lý tưởng
            <input
              type="number"
              min={criteria.min_experience_years}
              value={criteria.ideal_experience_years}
              onChange={number("ideal_experience_years")}
            />
          </label>
          <label className="wide">
            Lĩnh vực kinh nghiệm
            <TagInput
              key={`${criteria.job_id}-domains`}
              value={criteria.experience_domains}
              onChange={setTags("experience_domains")}
              placeholder="Fintech, E-commerce"
            />
          </label>
          <label>
            Bằng cấp tối thiểu
            <select
              value={criteria.min_education}
              onChange={text("min_education")}
            >
              <option value="high_school">THPT</option>
              <option value="college">Cao đẳng</option>
              <option value="bachelor">Đại học</option>
              <option value="master">Thạc sĩ</option>
              <option value="phd">Tiến sĩ</option>
            </select>
          </label>
          <label>
            Chuyên ngành ưu tiên
            <TagInput
              key={`${criteria.job_id}-majors`}
              value={criteria.preferred_majors}
              onChange={setTags("preferred_majors")}
              placeholder="CNTT, Khoa học máy tính"
            />
          </label>
        </div>
      </div>
      <div className="form-section">
        <div className="section-title">
          <b>04</b>
          <div>
            <h3>Điều kiện công việc</h3>
            <p>Lọc độ phù hợp về hình thức, lương và thời điểm bắt đầu.</p>
          </div>
        </div>
        <div className="field-grid">
          <label>
            Hình thức
            <select value={criteria.work_mode} onChange={text("work_mode")}>
              <option value="onsite">Onsite</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>
          <label>
            Địa điểm
            <input value={criteria.location} onChange={text("location")} />
          </label>
          <label>
            Lương tối thiểu
            <input
              type="number"
              min="0"
              value={criteria.salary_min}
              onChange={number("salary_min")}
            />
          </label>
          <label>
            Lương tối đa
            <input
              type="number"
              min={criteria.salary_min}
              value={criteria.salary_max}
              onChange={number("salary_max")}
            />
          </label>
          <label>
            Loại hợp đồng
            <select
              value={criteria.contract_type}
              onChange={text("contract_type")}
            >
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="freelance">Freelance</option>
            </select>
          </label>
          <label>
            Ngày cần bắt đầu
            <input
              type="date"
              value={criteria.desired_start_date}
              onChange={text("desired_start_date")}
            />
          </label>
        </div>
      </div>
      <div className="form-section">
        <div className="section-title">
          <b>05</b>
          <div>
            <h3>Trọng số chấm điểm</h3>
            <p className={total === 100 ? "valid" : "invalid"}>
              Tổng: {total}% {total === 100 ? "✓" : "— cần bằng 100%"}
            </p>
          </div>
        </div>
        <div className="weight-grid">
          {Object.entries(criteria.weights).map(([k, v]) => (
            <label key={k}>
              {k}
              <input
                type="range"
                min="0"
                max="100"
                value={v as number}
                onChange={weight(k)}
              />
              <span>{String(v)}%</span>
            </label>
          ))}
        </div>
      </div>
      <div className="form-section">
        <div className="section-title">
          <b>06</b>
          <div>
            <h3>Ngưỡng quyết định</h3>
            <p>Có thể điều chỉnh theo từng vị trí tuyển dụng.</p>
          </div>
        </div>
        <div className="field-grid threshold-inputs">
          <label>
            Phù hợp cao từ (%)
            <input
              type="number"
              min="1"
              max="100"
              value={criteria.thresholds.high}
              onChange={threshold("high")}
            />
          </label>
          <label>
            Cần xem xét từ (%)
            <input
              type="number"
              min="0"
              max="99"
              value={criteria.thresholds.review}
              onChange={threshold("review")}
            />
          </label>
        </div>
        <div className="tier-policy">
          <div className="tier-high">
            <strong>≥ {criteria.thresholds.high}</strong>
            <span>Phù hợp cao</span>
            <small>Vào danh sách hẹn phỏng vấn</small>
          </div>
          <div className="tier-review">
            <strong>
              {criteria.thresholds.review}–{criteria.thresholds.high - 1}
            </strong>
            <span>Cần xem xét</span>
            <small>HR đọc CV + explanation</small>
          </div>
          <div className="tier-low">
            <strong>&lt; {criteria.thresholds.review}</strong>
            <span>Không phù hợp</span>
            <small>Loại và chuẩn bị email từ chối</small>
          </div>
        </div>
      </div>
      <div className="form-section">
        <div className="section-title">
          <b>07</b>
          <div>
            <h3>Câu hỏi sàng lọc bổ sung</h3>
            <p>Tùy chọn; có thể dùng làm điều kiện loại cứng.</p>
          </div>
        </div>
        <div className="field-grid">
          <label className="wide">
            Câu hỏi Yes/No
            <input
              value={question.question}
              onChange={(e) => setQuestion({ question: e.target.value })}
            />
          </label>
          <label>
            Câu trả lời yêu cầu
            <select
              value={question.required_answer}
              onChange={(e) => setQuestion({ required_answer: e.target.value })}
            >
              <option value="yes">Có</option>
              <option value="no">Không</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={question.hard_filter}
              onChange={(e) => setQuestion({ hard_filter: e.target.checked })}
            />{" "}
            Loại cứng nếu trả lời sai
          </label>
        </div>
      </div>
      <button
        className="primary-action"
        disabled={loading || total !== 100 || !thresholdsValid}
      >
        {loading
          ? "Đang lưu…"
          : saved
            ? "Đã lưu tiêu chí ✓"
            : "Lưu khuôn chấm điểm"}
      </button>
    </form>
  );
}
function CVForm({
  criteria,
  jobs,
  onJobChange,
  loading,
  onSubmit,
  items,
  onInvite,
  onDetail,
}: any) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const results = (items as BatchItem[])
    .filter((x) => x.status === "done" && x.result?.matching)
    .map((x) => ({
      ...x,
      m: x.result.matching,
      c: x.result.parsed_candidate || x.result.matching,
    }))
    .filter(
      (x) =>
        (filter === "all" || x.m.tier === filter) &&
        String(x.c?.full_name || x.filename)
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.m.match_score - a.m.match_score);
  const statusLabel: Record<string, string> = {
    uploading: "Đang tải lên",
    extracting: "Đang trích xuất",
    scoring: "Đang chấm điểm",
    done: "Hoàn tất",
    error: "Lỗi",
  };
  return (
    <div className="cv-processing">
      <form className="module-form" onSubmit={onSubmit}>
        <div className="form-section">
          <div className="section-title">
            <b>01</b>
            <div>
              <h3>Chọn vị trí & tải CV</h3>
              <p>
                Chọn job trước khi upload để dùng đúng bộ tiêu chí chấm điểm.
              </p>
            </div>
          </div>
          <div className="field-grid">
            <label className="wide">
              Vị trí tuyển dụng
              <select
                required
                value={criteria.job_id}
                onChange={(e) => onJobChange(e.target.value)}
              >
                {!jobs?.length && (
                  <option value={criteria.job_id}>
                    {criteria.title} · {criteria.job_id}
                  </option>
                )}
                {(jobs || []).map((job: any) => (
                  <option key={job.job_id} value={job.job_id}>
                    {job.title} · {job.job_id}
                  </option>
                ))}
              </select>
              <small>
                Bộ tiêu chí được HR cấu hình và lưu từ tab “Tiêu chí JD”.
              </small>
            </label>
          </div>
          <label className="upload-zone">
            <input
              name="files"
              type="file"
              required
              multiple
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt,.zip"
            />
            <span>⇧</span>
            <strong>Kéo thả nhiều CV hoặc ZIP vào đây</strong>
            <small>PDF, DOCX, JPG, PNG, ZIP · Tối đa 10 MB/file</small>
          </label>
          <div className="import-actions">
            <button type="button" disabled>
              ✉ Nhập từ Email
            </button>
            <button type="button" disabled>
              ◆ Google Drive
            </button>
            <button type="button" disabled>
              ↗ Paste link LinkedIn
            </button>
            <span>Các nguồn ngoài sẽ được kết nối ở giai đoạn tiếp theo.</span>
          </div>
        </div>
        <div className="form-section">
          <div className="section-title">
            <b>02</b>
            <div>
              <h3>Thông tin ứng tuyển</h3>
              <p>
                Đang dùng khuôn: {criteria.title} ({criteria.job_id})
              </p>
            </div>
          </div>
          <div className="field-grid">
            <label className="wide">
              Cover letter
              <textarea name="cover_letter" placeholder="Tùy chọn" />
            </label>
            <label>
              Mức lương mong muốn
              <input name="expected_salary" placeholder="VD: 25–30 triệu" />
            </label>
            <label>
              Ngày có thể bắt đầu
              <input name="available_date" type="date" />
            </label>
            {criteria.screening_questions?.[0]?.question && (
              <label className="wide">
                {criteria.screening_questions[0].question}
                <select name="screening_answer" defaultValue="">
                  <option value="">Chọn câu trả lời</option>
                  <option value="yes">Có</option>
                  <option value="no">Không</option>
                </select>
              </label>
            )}
          </div>
        </div>
        <button className="primary-action" disabled={loading}>
          {loading ? "Đang xử lý hàng loạt…" : "Bắt đầu parse & chấm điểm"}
        </button>
      </form>
      {items.length > 0 && (
        <section className="processing-board">
          <div className="section-title">
            <b>02</b>
            <div>
              <h3>Trạng thái xử lý</h3>
              <p>
                {items.filter((x: BatchItem) => x.status === "done").length}/
                {items.length} CV đã hoàn tất · Có thể rời tab và quay lại trong
                phiên này.
              </p>
            </div>
          </div>
          <div className="processing-list">
            {items.map((x: BatchItem) => (
              <div className={`processing-row status-${x.status}`} key={x.id}>
                <span className="file-icon">▤</span>
                <div>
                  <strong>{x.filename}</strong>
                  <small>{x.error || statusLabel[x.status]}</small>
                  <i>
                    <b style={{ width: `${x.progress}%` }} />
                  </i>
                </div>
                <em>
                  {x.status === "done"
                    ? "✓"
                    : x.status === "error"
                      ? "!"
                      : `${x.progress}%`}
                </em>
              </div>
            ))}
          </div>
        </section>
      )}
      {results.length > 0 && (
        <section className="results-board">
          <div className="results-head">
            <div>
              <span className="card-label">BẢNG KẾT QUẢ</span>
              <h3>Ứng viên đã xử lý</h3>
            </div>
            <div className="result-tools">
              <input
                aria-label="Tìm ứng viên"
                placeholder="Tìm theo tên…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label="Lọc xếp loại"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">Tất cả xếp loại</option>
                <option value="high">Phù hợp cao</option>
                <option value="review">Cần xem xét</option>
                <option value="rejected">Không phù hợp</option>
              </select>
            </div>
          </div>
          <div className="results-table">
            <div className="result-row table-head">
              <span>Ứng viên</span>
              <span>Điểm</span>
              <span>Xếp loại</span>
              <span>Thiếu kỹ năng</span>
              <span>Hành động</span>
            </div>
            {results.map((x) => (
              <div className="result-row" key={x.id}>
                <div>
                  <strong>{x.c?.full_name || x.filename}</strong>
                  <small>{x.filename}</small>
                </div>
                <b className={`score-chip ${x.m.tier}`}>{x.m.match_score}%</b>
                <span className={`tier-chip ${x.m.tier}`}>
                  {x.m.tier === "high"
                    ? "● Phù hợp cao"
                    : x.m.tier === "review"
                      ? "● Cần xem xét"
                      : "● Không phù hợp"}
                </span>
                <span>{x.m.missing_must_have?.join(", ") || "—"}</span>
                <div className="row-actions">
                  <button type="button" onClick={() => onDetail(x.result)}>
                    Xem chi tiết
                  </button>
                  {x.m.tier !== "rejected" && (
                    <button
                      type="button"
                      className="invite"
                      onClick={() => onInvite(x.m.application_id)}
                    >
                      Mời phỏng vấn
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
function InterviewForm({ loading, data, onAction }: any) {
  const [view, setView] = useState<"pending" | "scheduled" | "completed">(
    "pending",
  );
  const [modal, setModal] = useState<{
    type: "invite" | "feedback" | "reschedule";
    item: any;
  } | null>(null);
  const [slots, setSlots] = useState<any>(null);
  const [draftSlots, setDraftSlots] = useState<string[]>([""]);
  const scheduled = (data.interviews || []).filter(
    (x: any) => !["completed", "cancelled"].includes(x.status),
  );
  const completed = (data.interviews || []).filter(
    (x: any) => x.status === "completed",
  );
  const scheduledApps = new Set(
    (data.interviews || []).map((x: any) => x.application_id),
  );
  const pending = (data.applications || []).filter(
    (x: any) =>
      ["interview_ready", "interview_invited"].includes(x.stage) &&
      !scheduledApps.has(x.application_id),
  );
  const candidateFor = (item: any) =>
    (data.candidates || []).find(
      (candidate: any) => candidate.candidate_id === item.candidate_id,
    );
  const jobFor = (item: any) =>
    (data.jobs || []).find((job: any) => job.job_id === item.job_id);
  const submitInvite = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const f = Object.fromEntries(form.entries());
    const availableSlots = form
      .getAll("available_slots")
      .filter(Boolean)
      .map((x) => new Date(String(x)).toISOString());
    const d = await onAction({
      action: "create_invite",
      application_id: modal?.item.application_id,
      interviewer_ids: [f.interviewer_id],
      interview_duration_minutes: Number(f.duration),
      interview_type: f.interview_type,
      interview_round: Number(f.interview_round),
      available_slots: availableSlots,
      public_app_url: window.location.origin,
    });
    if (d?.invite) setSlots(d.invite);
  };
  const submitFeedback = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await onAction({
      action: "submit_feedback",
      interview_id: modal?.item.interview_id,
      application_id: modal?.item.application_id,
      ...Object.fromEntries(new FormData(e.currentTarget).entries()),
    });
    setModal(null);
  };
  return (
    <div className="interview-workspace">
      <div className="interview-tabs">
        <button
          className={view === "pending" ? "active" : ""}
          onClick={() => setView("pending")}
        >
          Chờ hẹn lịch <b>{pending.length}</b>
        </button>
        <button
          className={view === "scheduled" ? "active" : ""}
          onClick={() => setView("scheduled")}
        >
          Đã đặt lịch <b>{scheduled.length}</b>
        </button>
        <button
          className={view === "completed" ? "active" : ""}
          onClick={() => setView("completed")}
        >
          Đã phỏng vấn <b>{completed.length}</b>
        </button>
      </div>
      <section className="interview-board">
        {view === "pending" && (
          <>
            <div className="board-title">
              <div>
                <span>PENDING SCHEDULING</span>
                <h3>Ứng viên đã duyệt, chờ gửi lịch</h3>
              </div>
              <small>Slot trùng lịch được loại trước khi gửi</small>
            </div>
            <div className="interview-table">
              <div className="interview-row head">
                <span>Ứng viên</span>
                <span>Application</span>
                <span>Điểm</span>
                <span>Ngày duyệt</span>
                <span>Hành động</span>
              </div>
              {pending.length ? (
                pending.map((x: any) => (
                  <div className="interview-row" key={x.application_id}>
                    <strong>
                      {candidateFor(x)?.full_name || x.candidate_id}
                      <small>{candidateFor(x)?.email || "Chưa có email"}</small>
                    </strong>
                    <span>
                      {x.application_id}
                      <small>{x.job_id}</small>
                    </span>
                    <b>{x.match_score}%</b>
                    <span>
                      {new Date(
                        x.approved_at || x.created_at,
                      ).toLocaleDateString("vi-VN")}
                    </span>
                    <button
                      onClick={() => {
                        setModal({ type: "invite", item: x });
                        setSlots(null);
                        setDraftSlots([""]);
                      }}
                    >
                      Gửi link đặt lịch
                    </button>
                  </div>
                ))
              ) : (
                <EmptyInterview text="Chưa có ứng viên nào chờ hẹn lịch." />
              )}
            </div>
          </>
        )}
        {view === "scheduled" && (
          <>
            <div className="board-title">
              <div>
                <span>SCHEDULED</span>
                <h3>Lịch phỏng vấn đã đặt</h3>
              </div>
              <small>Nhắc lịch 24 giờ và 1 giờ trước buổi phỏng vấn</small>
            </div>
            <div className="interview-table">
              <div className="interview-row scheduled-head">
                <span>Ứng viên</span>
                <span>Thời gian</span>
                <span>Người PV</span>
                <span>Hình thức</span>
                <span>Trạng thái</span>
                <span>Hành động</span>
              </div>
              {scheduled.length ? (
                scheduled.map((x: any) => (
                  <div
                    className="interview-row scheduled-row"
                    key={x.interview_id}
                  >
                    <strong>
                      {candidateFor(x)?.full_name || x.candidate_id}
                      <small>{candidateFor(x)?.email}</small>
                    </strong>
                    <span>
                      {new Date(x.scheduled_time).toLocaleString("vi-VN")}
                    </span>
                    <span>
                      {x.interviewer || x.interviewer_ids?.join(", ")}
                    </span>
                    <span>
                      {x.interview_type === "online"
                        ? "Online · Meet"
                        : "Onsite"}
                    </span>
                    <span className="confirmed">
                      ●{" "}
                      {x.status === "confirmed"
                        ? "Đã xác nhận"
                        : "Chờ xác nhận"}
                    </span>
                    <div className="compact-actions">
                      <button
                        onClick={() =>
                          setModal({ type: "reschedule", item: x })
                        }
                      >
                        Dời
                      </button>
                      <button
                        onClick={() =>
                          onAction({
                            action: "remind",
                            interview_id: x.interview_id,
                          })
                        }
                      >
                        Nhắc
                      </button>
                      <button
                        onClick={() =>
                          onAction({
                            action: "complete",
                            interview_id: x.interview_id,
                          })
                        }
                      >
                        Hoàn tất
                      </button>
                      <button
                        className="danger"
                        onClick={() =>
                          onAction({
                            action: "cancel",
                            interview_id: x.interview_id,
                          })
                        }
                      >
                        Hủy
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyInterview text="Chưa có lịch phỏng vấn." />
              )}
            </div>
          </>
        )}
        {view === "completed" && (
          <>
            <div className="board-title">
              <div>
                <span>COMPLETED</span>
                <h3>Đã phỏng vấn & đánh giá</h3>
              </div>
            </div>
            <div className="interview-table">
              <div className="interview-row completed-head">
                <span>Ứng viên</span>
                <span>Ngày PV</span>
                <span>Người PV</span>
                <span>Đánh giá</span>
                <span>Hành động</span>
              </div>
              {completed.length ? (
                completed.map((x: any) => (
                  <div className="interview-row" key={x.interview_id}>
                    <strong>
                      {candidateFor(x)?.full_name || x.candidate_id}
                      <small>{candidateFor(x)?.email}</small>
                    </strong>
                    <span>
                      {new Date(x.scheduled_time).toLocaleDateString("vi-VN")}
                    </span>
                    <span>{x.interviewer}</span>
                    <span>
                      {x.feedback
                        ? `★ ${x.feedback.overall_rating}/5 · ${x.feedback.result}`
                        : "Chưa nhập"}
                    </span>
                    <button
                      onClick={() => setModal({ type: "feedback", item: x })}
                    >
                      {x.feedback ? "Xem / sửa" : "Nhập đánh giá"}
                    </button>
                  </div>
                ))
              ) : (
                <EmptyInterview text="Chưa có buổi phỏng vấn hoàn tất." />
              )}
            </div>
          </>
        )}
      </section>
      {modal && (
        <div className="modal-backdrop">
          <div className="interview-modal">
            <button
              className="modal-close"
              onClick={() => {
                setModal(null);
                setSlots(null);
              }}
            >
              ×
            </button>
            {modal.type === "invite" && (
              <form onSubmit={submitInvite}>
                <span className="card-label">GỬI LỜI MỜI</span>
                <h3>Thiết lập vòng phỏng vấn</h3>
                <div className="invite-recipient">
                  <span>AI đã trích xuất từ CV</span>
                  <strong>
                    {candidateFor(modal.item)?.full_name ||
                      modal.item.candidate_id}
                  </strong>
                  <input
                    readOnly
                    aria-label="Email ứng viên"
                    value={candidateFor(modal.item)?.email || ""}
                    placeholder="CV chưa có email"
                  />
                  <small>
                    {jobFor(modal.item)?.title || modal.item.job_id} · Email này
                    được lấy tự động từ kết quả phân tích CV.
                  </small>
                </div>
                <div className="field-grid">
                  <label>
                    Người phỏng vấn
                    <select name="interviewer_id">
                      <option value="interviewer_003">Trần Thị B</option>
                      <option value="interviewer_004">Phạm Văn D</option>
                    </select>
                  </label>
                  <label>
                    Vòng
                    <select name="interview_round">
                      <option value="1">Vòng 1</option>
                      <option value="2">Vòng 2</option>
                      <option value="3">Vòng 3</option>
                    </select>
                  </label>
                  <label>
                    Thời lượng
                    <select name="duration">
                      <option value="30">30 phút</option>
                      <option value="45">45 phút</option>
                      <option value="60">60 phút</option>
                    </select>
                  </label>
                  <label>
                    Hình thức
                    <select name="interview_type">
                      <option value="online">Online · Meet</option>
                      <option value="onsite">Onsite</option>
                    </select>
                  </label>
                  <div className="wide dynamic-slots">
                    <div className="dynamic-slots-head">
                      <div>
                        <strong>Khung giờ ứng viên có thể chọn</strong>
                        <small>
                          HR tự thêm hoặc xóa; số lượng không cố định.
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftSlots((current) => [...current, ""])
                        }
                      >
                        + Thêm khung giờ
                      </button>
                    </div>
                    {draftSlots.map((slot, index) => (
                      <div className="dynamic-slot-row" key={index}>
                        <span>{index + 1}</span>
                        <input
                          required
                          name="available_slots"
                          type="datetime-local"
                          value={slot}
                          onChange={(event) =>
                            setDraftSlots((current) =>
                              current.map((value, slotIndex) =>
                                slotIndex === index
                                  ? event.target.value
                                  : value,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          className="danger"
                          disabled={draftSlots.length === 1}
                          onClick={() =>
                            setDraftSlots((current) =>
                              current.filter(
                                (_value, slotIndex) => slotIndex !== index,
                              ),
                            )
                          }
                        >
                          Xóa
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                {!slots ? (
                  <button
                    className="primary-action"
                    disabled={loading || !candidateFor(modal.item)?.email}
                  >
                    Kiểm tra lịch & gửi email
                  </button>
                ) : (
                  <div className="invite-sent">
                    <strong>✓ Email đã gửi cho ứng viên</strong>
                    <p>
                      Ứng viên sẽ chọn một trong {slots.available_slots.length}{" "}
                      khung giờ qua đường link riêng. Khi họ xác nhận, lịch sẽ
                      tự xuất hiện trong tab “Đã đặt lịch”.
                    </p>
                    <small>{slots.booking_link}</small>
                  </div>
                )}
              </form>
            )}
            {modal.type === "reschedule" && (
              <div>
                <span className="card-label">DỜI LỊCH</span>
                <h3>Chọn khung giờ mới</h3>
                <div className="slot-picker">
                  {[
                    "2026-08-02T10:00:00+07:00",
                    "2026-08-03T14:00:00+07:00",
                  ].map((x) => (
                    <button
                      key={x}
                      onClick={async () => {
                        await onAction({
                          action: "reschedule",
                          interview_id: modal.item.interview_id,
                          chosen_slot: x,
                        });
                        setModal(null);
                      }}
                    >
                      {new Date(x).toLocaleString("vi-VN")}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {modal.type === "feedback" && (
              <form onSubmit={submitFeedback}>
                <span className="card-label">ĐÁNH GIÁ SAU PHỎNG VẤN</span>
                <h3>
                  {modal.item.candidate_id} · Vòng{" "}
                  {modal.item.interview_round || 1}
                </h3>
                <div className="field-grid">
                  <label>
                    Điểm tổng (1–5)
                    <input
                      name="overall_rating"
                      type="number"
                      min="1"
                      max="5"
                      step=".5"
                      defaultValue={modal.item.feedback?.overall_rating || 4}
                    />
                  </label>
                  <label>
                    Chuyên môn
                    <input
                      name="technical_score"
                      type="number"
                      min="1"
                      max="5"
                      defaultValue={modal.item.feedback?.technical_score || 4}
                    />
                  </label>
                  <label>
                    Kỹ năng mềm
                    <input
                      name="soft_skill_score"
                      type="number"
                      min="1"
                      max="5"
                      defaultValue={modal.item.feedback?.soft_skill_score || 4}
                    />
                  </label>
                  <label>
                    Kết quả
                    <select
                      name="result"
                      defaultValue={modal.item.feedback?.result || "Đạt"}
                    >
                      <option>Đạt</option>
                      <option>Không đạt</option>
                      <option>Đạt - chuyển vòng 2</option>
                    </select>
                  </label>
                  <label className="wide">
                    Ghi chú
                    <textarea
                      name="notes"
                      defaultValue={modal.item.feedback?.notes}
                    />
                  </label>
                  <input type="hidden" name="interviewer_id" value="hr_007" />
                </div>
                <button className="primary-action">Lưu đánh giá</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function EmptyInterview({ text }: { text: string }) {
  return (
    <div className="interview-empty">
      <span>◷</span>
      <p>{text}</p>
    </div>
  );
}
function OutputPanel({
  data,
  onApprove,
}: {
  data: Record<string, unknown>;
  onApprove: () => void;
}) {
  const matching = data.matching as any;
  return (
    <section className={`output-panel tier-${matching?.tier || "default"}`}>
      <div className="output-head">
        <div>
          <span>OUTPUT JSON</span>
          <h3>{matching ? matching.recommendation : "Module hoàn tất"}</h3>
          {matching && <p className="next-action">{matching.next_action}</p>}
        </div>
        {matching && (
          <div className="big-score">
            <strong>{matching.match_score}</strong>
            <small>/100</small>
          </div>
        )}
      </div>
      {matching && (
        <div className="score-breakdown">
          {Object.entries(matching.breakdown).map(([k, v]) => (
            <div key={k}>
              <span>{k.replace("_score", "")}</span>
              <b>{String(v)}</b>
              <i style={{ width: `${v}%` }} />
            </div>
          ))}
        </div>
      )}
      <pre>{JSON.stringify(data, null, 2)}</pre>
      {matching && (
        <div className="explain">
          <strong>Vì sao có điểm này?</strong>
          <p>{matching.explanation}</p>
          {matching.tier === "high" && (
            <button onClick={onApprove}>Mở danh sách hẹn phỏng vấn →</button>
          )}
          {matching.tier === "review" && (
            <button onClick={onApprove}>HR duyệt thủ công & đặt lịch →</button>
          )}
          {matching.tier === "rejected" && (
            <span className="reject-note">
              Email từ chối lịch sự đang ở trạng thái chờ gửi — không gửi tự
              động trong bản demo.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
function Assistant({ jobs }: { jobs: any[] }) {
  const [q, setQ] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [pending, setPending] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [cvFiles, setCvFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [keySettingsOpen, setKeySettingsOpen] = useState(false);
  const [geminiKeys, setGeminiKeys] = useState("");
  const [geminiKeyCount, setGeminiKeyCount] = useState(0);
  const [keyStatus, setKeyStatus] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [sessionId, setSessionId] = useState(
    () => `hr_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  );
  const [chatSessions, setChatSessions] = useState<any[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const selectedJob =
    jobs.find((job: any) => job.job_id === selectedJobId) || jobs[0];
  useEffect(() => {
    if (!selectedJobId && jobs[0]?.job_id) setSelectedJobId(jobs[0].job_id);
  }, [jobs, selectedJobId]);
  useEffect(() => {
    fetch("/api/ai-settings")
      .then((response) => response.json())
      .then((data) => setGeminiKeyCount(Number(data.key_count || 0)))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    loadChatSessions();
  }, []);
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, busy]);
  async function loadChatSessions() {
    const response = await fetch("/api/chat-sessions", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setChatSessions(data.sessions || []);
  }
  async function persistMessage(message: any, targetSessionId = sessionId) {
    await fetch("/api/chat-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: targetSessionId, message }),
    });
    await loadChatSessions();
  }
  async function openChat(targetSessionId: string) {
    const response = await fetch(
      `/api/chat-sessions?session_id=${encodeURIComponent(targetSessionId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return;
    const data = await response.json();
    setSessionId(targetSessionId);
    setMessages(data.session?.messages || []);
    setPending(null);
    setHistoryOpen(false);
  }
  function newChat() {
    setSessionId(`hr_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    setMessages([]);
    setPending(null);
    setQ("");
    setHistoryOpen(false);
  }
  async function deleteChat(targetSessionId: string) {
    if (!window.confirm("Xóa vĩnh viễn đoạn chat này khỏi MongoDB?")) return;
    const response = await fetch(
      `/api/chat-sessions?session_id=${encodeURIComponent(targetSessionId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) return;
    if (targetSessionId === sessionId) newChat();
    await loadChatSessions();
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query || busy) return;
    if (cvFiles.length) {
      await runCvPipeline(query);
      return;
    }
    const userMessage = { role: "user", text: query };
    setMessages((current) => [...current, userMessage]);
    void persistMessage(userMessage);
    setQ("");
    setBusy(true);
    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          session_id: sessionId,
          history: messages.slice(-20).map((message) => ({
            role: message.role === "agent" ? "assistant" : "user",
            content: message.text,
          })),
        }),
      });
      const d = await r.json();
      const agentMessage = {
        role: "agent",
        text: d.answer || d.error,
        trace: d.trace || [],
      };
      setMessages((current) => [...current, agentMessage]);
      void persistMessage(agentMessage);
      setPending(d.confirmation || null);
    } finally {
      setBusy(false);
    }
  }
  async function confirmAction(confirmed: boolean) {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          confirmation_id: pending.confirmation_id,
          confirmed,
        }),
      });
      const d = await r.json();
      const agentMessage = {
        role: "agent",
        text: d.answer || d.error,
        result: d.result,
      };
      setMessages((current) => [...current, agentMessage]);
      void persistMessage(agentMessage);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }
  async function runCvPipeline(prompt: string) {
    if (!selectedJob?.job_id || !cvFiles.length || busy) return;
    setBusy(true);
    const names = cvFiles.map((file) => file.name).join(", ");
    setMessages((current) => [
      ...current,
      {
        role: "user",
        text:
          prompt ||
          `Phân tích và chấm ${cvFiles.length} CV cho ${selectedJob.title}`,
        attachments: cvFiles.map((file) => file.name),
      },
    ]);
    void persistMessage({
      role: "user",
      text: prompt || `Phân tích và chấm ${cvFiles.length} CV cho ${selectedJob.title}`,
      attachments: cvFiles.map((file) => file.name),
    });
    setQ("");
    try {
      const form = new FormData();
      form.set("job_id", selectedJob.job_id);
      form.set("session_id", sessionId);
      form.set("prompt", prompt);
      cvFiles.forEach((file) => form.append("files", file));
      const response = await fetch("/api/agent", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      setMessages((current) => [
        ...current,
        {
          role: "agent",
          text: data.answer || data.error,
          trace: data.trace || [],
          cvResults: data.results || [],
          criteria: data.criteria,
        },
      ]);
      void persistMessage({
        role: "agent",
        text: data.answer || data.error,
        trace: data.trace || [],
        cvResults: data.results || [],
        criteria: data.criteria,
      });
      if (response.ok) setCvFiles([]);
    } finally {
      setBusy(false);
    }
  }
  async function processCvs(e: FormEvent) {
    e.preventDefault();
    await runCvPipeline(
      q.trim() ||
        `Liệt kê tiêu chí và chấm ${cvFiles.length} CV cho ${selectedJob?.title || "vị trí đã chọn"}`,
    );
  }
  function addFiles(files: File[]) {
    const allowed = files.filter((file) =>
      /\.(pdf|doc|docx|jpg|jpeg|png|txt|zip)$/i.test(file.name),
    );
    setCvFiles((current) => {
      const existing = new Set(
        current.map((file) => `${file.name}-${file.size}`),
      );
      return [
        ...current,
        ...allowed.filter((file) => !existing.has(`${file.name}-${file.size}`)),
      ];
    });
  }
  async function saveGeminiKeys(e: FormEvent) {
    e.preventDefault();
    setKeySaving(true);
    setKeyStatus("");
    try {
      const response = await fetch("/api/ai-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: geminiKeys }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || data.error || "Không lưu được API key.");
      setGeminiKeyCount(Number(data.key_count || 0));
      setGeminiKeys("");
      setKeyStatus(
        `Đã lưu ${data.saved_key_count} key mới. Tổng pool hiện có ${data.key_count} key.`,
      );
    } catch (error) {
      setKeyStatus(error instanceof Error ? error.message : "Không thể lưu.");
    } finally {
      setKeySaving(false);
    }
  }
  return (
    <section
      className={`assistant-panel react-assistant ${dragActive ? "is-dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        addFiles(Array.from(event.dataTransfer.files || []));
      }}
    >
      {dragActive && (
        <div className="assistant-drop-overlay">
          <span>⇧</span>
          <strong>Thả CV vào đây</strong>
          <small>File sẽ được đính kèm vào prompt hiện tại</small>
        </div>
      )}
      <header className="assistant-hero">
        <div className="assistant-identity">
          <div className="ai-orb">✦</div>
          <div>
            <h3>RecruitFlow AI</h3>
            <p>Trợ lý điều phối toàn bộ pipeline tuyển dụng</p>
          </div>
        </div>
        <div className="assistant-chat-controls">
          <button type="button" onClick={newChat}>＋ Đoạn chat mới</button>
          <button
            type="button"
            onClick={() => setHistoryOpen((current) => !current)}
          >
            ☰ Lịch sử ({chatSessions.length})
          </button>
        </div>
        <button
          type="button"
          className="assistant-live"
          onClick={() => setKeySettingsOpen((current) => !current)}
          title="Quản lý Gemini API keys"
        >
          <i />
          <span>{geminiKeyCount} Gemini keys · Auto rotation</span>
          <b>⚙</b>
        </button>
      </header>
      {historyOpen && (
        <aside className="assistant-history">
          <header>
            <div>
              <span>LỊCH SỬ HỘI THOẠI</span>
              <strong>Các đoạn chat đã lưu trong MongoDB</strong>
            </div>
            <button type="button" onClick={() => setHistoryOpen(false)}>×</button>
          </header>
          <div>
            {!chatSessions.length && <p>Chưa có cuộc hội thoại đã lưu.</p>}
            {chatSessions.map((chat) => (
              <article
                key={chat.session_id}
                className={chat.session_id === sessionId ? "active" : ""}
              >
                <button type="button" onClick={() => openChat(chat.session_id)}>
                  <strong>{chat.title || "Cuộc hội thoại"}</strong>
                  <small>{chat.message_count || 0} tin nhắn</small>
                </button>
                <button
                  type="button"
                  className="delete-chat"
                  title="Xóa đoạn chat"
                  onClick={() => deleteChat(chat.session_id)}
                >
                  ⌫
                </button>
              </article>
            ))}
          </div>
        </aside>
      )}
      {keySettingsOpen && (
        <form className="gemini-key-manager" onSubmit={saveGeminiKeys}>
          <div>
            <span>GEMINI API KEY ROTATION</span>
            <h4>Thêm hoặc thay danh sách key</h4>
            <p>
              Mỗi dòng một API key. Key được lưu trong thư mục secrets cục bộ,
              không lưu Git và không trả lại trình duyệt.
            </p>
          </div>
          <textarea
            required
            value={geminiKeys}
            onChange={(event) => setGeminiKeys(event.target.value)}
            placeholder={"AIza...key_01\nAIza...key_02\nAIza...key_03"}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="gemini-key-actions">
            <small>
              Hiện có <b>{geminiKeyCount}</b> key · Round-robin + tự đổi khi
              quota 429
            </small>
            <button
              type="button"
              onClick={() => {
                setKeySettingsOpen(false);
                setGeminiKeys("");
                setKeyStatus("");
              }}
            >
              Đóng
            </button>
            <button className="primary-action" disabled={keySaving}>
              {keySaving ? "Đang lưu…" : "Lưu danh sách key"}
            </button>
          </div>
          {keyStatus && <div className="gemini-key-status">{keyStatus}</div>}
        </form>
      )}
      <div className="agent-pipeline">
        <button
          type="button"
          className="agent-pipeline-toggle"
          onClick={() => setUploadOpen((current) => !current)}
        >
          <span>01 · CV → AI → SCORE → MONGODB</span>
          <strong>Nạp CV vào toàn pipeline {uploadOpen ? "−" : "+"}</strong>
        </button>
        {uploadOpen && (
          <form className="agent-upload" onSubmit={processCvs}>
            <div className="agent-job-picker">
              <label>
                Vị trí áp dụng tiêu chí
                <select
                  value={selectedJob?.job_id || ""}
                  onChange={(event) => setSelectedJobId(event.target.value)}
                >
                  {jobs.map((job: any) => (
                    <option key={job.job_id} value={job.job_id}>
                      {job.title} · {job.job_id}
                    </option>
                  ))}
                </select>
              </label>
              {selectedJob && (
                <div className="agent-criteria-summary">
                  <div>
                    <span>Kỹ năng bắt buộc</span>
                    <strong>
                      {(selectedJob.must_have_skills || []).join(", ") || "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Kỹ năng ưu tiên</span>
                    <strong>
                      {(selectedJob.nice_to_have_skills || []).join(", ") ||
                        "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Kinh nghiệm</span>
                    <strong>
                      Tối thiểu {selectedJob.min_experience_years || 0} năm · Lý
                      tưởng {selectedJob.ideal_experience_years || 0} năm
                    </strong>
                  </div>
                  <div>
                    <span>Trọng số</span>
                    <strong>
                      Kỹ năng {selectedJob.weights?.skills || 0}% · Kinh nghiệm{" "}
                      {selectedJob.weights?.experience || 0}% · Học vấn{" "}
                      {selectedJob.weights?.education || 0}% · Khác{" "}
                      {selectedJob.weights?.other || 0}%
                    </strong>
                  </div>
                  <div>
                    <span>Phân loại</span>
                    <strong>
                      ≥ {selectedJob.thresholds?.high || 80}% phù hợp cao · ≥{" "}
                      {selectedJob.thresholds?.review || 60}% cần xem xét
                    </strong>
                  </div>
                </div>
              )}
            </div>
            <label className="agent-file-drop">
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.txt,.zip"
                onChange={(event) =>
                  addFiles(Array.from(event.target.files || []))
                }
              />
              <span>⇧</span>
              <strong>Kéo thả hoặc chọn nhiều CV</strong>
              <small>
                PDF, DOCX, JPG, PNG, TXT hoặc ZIP · tối đa 10 MB/file
              </small>
              {!!cvFiles.length && (
                <b>
                  Đã chọn {cvFiles.length} file:{" "}
                  {cvFiles.map((file) => file.name).join(", ")}
                </b>
              )}
            </label>
            <button
              className="primary-action"
              disabled={busy || !selectedJob || !cvFiles.length}
            >
              {busy ? "AI đang phân tích…" : "Phân tích, chấm điểm & lưu DB"}
            </button>
          </form>
        )}
      </div>
      <div className="assistant-suggestions">
        {[
          "Liệt kê 5 ứng viên điểm cao nhất cho job_001",
          "Tại sao ứng viên cand_… bị loại?",
          "Cho tôi xem các vị trí đang tuyển",
        ].map((text) => (
          <button key={text} type="button" onClick={() => setQ(text)}>
            {text}
          </button>
        ))}
      </div>
      <div className="assistant-thread" ref={threadRef}>
        {!messages.length && (
          <div className="assistant-empty">
            <strong>Bạn có thể giao việc bằng ngôn ngữ tự nhiên</strong>
            <p>
              Agent sẽ tự chọn tool, quan sát kết quả thật và dừng hỏi lại nếu
              thiếu dữ liệu.
            </p>
          </div>
        )}
        {messages.map((message, index) => (
          <article
            className={`assistant-message ${message.role}`}
            key={`${message.role}-${index}`}
          >
            <span>{message.role === "user" ? "HR" : "RecruitFlow"}</span>
            <p>{message.text}</p>
            {!!message.attachments?.length && (
              <div className="message-attachments">
                {message.attachments.map((filename: string) => (
                  <span key={filename}>▤ {filename}</span>
                ))}
              </div>
            )}
            {!!message.trace?.length && (
              <details>
                <summary>
                  Nhật ký hành động · {message.trace.length} bước
                </summary>
                <div className="agent-trace">
                  {message.trace.map((step: any) => (
                    <div key={step.step}>
                      <b>
                        {step.step}. {step.action}
                      </b>
                      <small>{step.thought}</small>
                      <code>
                        {step.observation?.requires_confirmation
                          ? "Đang chờ HR xác nhận"
                          : step.observation?.ok === false
                            ? step.observation.error
                            : "Hoàn tất"}
                      </code>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {!!message.cvResults?.length && (
              <div className="agent-cv-results">
                {message.cvResults.map((item: any) => {
                  const candidate = item.parsed_candidate;
                  const matching = item.matching;
                  return (
                    <div
                      className={`agent-cv-result tier-${matching?.tier || "error"}`}
                      key={item.filename}
                    >
                      <div>
                        <strong>{candidate?.full_name || item.filename}</strong>
                        <small>
                          {candidate?.email || item.error || "Không có email"}
                        </small>
                      </div>
                      {matching && (
                        <>
                          <b>{matching.match_score}%</b>
                          <span>{matching.recommendation}</span>
                          <small>
                            Thiếu:{" "}
                            {matching.missing_must_have?.join(", ") || "Không"}
                          </small>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {message.criteria && (
              <div className="message-criteria">
                <header>
                  <span>TIÊU CHÍ ĐÃ ÁP DỤNG</span>
                  <strong>
                    {message.criteria.title} · {message.criteria.job_id}
                  </strong>
                </header>
                <div>
                  <p>
                    <b>Bắt buộc</b>
                    {(message.criteria.must_have_skills || []).join(", ") ||
                      "Không có"}
                  </p>
                  <p>
                    <b>Ưu tiên</b>
                    {(message.criteria.nice_to_have_skills || []).join(", ") ||
                      "Không có"}
                  </p>
                  <p>
                    <b>Kinh nghiệm</b>
                    Tối thiểu {message.criteria.min_experience_years || 0} năm
                  </p>
                  <p>
                    <b>Ngưỡng</b>≥ {message.criteria.thresholds?.high || 80}%
                    phù hợp cao · ≥ {message.criteria.thresholds?.review || 60}%
                    xem xét
                  </p>
                </div>
              </div>
            )}
            {message.role === "agent" && (
              <div className="assistant-message-actions">
                <button
                  type="button"
                  title="Hữu ích"
                  aria-label="Đánh giá hữu ích"
                >
                  ♡
                </button>
                <button
                  type="button"
                  title="Chưa hữu ích"
                  aria-label="Đánh giá chưa hữu ích"
                >
                  ♢
                </button>
                <button
                  type="button"
                  title="Sao chép"
                  aria-label="Sao chép câu trả lời"
                  onClick={() => navigator.clipboard?.writeText(message.text)}
                >
                  ▣
                </button>
                <button
                  type="button"
                  title="Xem nhật ký"
                  aria-label="Xem nhật ký hành động"
                >
                  ···
                </button>
              </div>
            )}
          </article>
        ))}
        {busy && <div className="assistant-thinking">Agent đang xử lý…</div>}
      </div>
      {pending && (
        <div className="agent-confirmation">
          <div>
            <span>CẦN HR XÁC NHẬN</span>
            <strong>{pending.tool_name}</strong>
            <p>
              Hành động chưa được thực hiện. Kiểm tra thông tin rồi chọn xác
              nhận hoặc hủy.
            </p>
          </div>
          <pre>{JSON.stringify(pending.arguments, null, 2)}</pre>
          <div>
            <button type="button" onClick={() => confirmAction(false)}>
              Hủy hành động
            </button>
            <button
              type="button"
              className="primary-action"
              onClick={() => confirmAction(true)}
            >
              Xác nhận thực hiện
            </button>
          </div>
        </div>
      )}
      {!!cvFiles.length && (
        <div className="composer-attachments">
          <div>
            <span>CV ĐÃ ĐÍNH KÈM</span>
            <small>
              Agent sẽ dùng tiêu chí của{" "}
              {selectedJob?.title || "vị trí đã chọn"}
            </small>
          </div>
          {cvFiles.map((file) => (
            <button
              type="button"
              key={`${file.name}-${file.size}`}
              title="Bỏ file"
              onClick={() =>
                setCvFiles((current) =>
                  current.filter(
                    (item) =>
                      `${item.name}-${item.size}` !==
                      `${file.name}-${file.size}`,
                  ),
                )
              }
            >
              <span>▤</span>
              <strong>{file.name}</strong>
              <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
              <b>×</b>
            </button>
          ))}
        </div>
      )}
      <form className="assistant-composer" onSubmit={send}>
        <label
          className="composer-attach"
          aria-label="Đính kèm CV"
          title="Đính kèm CV"
        >
          <input
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.txt,.zip"
            onChange={(event) => {
              addFiles(Array.from(event.target.files || []));
              event.currentTarget.value = "";
            }}
          />
          +
        </label>
        <textarea
          required
          rows={1}
          value={q}
          disabled={busy || !!pending}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Hỏi RecruitFlow AI hoặc giao một nhiệm vụ…"
        />
        <div className="composer-model">
          <i />
          <span>Auto · Gemini / OpenAI</span>
          <b>⌄</b>
        </div>
        <button
          className="composer-send"
          aria-label="Gửi cho Agent"
          disabled={busy || !!pending || !q.trim()}
        >
          {busy ? "·" : "↑"}
        </button>
      </form>
      <footer>
        RecruitFlow AI có thể nhầm lẫn. HR luôn kiểm tra trước khi xác nhận hành
        động.
      </footer>
    </section>
  );
}
