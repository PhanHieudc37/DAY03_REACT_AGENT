"""Các tool deterministic cho trợ lý sàng lọc CV và hẹn phỏng vấn.

Dữ liệu trong module chỉ là dữ liệu demo, không chứa PII thật và không gọi dịch vụ ngoài.
Mọi quyết định tuyển dụng cuối cùng đều yêu cầu HR phê duyệt.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any


JOBS: dict[str, dict[str, Any]] = {
    "JOB-001": {
        "id": "JOB-001",
        "title": "Python Backend Developer",
        "required_skills": ["python", "fastapi", "sql"],
        "preferred_skills": ["docker", "redis", "aws"],
        "min_years": 2,
        "education": "bachelor",
        "weights": {"skills": 0.4, "experience": 0.3, "education": 0.15, "other": 0.15},
    }
}

CANDIDATES: dict[str, dict[str, Any]] = {
    "CV-001": {
        "id": "CV-001", "full_name": "Nguyễn An", "email": "an@example.test",
        "skills": ["Python", "FastAPI", "SQL", "Docker", "Redis"],
        "years_experience": 3, "education": "bachelor", "status": "pending",
    },
    "CV-002": {
        "id": "CV-002", "full_name": "Trần Bình", "email": "binh@example.test",
        "skills": ["Python", "Flask", "SQL"],
        "years_experience": 1, "education": "bachelor", "status": "pending",
    },
    "CV-003": {
        "id": "CV-003", "full_name": "Lê Chi", "email": "chi@example.test",
        "skills": ["Java", "Spring", "MySQL"],
        "years_experience": 4, "education": "bachelor", "status": "pending",
    },
}

INTERVIEW_SLOTS = {
    "JOB-001": [
        "2026-08-03T09:00:00+07:00",
        "2026-08-03T14:00:00+07:00",
        "2026-08-04T10:00:00+07:00",
    ]
}

BOOKINGS: list[dict[str, str]] = []


def _error(code: str, message: str) -> dict[str, Any]:
    return {"ok": False, "error": code, "message": message}


def get_candidate(candidate_id: str) -> dict[str, Any]:
    """Lấy hồ sơ đã parse theo ID. Read-only; trả lỗi có cấu trúc nếu không tồn tại."""
    candidate = CANDIDATES.get(str(candidate_id).upper())
    if not candidate:
        return _error("CANDIDATE_NOT_FOUND", f"Không tìm thấy ứng viên '{candidate_id}'.")
    result = deepcopy(candidate)
    result["ok"] = True
    return result


def get_job(job_id: str) -> dict[str, Any]:
    """Lấy JD chuẩn hóa theo ID. Read-only; không quăng exception nghiệp vụ."""
    job = JOBS.get(str(job_id).upper())
    if not job:
        return _error("JOB_NOT_FOUND", f"Không tìm thấy vị trí '{job_id}'.")
    result = deepcopy(job)
    result["ok"] = True
    return result


def score_candidate(candidate_id: str, job_id: str) -> dict[str, Any]:
    """Chấm điểm theo trọng số JD: kỹ năng, kinh nghiệm, học vấn và tiêu chí khác.

    Tool không dùng các thuộc tính nhạy cảm và không tự loại ứng viên.
    """
    candidate = get_candidate(candidate_id)
    job = get_job(job_id)
    if not candidate.get("ok"):
        return candidate
    if not job.get("ok"):
        return job

    skills = {item.casefold() for item in candidate["skills"]}
    required = {item.casefold() for item in job["required_skills"]}
    preferred = {item.casefold() for item in job["preferred_skills"]}
    required_ratio = len(skills & required) / max(len(required), 1)
    preferred_ratio = len(skills & preferred) / max(len(preferred), 1)
    skills_score = round(100 * (0.8 * required_ratio + 0.2 * preferred_ratio), 1)
    experience_score = round(100 * min(candidate["years_experience"] / max(job["min_years"], 1), 1), 1)
    education_score = 100 if candidate["education"] == job["education"] else 50
    other_score = 60
    weights = job["weights"]
    total = round(
        skills_score * weights["skills"]
        + experience_score * weights["experience"]
        + education_score * weights["education"]
        + other_score * weights["other"],
        1,
    )
    if total >= 80:
        tier, label, next_action = "high", "phù hợp cao", "đưa vào danh sách hẹn phỏng vấn"
    elif total >= 60:
        tier, label, next_action = "review", "cần xem xét", "đưa vào hàng chờ HR review"
    else:
        tier, label, next_action = "rejected", "không phù hợp", "tự động loại và chuẩn bị email từ chối"
    return {
        "ok": True, "candidate_id": candidate_id.upper(), "job_id": job_id.upper(),
        "score": total, "label": label, "tier": tier, "next_action": next_action,
        "breakdown": {
            "skills_score": skills_score,
            "experience_score": experience_score,
            "education_score": education_score,
            "other_score": other_score,
        },
        "evidence": {
            "matched_required_skills": sorted(skills & required),
            "missing_required_skills": sorted(required - skills),
            "matched_preferred_skills": sorted(skills & preferred),
            "years_experience": candidate["years_experience"],
            "required_years": job["min_years"],
        },
        "decision": "Chỉ là gợi ý; HR phải review trước khi duyệt hoặc từ chối.",
    }


def rank_candidates(job_id: str) -> dict[str, Any]:
    """Xếp hạng toàn bộ hồ sơ demo theo điểm gợi ý cho một JD."""
    if not get_job(job_id).get("ok"):
        return get_job(job_id)
    ranking = [score_candidate(candidate_id, job_id) for candidate_id in CANDIDATES]
    ranking.sort(key=lambda item: item["score"], reverse=True)
    return {"ok": True, "job_id": job_id.upper(), "ranking": ranking, "requires_hr_review": True}


def find_interview_slots(job_id: str) -> dict[str, Any]:
    """Trả các slot còn trống. Read-only, không tạo event lịch thật."""
    if not get_job(job_id).get("ok"):
        return get_job(job_id)
    booked = {booking["scheduled_time"] for booking in BOOKINGS}
    slots = [slot for slot in INTERVIEW_SLOTS.get(job_id.upper(), []) if slot not in booked]
    return {"ok": True, "job_id": job_id.upper(), "timezone": "Asia/Ho_Chi_Minh", "slots": slots}


def schedule_interview(
    candidate_id: str, job_id: str, scheduled_time: str, hr_approved: bool = False
) -> dict[str, Any]:
    """Đặt lịch mô phỏng; bắt buộc HR phê duyệt và slot phải còn trống.

    Side effect chỉ nằm trong bộ nhớ của tiến trình hiện tại, không gửi email/calendar.
    """
    if not hr_approved:
        return _error("HR_APPROVAL_REQUIRED", "Cần HR phê duyệt trước khi đặt lịch.")
    if not get_candidate(candidate_id).get("ok"):
        return get_candidate(candidate_id)
    slots = find_interview_slots(job_id)
    if not slots.get("ok"):
        return slots
    try:
        datetime.fromisoformat(scheduled_time)
    except (TypeError, ValueError):
        return _error("INVALID_DATETIME", "Thời gian phải ở định dạng ISO 8601.")
    if scheduled_time not in slots["slots"]:
        return _error("SLOT_UNAVAILABLE", "Slot không tồn tại hoặc đã được đặt.")
    booking = {
        "candidate_id": candidate_id.upper(), "job_id": job_id.upper(),
        "scheduled_time": scheduled_time, "status": "scheduled_demo",
    }
    BOOKINGS.append(booking)
    return {
        "ok": True, **booking,
        "notification": "Email/calendar chỉ được mô phỏng, chưa gửi ra dịch vụ ngoài.",
    }


AVAILABLE_TOOLS = {
    "get_candidate": get_candidate,
    "get_job": get_job,
    "score_candidate": score_candidate,
    "rank_candidates": rank_candidates,
    "find_interview_slots": find_interview_slots,
    "schedule_interview": schedule_interview,
}