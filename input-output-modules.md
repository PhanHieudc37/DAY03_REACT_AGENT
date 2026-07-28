# Input / Output chi tiết theo Module — Hệ thống Sàng lọc CV & Hẹn Phỏng vấn

## Module 1: Cấu hình tiêu chí (JD Criteria)

### INPUT (HR nhập)

| Trường | Loại dữ liệu | Ví dụ |
|---|---|---|
| Tên vị trí | text | "Backend Developer" |
| Phòng ban | select | "Engineering" |
| JD mô tả | text dài | Dán JD gốc |
| Kỹ năng bắt buộc (must-have) | tag list | ["Python", "SQL", "Docker"] |
| Kỹ năng ưu tiên (nice-to-have) | tag list | ["AWS", "Kubernetes"] |
| Số năm KN tối thiểu | number | 2 |
| Bằng cấp tối thiểu | select | "Đại học" |
| Địa điểm/hình thức | select | "Remote / Hà Nội" |
| Trọng số điểm (weights) | 4 số %, tổng = 100 | Kỹ năng 40%, KN 30%, Học vấn 15%, Khác 15% |
| Chính sách phân loại | fixed tiers | ≥80 / 60–79 / <60 |

### OUTPUT (hệ thống lưu — dùng làm "khuôn" chấm điểm)

```json
{
  "job_id": "job_001",
  "title": "Backend Developer",
  "must_have_skills": ["Python", "SQL", "Docker"],
  "nice_to_have_skills": ["AWS", "Kubernetes"],
  "min_experience_years": 2,
  "min_education": "Bachelor",
  "weights": {
    "skills": 0.4,
    "experience": 0.3,
    "education": 0.15,
    "other": 0.15
  }
}
```

---

## Module 2: Xử lý CV ứng viên

### INPUT

- File CV gốc (PDF/DOCX/ảnh) — **bắt buộc**
- `job_id` — CV này ứng tuyển vị trí nào (để biết dùng khuôn tiêu chí nào)
- (Tùy chọn) Thông tin bổ sung nếu có form ứng tuyển: cover letter, mức lương mong muốn, ngày có thể bắt đầu

### OUTPUT — chia làm 2 bước

**Bước A — Sau khi Parse (trích xuất thô từ CV):**

```json
{
  "full_name": "Nguyễn Văn A",
  "email": "a.nguyen@email.com",
  "phone": "0987xxxxxx",
  "skills": ["Python", "Django", "PostgreSQL", "Git"],
  "experience_years": 3,
  "work_history": [
    {"company": "ABC Corp", "role": "Backend Dev", "duration": "2022-2024"}
  ],
  "education": [
    {"degree": "Đại học", "school": "ĐH Bách Khoa", "major": "CNTT"}
  ]
}
```

**Bước B — Sau khi Chấm điểm/Matching (so với Job Criteria):**

```json
{
  "candidate_id": "cand_123",
  "job_id": "job_001",
  "match_score": 82,
  "breakdown": {
    "skills_score": 85,
    "experience_score": 90,
    "education_score": 70,
    "other_score": 60
  },
  "missing_must_have": [],
  "matched_nice_to_have": ["AWS"],
  "tier": "high",
  "recommendation": "Phù hợp cao",
  "next_action": "Đưa vào danh sách hẹn phỏng vấn",
  "stage": "interview_ready",
  "email_status": "not_required",
  "explanation": "Đáp ứng đủ kỹ năng bắt buộc, 3 năm KN vượt yêu cầu tối thiểu (2 năm)"
}
```

> Trường `explanation` rất quan trọng — giúp HR hiểu **vì sao** AI chấm điểm như vậy, tránh cảm giác "hộp đen".

---

## Module 3: Lịch phỏng vấn

### INPUT

- `application_id` (ứng viên nào, vị trí nào)
- Danh sách người phỏng vấn + khung giờ rảnh (lấy từ Calendar API)
- Thời lượng phỏng vấn (VD: 45 phút)

### OUTPUT

```json
{
  "interview_id": "int_001",
  "scheduled_time": "2026-08-01T14:00:00+07:00",
  "interviewer": "Trần Thị B",
  "meeting_link": "https://meet.google.com/xyz",
  "calendar_event_id": "cal_evt_789",
  "status": "confirmed"
}
```

---

## Tóm tắt luồng Input → Output tổng thể

```
[JD Criteria] + [CV file]
        ↓
   Parse CV → [Candidate JSON]
        ↓
   So khớp với Criteria → [Score + Explanation]
        ↓
   HR duyệt → [Application status = approved]
        ↓
   Chọn slot lịch → [Interview JSON]
```
