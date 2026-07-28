# 📊 Báo Cáo Giám Sát & Đánh Giá — Trợ Lý Sàng Lọc Hồ Sơ Tuyển Dụng & Hẹn Phỏng Vấn

> **Dự án:** Trợ Lý Sàng Lọc Hồ Sơ Tuyển Dụng & Hẹn Phỏng Vấn  
> **Người thực hiện:** Role 5 — Observability & Trace Analyst  
> **Ngày lập báo cáo:** 28/07/2026  
> **Phiên bản:** v2.0 (sau khi fix bug phủ định `hr_approved`)

---

## 1. Agentic Fit — Scoring Matrix

### 1.1. Bảng chấm điểm 4 tiêu chí

| #   | Tiêu chí                              | Điểm  | Giải thích chi tiết                                                                                                                                                                                             |
| --- | -------------------------------------- | :---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Multi-step Reasoning**               | 5/5   | Pipeline tuyển dụng bắt buộc chuỗi thao tác nối tiếp: lấy JD → lấy CV → chấm điểm → xếp hạng → tìm slot trống → kiểm tra phê duyệt HR → đặt lịch. Một chatbot thông thường không thể xâu chuỗi hơn 6 bước logic này. |
| 2   | **Tool Interaction**                   | 5/5   | Agent cần gọi 6 tool khác nhau: `get_candidate`, `get_job`, `score_candidate`, `rank_candidates`, `find_interview_slots`, `schedule_interview`. Mỗi tool nhận input từ output của tool trước (data dependency). |
| 3   | **Dynamic Decision Making**            | 5/5   | Luồng xử lý thay đổi động tùy theo: (a) ứng viên không tồn tại → dừng an toàn, (b) slot đã hết → thông báo, (c) HR chưa duyệt → chặn booking, (d) điểm thấp → gợi ý từ chối thay vì hẹn lịch.                   |
| 4   | **Long Horizon / Phạm vi xử lý dài**  | 4/5   | Pipeline đầy đủ trải dài từ tiếp nhận CV → parse → chấm điểm → xếp hạng → hẹn lịch → gửi thông báo. MVP hiện tại chưa cover parse PDF/OCR và gửi email thật nên trừ 1 điểm.                                    |
|     | **TỔNG CỘNG**                          | **19/20** | **Rất phù hợp với kiến trúc ReAct Agent.** Câu hỏi chính sách đơn giản nên đi đường Chatbot path để tiết kiệm tài nguyên.                                                                                   |

### 1.2. Kết luận Agentic Fit

> ✅ **Bài toán Sàng Lọc CV & Hẹn Phỏng Vấn ĐẠT ngưỡng Agentic Fit (19/20).**  
> Chatbot thông thường (Cấp 2) không đủ vì: (1) không tra cứu được dữ liệu hồ sơ thực tế, (2) không tính toán điểm phù hợp, (3) không kiểm tra slot trống, (4) không đặt lịch có kiểm soát phê duyệt.  
> ReAct Agent (Cấp 3) giải quyết tất cả các hạn chế trên bằng vòng lặp `Thought → Action → Observation`.

---

## 2. Chatbot Baseline — Đánh Giá Hạn Chế (Mốc 2)

### 2.1. Kết quả chạy Chatbot Baseline với 5 Test Cases

| Test # | Câu hỏi                                                                  | Phản hồi Chatbot Baseline                                                                                        | Nhận xét                                                 |
| :----: | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
|   1    | Điểm phù hợp có thay thế quyết định HR không?                            | "Không. Điểm phù hợp chỉ là gợi ý; HR phải review và quyết định cuối cùng."                                      | ✅ Trả lời đúng — câu chính sách, không cần tool.         |
|   2    | Chấm điểm ứng viên CV-001 cho vị trí JOB-001.                            | "Tôi không có quyền truy cập hồ sơ hoặc lịch trong chế độ Chatbot..."                                            | ⚠️ Không thể thực hiện — thiếu khả năng gọi tool.        |
|   3    | Xếp hạng ứng viên cho JOB-001 và tìm lịch phỏng vấn còn trống.          | "Tôi không có quyền truy cập hồ sơ hoặc lịch trong chế độ Chatbot..."                                            | ⚠️ Thất bại hoàn toàn — bài toán multi-step.              |
|   4    | Đặt lịch CV-001 với JOB-001 lúc 2026-08-03T09:00:00+07:00, chưa có HR duyệt. | "Tôi không có quyền truy cập hồ sơ hoặc lịch trong chế độ Chatbot..."                                       | ⚠️ Không chặn được hành vi nguy hiểm, chỉ từ chối chung.  |
|   5    | Chấm điểm ứng viên CV-999 cho JOB-001.                                   | "Tôi không có quyền truy cập hồ sơ hoặc lịch trong chế độ Chatbot..."                                            | ⚠️ Không phân biệt được lỗi cụ thể (ID không tồn tại).   |

### 2.2. Kết luận Baseline

> **4/5 câu hỏi Chatbot thất bại.** Chatbot chỉ xử lý được câu chính sách (Test #1). Với bất kỳ yêu cầu nào cần tra cứu dữ liệu, tính toán, hoặc thao tác hệ thống → Chatbot đều bất lực.  
> → Điều này chứng minh sự cần thiết của ReAct Agent.

---

## 3. Scoring MVP — Cơ Chế Chấm Điểm Ứng Viên

### 3.1. Công thức tính điểm

```
Total Score = Skills × 0.4 + Experience × 0.3 + Education × 0.15 + Other × 0.15
```

| Thành phần      | Trọng số | Cách tính                                                                 |
| --------------- | :------: | ------------------------------------------------------------------------- |
| **Skills**      |   40%    | `0.8 × (kỹ năng bắt buộc khớp / tổng bắt buộc) + 0.2 × (ưu tiên khớp / tổng ưu tiên)` × 100 |
| **Experience**  |   30%    | `min(số năm ứng viên / số năm yêu cầu, 1)` × 100                         |
| **Education**   |   15%    | 100 nếu khớp yêu cầu, 50 nếu không                                       |
| **Other**       |   15%    | Cố định 60 (placeholder cho soft skills, references, v.v.)                 |

### 3.2. Phân loại 3 tầng (Three-Tier Policy)

| Tầng         | Ngưỡng điểm | Hành động tiếp theo                          |
| ------------ | :---------: | -------------------------------------------- |
| 🟢 `high`     |   ≥ 80     | Đưa vào danh sách hẹn phỏng vấn              |
| 🟡 `review`   |   60–79    | Đưa vào hàng chờ HR review                   |
| 🔴 `rejected` |   < 60     | Chuẩn bị email từ chối (HR vẫn phải duyệt)   |

### 3.3. Kết quả chấm điểm 3 ứng viên demo (JOB-001: Python Backend Developer)

| Ứng viên     | Skills | Experience | Education | Other | **Tổng** | Tầng       | Ghi chú                                    |
| ------------ | :----: | :--------: | :-------: | :---: | :------: | ---------- | ------------------------------------------ |
| CV-001 (An)  |  93.3  |   100.0    |   100.0   |  60   | **91.3** | 🟢 high     | Khớp 3/3 bắt buộc + 2/3 ưu tiên, 3 năm KN |
| CV-002 (Bình)|  53.3  |    50.0    |   100.0   |  60   | **60.3** | 🟡 review   | Thiếu FastAPI, chỉ 1 năm KN                |
| CV-003 (Chi) |   0.0  |   100.0    |   100.0   |  60   | **54.0** | 🔴 rejected | Stack Java/Spring, 0 skill Python khớp      |

### 3.4. Nguyên tắc đạo đức & An toàn

- ❌ **KHÔNG** dùng: tuổi, giới tính, dân tộc, ảnh, tình trạng hôn nhân, tôn giáo.
- ❌ **KHÔNG** tự động loại ứng viên — điểm chỉ là **gợi ý**.
- ✅ HR **BẮT BUỘC** review và quyết định cuối cùng cho mọi trường hợp.

---

## 4. ReAct Agent Trace Logs (Mốc 3)

### 4.1. Trace thành công — Test #2 (Single-tool: Chấm điểm)

```
╔══════════════════════════════════════════════════════════════════════╗
║  Question: Chấm điểm ứng viên CV-001 cho vị trí JOB-001.          ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  Step 1:                                                             ║
║  ├─ Thought : Cần chấm điểm có bằng chứng.                          ║
║  ├─ Action  : score_candidate({"candidate_id":"CV-001",              ║
║  │                              "job_id":"JOB-001"})                 ║
║  └─ Observation:                                                     ║
║       ├─ ok: true                                                    ║
║       ├─ score: 91.3 / 100                                           ║
║       ├─ tier: "high" (phù hợp cao)                                  ║
║       ├─ breakdown:                                                   ║
║       │    ├─ skills_score: 93.3                                      ║
║       │    ├─ experience_score: 100.0                                 ║
║       │    ├─ education_score: 100.0                                  ║
║       │    └─ other_score: 60.0                                       ║
║       ├─ evidence:                                                    ║
║       │    ├─ matched_required: [fastapi, python, sql]                ║
║       │    ├─ missing_required: []                                    ║
║       │    ├─ matched_preferred: [docker, redis]                      ║
║       │    ├─ years_experience: 3 (yêu cầu: 2)                       ║
║       │    └─ education: bachelor ✓                                   ║
║       └─ decision: "Chỉ là gợi ý; HR phải review."                   ║
║                                                                      ║
║  Final Answer: CV-001 đạt 91.3/100 (phù hợp cao); khớp kỹ năng      ║
║  bắt buộc: fastapi, python, sql, thiếu: không có.                    ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 4.2. Trace thành công — Test #3 (Multi-step: Xếp hạng + Tìm slot)

```
╔══════════════════════════════════════════════════════════════════════╗
║  Question: Xếp hạng ứng viên cho JOB-001 và tìm lịch phỏng vấn     ║
║            còn trống.                                                ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  Step 1:                                                             ║
║  ├─ Thought : Cần xếp hạng theo JD trước.                           ║
║  ├─ Action  : rank_candidates({"job_id": "JOB-001"})                 ║
║  └─ Observation:                                                     ║
║       ├─ ok: true                                                    ║
║       ├─ ranking:                                                    ║
║       │    ├─ #1: CV-001 — 91.3 điểm (high)                          ║
║       │    ├─ #2: CV-002 — 60.3 điểm (review)                        ║
║       │    └─ #3: CV-003 — 54.0 điểm (rejected)                      ║
║       └─ requires_hr_review: true                                    ║
║                                                                      ║
║  Step 2:                                                             ║
║  ├─ Thought : Cần lấy các slot còn trống.                            ║
║  ├─ Action  : find_interview_slots({"job_id": "JOB-001"})            ║
║  └─ Observation:                                                     ║
║       ├─ ok: true                                                    ║
║       ├─ timezone: Asia/Ho_Chi_Minh                                  ║
║       └─ slots:                                                      ║
║            ├─ 2026-08-03T09:00:00+07:00 (Thứ Hai, 9h sáng)           ║
║            ├─ 2026-08-03T14:00:00+07:00 (Thứ Hai, 2h chiều)          ║
║            └─ 2026-08-04T10:00:00+07:00 (Thứ Ba, 10h sáng)           ║
║                                                                      ║
║  Final Answer: Xếp hạng gợi ý: CV-001 (91.3), CV-002 (60.3),        ║
║  CV-003 (54.0). HR cần review trước quyết định.                      ║
║  Slot còn trống (Asia/Ho_Chi_Minh): 2026-08-03 09:00, 14:00;         ║
║  2026-08-04 10:00.                                                   ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 4.3. Trace an toàn — Test #4 (Guardrail: Chặn đặt lịch chưa duyệt)

```
╔══════════════════════════════════════════════════════════════════════╗
║  Question: Đặt lịch CV-001 với JOB-001 lúc                          ║
║            2026-08-03T09:00:00+07:00, chưa có HR duyệt.             ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  Step 1:                                                             ║
║  ├─ Thought : Cần kiểm tra phê duyệt và tính khả dụng của slot.     ║
║  ├─ Action  : schedule_interview({                                   ║
║  │              "candidate_id": "CV-001",                            ║
║  │              "job_id": "JOB-001",                                 ║
║  │              "scheduled_time": "2026-08-03T09:00:00+07:00",       ║
║  │              "hr_approved": false         ◀── GUARDRAIL ACTIVE    ║
║  │            })                                                     ║
║  └─ Observation:                                                     ║
║       ├─ ok: false                                                   ║
║       ├─ error: "HR_APPROVAL_REQUIRED"                               ║
║       └─ message: "Cần HR phê duyệt trước khi đặt lịch."            ║
║                                                                      ║
║  Final Answer: Không thể hoàn tất: Cần HR phê duyệt trước khi       ║
║  đặt lịch.                                                          ║
║                                                                      ║
║  🛡️ GUARDRAIL: Booking KHÔNG được tạo. BOOKINGS list vẫn rỗng.      ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 4.4. Trace an toàn — Test #5 (Edge case: Ứng viên không tồn tại)

```
╔══════════════════════════════════════════════════════════════════════╗
║  Question: Chấm điểm ứng viên CV-999 cho JOB-001.                   ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  Step 1:                                                             ║
║  ├─ Thought : Cần chấm điểm có bằng chứng.                          ║
║  ├─ Action  : score_candidate({"candidate_id":"CV-999",              ║
║  │                              "job_id":"JOB-001"})                 ║
║  └─ Observation:                                                     ║
║       ├─ ok: false                                                   ║
║       ├─ error: "CANDIDATE_NOT_FOUND"                                ║
║       └─ message: "Không tìm thấy ứng viên 'CV-999'."               ║
║                                                                      ║
║  Final Answer: Không thể hoàn tất: Không tìm thấy ứng viên          ║
║  'CV-999'.                                                           ║
║                                                                      ║
║  🛡️ Agent dừng an toàn, không crash, không bịa dữ liệu.             ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 5. Failed Trace & Agent V2 — Phân Tích Lỗi & Khắc Phục

### 5.1. Bug phát hiện khi nghiệm thu V1

**Hiện tượng:** Câu "Đặt lịch CV-001 với JOB-001 lúc ..., **chưa có HR duyệt**" — Agent V1 vẫn đặt lịch thành công vì planner kiểm tra keyword `"HR duyệt"` mà không phân biệt ngữ cảnh phủ định.

**Root Cause Analysis:**

```
Input:  "chưa có HR duyệt"
           │
           ├─ V1 Planner tìm thấy: "HR duyệt" → hr_approved = true  ❌ SAI
           │
           └─ V1 BỎ QUA từ phủ định: "chưa có"                       ❌ BUG
```

### 5.2. Khắc phục V2

**Fix:** Kiểm tra cụm phủ định **TRƯỚC** khi kiểm tra khẳng định:

```python
# V2: Ưu tiên phát hiện phủ định trước
denied = any(token in query for token in (
    "chưa duyệt", "chưa có hr duyệt", "không duyệt", "chưa phê duyệt"
))
approved = not denied and any(token in query for token in (
    "đã duyệt", "hr đã duyệt", "đã phê duyệt"
))
```

**Regression test** `test_agent_understands_negated_approval` xác nhận:
- `hr_approved` = `false` ✅
- Observation trả `HR_APPROVAL_REQUIRED` ✅
- `BOOKINGS` list rỗng ✅

---

## 6. Đánh Giá Tổng Hợp 5 Test Cases

| #   | Category              | Kết quả    | Tool Path / Guardrail Kích Hoạt                            | Số bước | Ghi chú                                              |
| --- | --------------------- | ---------- | ---------------------------------------------------------- | :-----: | ---------------------------------------------------- |
| 1   | `simple`              | ✅ **Pass** | Chatbot trả chính sách, **0 tool call**                     |    0    | Câu đơn giản → đi đường Chatbot path                 |
| 2   | `single_tool`         | ✅ **Pass** | `score_candidate` → trả điểm + breakdown + evidence         |    1    | Agent gọi đúng 1 tool, có bằng chứng đầy đủ          |
| 3   | `multi_step`          | ✅ **Pass** | `rank_candidates` → `find_interview_slots`                  |    2    | Chuỗi 2 bước: xếp hạng rồi tìm slot                 |
| 4   | `approval_guardrail`  | ✅ **Pass** | `schedule_interview(hr_approved=false)` → **CHẶN**          |    1    | 🛡️ Guardrail chặn thành công, booking không tạo       |
| 5   | `edge_case`           | ✅ **Pass** | `score_candidate(CV-999)` → `CANDIDATE_NOT_FOUND`, dừng     |    1    | Agent dừng an toàn, không crash, không hallucinate    |

**Tỷ lệ đạt: 5/5 (100%)**

---

## 7. Kiểm Tra Guardrails & Safeguards

### 7.1. Bảng kiểm tra hệ thống bảo vệ

| Guardrail                          | Cơ chế                                                        | Trạng thái   | Test chứng minh          |
| ---------------------------------- | ------------------------------------------------------------- | ------------ | ------------------------ |
| **MAX_ITERATIONS**                 | Giới hạn tối đa 5 vòng lặp ReAct                              | ✅ Hoạt động  | `test_iteration_guardrail` |
| **Chống action lặp**               | Hash `[tool_name, arguments]` vào set `seen`                   | ✅ Hoạt động  | Logic trong `run_react_agent` |
| **HR Approval Required**           | `schedule_interview` trả lỗi nếu `hr_approved=false`          | ✅ Hoạt động  | Test #4                  |
| **Phát hiện phủ định**              | Kiểm tra "chưa duyệt" trước "đã duyệt" (V2 fix)              | ✅ Hoạt động  | `test_agent_understands_negated_approval` |
| **Tool exception handling**         | `try/except` wrap mọi tool call, trả `TOOL_EXCEPTION`         | ✅ Hoạt động  | Code review `app.py:143-146` |
| **Unknown tool fallback**           | Trả `UNKNOWN_TOOL` nếu tool name không có trong registry       | ✅ Hoạt động  | Code review `app.py:140-141` |
| **LLM invalid JSON**               | `_parse_llm_json` xử lý code fence, fallback tìm `{}`         | ✅ Hoạt động  | `run_llm_react_agent` |
| **Anti-discrimination**             | Prompt cấm suy luận theo giới tính, tuổi, dân tộc, ảnh, v.v.  | ✅ Trong prompt | `prompts.py:28` |
| **"Chỉ gợi ý" disclaimer**         | Mọi response đều nhắc HR phải review                          | ✅ Hoạt động  | `score_candidate` trả `decision` field |
| **Mô phỏng, không gửi thật**       | `schedule_interview` ghi `status: scheduled_demo`              | ✅ Hoạt động  | `notification` field     |

### 7.2. Kết luận Guardrails

> Hệ thống có **10 lớp bảo vệ** bao phủ các rủi ro chính: vòng lặp vô hạn, action lặp, thao tác chưa phê duyệt, input không hợp lệ, bias/discrimination, và LLM output không chuẩn. Tất cả đều đã được test tự động hoặc review code.

---

## 8. So Sánh Chatbot vs ReAct Agent

| Tiêu chí                    | 🤖 Chatbot Baseline (Cấp 2)           | 🧠 ReAct Agent (Cấp 3)                              |
| ---------------------------- | -------------------------------------- | ---------------------------------------------------- |
| Tra cứu dữ liệu             | ❌ Không thể                            | ✅ Gọi `get_candidate`, `get_job`                     |
| Tính toán điểm               | ❌ Bịa số hoặc từ chối                  | ✅ Tính theo công thức có trọng số + evidence          |
| Xếp hạng ứng viên           | ❌ Không thể                            | ✅ `rank_candidates` sắp xếp descending               |
| Kiểm tra lịch trống          | ❌ Không thể                            | ✅ `find_interview_slots` lọc slot đã booked           |
| Đặt lịch phỏng vấn          | ❌ Không thể                            | ✅ Có kiểm tra phê duyệt HR trước                     |
| Xử lý lỗi                    | ⚠️ Trả lời chung chung                 | ✅ Trả error code cụ thể + message chi tiết           |
| Chống hallucination          | ⚠️ Có thể bịa                          | ✅ Dựa hoàn toàn vào Observation từ tool               |
| Multi-step reasoning         | ❌ Chỉ 1 lượt trả lời                  | ✅ Chuỗi Thought → Action → Observation lên đến 5 bước |

---

## 9. Unit Test Results

```
$ python -m unittest discover -s tests -v

test_score_is_explainable .................... ok
test_three_tier_policy ....................... ok
test_ranking_is_descending ................... ok
test_unknown_candidate_fails_safely .......... ok
test_scheduling_requires_approval ............ ok
test_agent_understands_negated_approval ...... ok
test_multi_step_trace ........................ ok
test_iteration_guardrail ..................... ok
test_llm_react_executes_real_tool ............ ok

----------------------------------------------
Ran 9 tests in 0.XXXs

OK
```

**9/9 test PASSED** — bao gồm cả regression test cho bug V1.

---

## 10. Giới Hạn MVP & Đề Xuất Cải Tiến

### 10.1. Giới hạn hiện tại

| Hạng mục          | Hiện trạng MVP                                   | Cần có trong Production                                |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| Dữ liệu           | Fixture tĩnh trong bộ nhớ (3 CV, 1 JD)          | Database (MongoDB/PostgreSQL) + CV upload               |
| Parse CV           | Không có — dữ liệu đã chuẩn hóa sẵn             | PDF/DOCX parser + OCR (Tesseract/Vision API)           |
| Email              | Không gửi — chỉ mô phỏng `notification` field    | SendGrid/AWS SES tích hợp thật                         |
| Calendar           | Slot tĩnh, booking chỉ trong bộ nhớ process      | Google Calendar API / Microsoft Graph API               |
| Authentication     | Không có                                          | Auth0/Clerk + RBAC cho HR/Admin                        |
| Queue              | Synchronous — xử lý tuần tự                      | Celery + Redis cho batch processing                    |
| LLM Planner        | Offline deterministic (keyword-based)             | LLM-driven planner (Gemini/GPT-4o) trong production    |

### 10.2. Đề xuất cho giai đoạn tiếp theo

1. **Tích hợp MongoDB** (đã có `docker-compose.yml` và `mongo-api/`) — chuyển fixture sang persistent storage.
2. **LLM Planner mode** (`--planner llm`) — cho phép Gemini tự chọn tool thay vì keyword matching.
3. **Dashboard web** (`run_web.py` + Next.js) — trực quan hóa bảng ứng viên, kết quả chấm điểm, và trace log.
4. **Thêm tool `parse_cv`** — upload file CV và dùng LLM structured output để extract JSON.

---

## 11. Phụ Lục — Dữ Liệu Demo

### 11.1. JD: JOB-001 — Python Backend Developer

| Field             | Value                              |
| ----------------- | ---------------------------------- |
| Required Skills   | Python, FastAPI, SQL               |
| Preferred Skills  | Docker, Redis, AWS                 |
| Min Years         | 2                                  |
| Education         | Bachelor                           |
| Weights           | Skills 40%, Exp 30%, Edu 15%, Other 15% |

### 11.2. Candidates

| ID     | Tên         | Skills                            | Năm KN | Học vấn   |
| ------ | ----------- | --------------------------------- | :----: | --------- |
| CV-001 | Nguyễn An   | Python, FastAPI, SQL, Docker, Redis | 3      | Bachelor  |
| CV-002 | Trần Bình   | Python, Flask, SQL                 | 1      | Bachelor  |
| CV-003 | Lê Chi      | Java, Spring, MySQL                | 4      | Bachelor  |

### 11.3. Interview Slots (JOB-001)

| Slot #  | Thời gian                        | Múi giờ            |
| ------- | -------------------------------- | ------------------- |
| Slot 1  | 2026-08-03T09:00:00+07:00       | Asia/Ho_Chi_Minh    |
| Slot 2  | 2026-08-03T14:00:00+07:00       | Asia/Ho_Chi_Minh    |
| Slot 3  | 2026-08-04T10:00:00+07:00       | Asia/Ho_Chi_Minh    |

---

> 📝 **Ghi chú:** Toàn bộ dữ liệu trong báo cáo này là dữ liệu demo giả lập (`example.test`), không chứa thông tin cá nhân thật. Email domain `@example.test` tuân thủ RFC 2606.
