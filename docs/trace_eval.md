# Báo cáo giám sát — Trợ lý sàng lọc CV

## 1. Agentic Fit

| Tiêu chí             |   Điểm    | Lý do                                                                        |
| -------------------- | :-------: | ---------------------------------------------------------------------------- |
| Multi-step Reasoning |    5/5    | Phải lấy JD, chấm điểm, xếp hạng rồi tìm slot.                               |
| Tool Interaction     |    5/5    | Cần đọc hồ sơ/JD/lịch và thực hiện booking có kiểm soát.                     |
| Dynamic Decision     |    5/5    | Lỗi hồ sơ, slot bận và trạng thái phê duyệt làm đổi nhánh xử lý.             |
| Long Horizon         |    4/5    | Pipeline từ tiếp nhận CV đến lịch phỏng vấn gồm nhiều trạng thái.            |
| **Tổng**             | **19/20** | **Rất phù hợp với ReAct Agent; câu hỏi chính sách vẫn nên đi Chatbot path.** |

## 2. Scoring MVP

- Kỹ năng: 50% (80% cho kỹ năng bắt buộc, 20% cho kỹ năng ưu tiên).
- Kinh nghiệm: 30%, đạt tối đa khi đủ số năm yêu cầu.
- Học vấn: 20%.
- Không dùng tuổi, giới tính, ảnh, dân tộc, tình trạng hôn nhân hay thuộc tính nhạy cảm.
- Điểm và thứ hạng chỉ là gợi ý. HR review và quyết định cuối cùng.

## 3. Trace thành công — Test #3

```text
Question: Xếp hạng ứng viên cho JOB-001 và tìm lịch phỏng vấn còn trống.

Thought: Cần xếp hạng theo JD trước.
Action: rank_candidates({"job_id": "JOB-001"})
Observation: CV-001=96.7, CV-002=61.7, CV-003=50.0; requires_hr_review=true

Thought: Cần lấy các slot còn trống.
Action: find_interview_slots({"job_id": "JOB-001"})
Observation: 2026-08-03 09:00, 14:00; 2026-08-04 10:00 (Asia/Ho_Chi_Minh)

Final Answer: Xếp hạng gợi ý kèm các slot; HR cần review trước quyết định.
```

## 4. Failed trace và Agent V2

**Lỗi phát hiện khi nghiệm thu:** câu “chưa có HR duyệt” chứa chuỗi “HR duyệt”, khiến
planner V1 hiểu nhầm là đã phê duyệt.

**Nguyên nhân gốc:** kiểm tra keyword khẳng định mà không ưu tiên ngữ cảnh phủ định.

**Khắc phục V2:** nhận diện các cụm phủ định trước; chỉ đặt `hr_approved=true` với cụm
khẳng định rõ như “HR đã duyệt” hoặc “đã phê duyệt”. Regression test
`test_agent_understands_negated_approval` xác nhận booking không được tạo.

Trace an toàn:

```text
Action: schedule_interview(..., "hr_approved": false)
Observation: {"ok": false, "error": "HR_APPROVAL_REQUIRED"}
Final Answer: Không thể hoàn tất: Cần HR phê duyệt trước khi đặt lịch.
```

## 5. Đánh giá 5 test cases

| #   | Kết quả | Tool path / Guardrail                      |
| --- | ------- | ------------------------------------------ |
| 1   | Pass    | Chatbot trả chính sách, 0 tool call        |
| 2   | Pass    | `score_candidate`, có evidence             |
| 3   | Pass    | `rank_candidates` → `find_interview_slots` |
| 4   | Pass    | Chặn booking vì thiếu phê duyệt            |
| 5   | Pass    | `CANDIDATE_NOT_FOUND`, dừng an toàn        |

## 6. Giới hạn MVP

Dữ liệu hiện là fixture trong bộ nhớ; chưa parse PDF/DOCX/OCR, chưa có database, auth,
queue, email hay Calendar API. `schedule_interview` chỉ mô phỏng trong tiến trình để demo
guardrail, không tạo tác động ngoài hệ thống.
