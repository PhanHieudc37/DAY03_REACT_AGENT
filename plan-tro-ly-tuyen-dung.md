# Plan Build: Trợ lý Sàng lọc CV & Hẹn Phỏng vấn Tự động

## 1. Mục tiêu & Phạm vi

**Bài toán cần giải:**
- Nhận CV (PDF/DOCX/ảnh scan) từ nhiều nguồn (email, form web, LinkedIn, các trang tuyển dụng)
- Trích xuất thông tin ứng viên tự động
- So khớp (match) với JD (Job Description) và chấm điểm phù hợp
- Xếp hạng ứng viên, lọc bỏ hồ sơ không đạt yêu cầu tối thiểu
- Tự động gửi email/thông báo cho ứng viên đạt để đặt lịch phỏng vấn
- Đồng bộ lịch của HR/người phỏng vấn (Google Calendar/Outlook), tránh trùng giờ
- Gửi nhắc lịch, xử lý dời lịch

**Phạm vi MVP** (nên làm trước để có sản phẩm chạy được sớm):
- 1 nguồn nhận CV (ví dụ: form upload trên web hoặc email)
- Parse CV + chấm điểm cơ bản theo từ khóa/kỹ năng
- Dashboard xem danh sách ứng viên đã xếp hạng
- Gửi email mời phỏng vấn với link chọn slot (kiểu Calendly)

---

## 2. Kiến trúc tổng thể

```
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│  Nguồn CV   │───▶│  Ingestion   │───▶│  Storage (DB +   │
│ (Email/Form/│    │  Service     │    │  File storage)   │
│  API tuyển  │    └──────────────┘    └─────────┬────────┘
│  dụng)      │                                   │
└─────────────┘                                   ▼
                                        ┌──────────────────┐
                                        │  Parsing Service  │
                                        │  (OCR + NLP/LLM)  │
                                        └─────────┬────────┘
                                                   ▼
                                        ┌──────────────────┐
                                        │  Matching &      │
                                        │  Scoring Engine  │
                                        │  (LLM + rules)   │
                                        └─────────┬────────┘
                                                   ▼
                                        ┌──────────────────┐
                                        │  Dashboard HR    │
                                        │  (review/approve)│
                                        └─────────┬────────┘
                                                   ▼
                                        ┌──────────────────┐
                                        │  Scheduling      │
                                        │  Service         │
                                        │  (Calendar API + │
                                        │   Email/SMS)     │
                                        └──────────────────┘
```

---

## 3. Luồng xử lý chi tiết (Pipeline)

1. **Ingestion**: Nhận file CV → lưu file gốc vào storage (S3/GCS) → tạo record trong DB với status `pending`
2. **Parsing**:
   - Nếu là PDF/DOCX text-based: dùng thư viện parse trực tiếp (pdfplumber, python-docx)
   - Nếu là ảnh scan: OCR trước (Tesseract hoặc Google Vision API)
   - Dùng LLM (Claude API) để trích xuất có cấu trúc: họ tên, email, SĐT, kinh nghiệm, kỹ năng, học vấn, số năm kinh nghiệm... → xuất ra JSON theo schema cố định
3. **Matching & Scoring**:
   - So khớp JSON ứng viên với JD (cũng được LLM chuẩn hóa thành JSON: yêu cầu kỹ năng, số năm KN, học vấn...)
   - Chấm điểm theo trọng số (VD: kỹ năng cứng 40%, kinh nghiệm 30%, học vấn 15%, khác 15%)
   - Gắn nhãn: `Phù hợp cao / Trung bình / Không phù hợp`
4. **Review của HR**: Dashboard hiển thị danh sách xếp hạng, HR có thể sửa điểm, duyệt hoặc từ chối
5. **Scheduling**:
   - Khi HR duyệt ứng viên → hệ thống gửi email có link chọn slot phỏng vấn (tự tạo hoặc dùng Cal.com/Calendly nhúng)
   - Ứng viên chọn giờ → tự động tạo event trên Google Calendar/Outlook của người phỏng vấn, gửi invite kèm Google Meet/Zoom link
   - Gửi email/SMS nhắc trước 24h và 1h

---

## 4. Tech Stack đề xuất

| Thành phần | Lựa chọn gợi ý |
|---|---|
| Backend | Python (FastAPI) hoặc Node.js (NestJS) |
| Database | PostgreSQL (dữ liệu có cấu trúc) |
| File storage | AWS S3 / Google Cloud Storage |
| Parse CV | pdfplumber, python-docx, Tesseract OCR |
| Trích xuất & chấm điểm | Claude API (structured output dạng JSON) |
| Queue xử lý bất đồng bộ | Celery + Redis, hoặc AWS SQS |
| Lịch | Google Calendar API / Microsoft Graph API |
| Email | SendGrid / AWS SES |
| Frontend Dashboard | React (Next.js) |
| Xác thực | Auth0 hoặc Clerk |

---

## 5. Data Model (rút gọn)

```
Candidate
 - id, full_name, email, phone, cv_file_url
 - parsed_data (JSON: skills, experience, education...)
 - source, status (pending/reviewed/interview_scheduled/rejected)

Job
 - id, title, jd_text, requirements (JSON), department

Application
 - id, candidate_id, job_id, match_score, hr_note, stage

Interview
 - id, application_id, interviewer_id, scheduled_time
 - calendar_event_id, meeting_link, status
```

---

## 6. Bảo mật & Tuân thủ dữ liệu cá nhân

- CV chứa dữ liệu cá nhân nhạy cảm (SĐT, email, đôi khi CMND/CCCD) → cần:
  - Mã hóa file lưu trữ (encryption at rest)
  - Giới hạn quyền truy cập theo vai trò (RBAC)
  - Có chính sách xóa dữ liệu ứng viên không trúng tuyển sau X tháng
  - Thông báo rõ cho ứng viên về việc dùng AI để sàng lọc (minh bạch)
- Tránh để AI tự động loại bỏ ứng viên hoàn toàn không qua review của con người — nên giữ vai trò "gợi ý xếp hạng", quyết định cuối vẫn là HR, để tránh thiên vị (bias) không kiểm soát được.

---

## 7. Roadmap theo giai đoạn

**Giai đoạn 1 — MVP (2-3 tuần)**
- Form upload CV đơn giản
- Parse CV bằng LLM → JSON
- Chấm điểm cơ bản so với 1 JD
- Dashboard xem danh sách xếp hạng (không cần đẹp)
- Gửi email thủ công (chưa tự động lịch)

**Giai đoạn 2 — Tự động hóa lịch (2 tuần)**
- Tích hợp Google Calendar API
- Trang chọn slot cho ứng viên
- Email tự động + nhắc lịch

**Giai đoạn 3 — Mở rộng nguồn & tối ưu (3-4 tuần)**
- Nhận CV từ email tự động (parse inbox)
- Multi-JD, nhiều phòng ban
- Bộ lọc nâng cao, báo cáo thống kê tuyển dụng

**Giai đoạn 4 — Tinh chỉnh chất lượng AI**
- Fine-tune prompt chấm điểm theo phản hồi thực tế của HR (feedback loop)
- Phát hiện CV giả/gian lận (AI-generated content detection)

---

## 8. Rủi ro cần lưu ý
- **Độ chính xác OCR** với CV dạng ảnh/scan kém chất lượng
- **Bias trong chấm điểm** nếu JD hoặc prompt không rõ ràng
- **Chi phí API** (LLM calls) tăng theo số lượng CV — nên có bước lọc rẻ (rule-based) trước khi gọi LLM cho các CV rõ ràng không đạt
- **Trùng lịch** khi nhiều ứng viên chọn cùng giờ — cần lock slot ngay khi chọn

---

## Gợi ý bước tiếp theo
Cho mình biết bạn muốn bắt đầu từ đâu, mình có thể giúp:
- Viết code chi tiết cho từng service (parsing, scoring, scheduling)
- Thiết kế prompt cho LLM trích xuất/chấm điểm CV
- Dựng schema DB đầy đủ
