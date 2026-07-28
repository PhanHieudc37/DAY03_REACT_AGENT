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
        "weights": {"skills": 0.55, "experience": 0.3, "education": 0.15},
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


def _error(code: str, message: str, **details: Any) -> dict[str, Any]:
    """Tạo kết quả lỗi thống nhất để Agent xử lý mà không làm ứng dụng crash."""
    return {"ok": False, "error": code, "message": message, **details}


def _normalize_id(value: Any, field_name: str) -> tuple[str | None, dict[str, Any] | None]:
    """Chuẩn hóa mã định danh và trả lỗi nếu đầu vào không phải chuỗi hợp lệ."""
    if not isinstance(value, str) or not value.strip():
        return None, _error(
            "INVALID_INPUT",
            f"Tham số '{field_name}' phải là chuỗi không rỗng.",
        )
    return value.strip().upper(), None


def _validate_candidate_data(candidate: dict[str, Any]) -> dict[str, Any] | None:
    """Kiểm tra cấu trúc CV demo trước khi tool sử dụng dữ liệu."""
    skills = candidate.get("skills")
    if (
        not isinstance(skills, list)
        or not skills
        or any(not isinstance(item, str) or not item.strip() for item in skills)
    ):
        return _error(
            "CV_DATA_INVALID",
            "Trường 'skills' phải là danh sách chuỗi không rỗng.",
        )

    years = candidate.get("years_experience")
    if isinstance(years, bool) or not isinstance(years, (int, float)) or years < 0:
        return _error(
            "CV_DATA_INVALID",
            "Trường 'years_experience' phải là số không âm.",
        )

    education = candidate.get("education")
    if not isinstance(education, str) or not education.strip():
        return _error(
            "CV_DATA_INVALID",
            "Trường 'education' phải là chuỗi không rỗng.",
        )
    return None


def _validate_job_data(job: dict[str, Any]) -> dict[str, Any] | None:
    """Kiểm tra JD và trọng số để tránh lỗi khi chấm điểm."""
    required = job.get("required_skills")
    preferred = job.get("preferred_skills")
    if (
        not isinstance(required, list)
        or not required
        or any(not isinstance(item, str) or not item.strip() for item in required)
    ):
        return _error(
            "JOB_DATA_INVALID",
            "Trường 'required_skills' phải là danh sách chuỗi không rỗng.",
        )
    if not isinstance(preferred, list) or any(
        not isinstance(item, str) or not item.strip() for item in preferred
    ):
        return _error(
            "JOB_DATA_INVALID",
            "Trường 'preferred_skills' phải là danh sách chuỗi.",
        )

    min_years = job.get("min_years")
    if (
        isinstance(min_years, bool)
        or not isinstance(min_years, (int, float))
        or min_years < 0
    ):
        return _error(
            "JOB_DATA_INVALID",
            "Trường 'min_years' phải là số không âm.",
        )

    education = job.get("education")
    if not isinstance(education, str) or not education.strip():
        return _error(
            "JOB_DATA_INVALID",
            "Trường 'education' phải là chuỗi không rỗng.",
        )

    weights = job.get("weights")
    required_weights = {"skills", "experience", "education"}
    if not isinstance(weights, dict) or not required_weights.issubset(weights):
        return _error(
            "JOB_DATA_INVALID",
            "Trường 'weights' thiếu trọng số skills, experience hoặc education.",
        )
    weight_values = [weights[key] for key in required_weights]
    invalid_weight = any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0
        for value in weight_values
    )
    if invalid_weight or abs(sum(weight_values) - 1.0) > 1e-9:
        return _error(
            "JOB_DATA_INVALID",
            "Các trọng số phải là số không âm và có tổng bằng 1.",
        )
    return None


def get_candidate(candidate_id: str) -> dict[str, Any]:
    """Lấy hồ sơ ẩn danh đã parse theo mã ứng viên.

    Args:
        candidate_id: Mã ứng viên, ví dụ ``CV-001``.

    Returns:
        Dict có ``ok=True`` và các trường phục vụ chấm điểm, hoặc lỗi
        ``INVALID_INPUT``, ``CANDIDATE_NOT_FOUND`` hay ``CV_DATA_INVALID``.

    Side effects:
        Không có. Tool không trả tên và email của ứng viên.
    """
    normalized_id, input_error = _normalize_id(candidate_id, "candidate_id")
    if input_error:
        return input_error
    candidate = CANDIDATES.get(normalized_id)
    if not candidate:
        return _error("CANDIDATE_NOT_FOUND", f"Không tìm thấy ứng viên '{candidate_id}'.")
    validation_error = _validate_candidate_data(candidate)
    if validation_error:
        return validation_error
    return {
        "ok": True,
        "id": candidate["id"],
        "skills": deepcopy(candidate["skills"]),
        "years_experience": candidate["years_experience"],
        "education": candidate["education"],
        "status": candidate.get("status", "unknown"),
        "data_scope": "blind_profile",
    }


def get_job(job_id: str) -> dict[str, Any]:
    """Lấy JD và rubric chấm điểm theo mã vị trí.

    Args:
        job_id: Mã vị trí, ví dụ ``JOB-001``.

    Returns:
        Dict có ``ok=True`` và JD chuẩn hóa, hoặc lỗi ``INVALID_INPUT``,
        ``JOB_NOT_FOUND`` hay ``JOB_DATA_INVALID``.

    Side effects:
        Không có.
    """
    normalized_id, input_error = _normalize_id(job_id, "job_id")
    if input_error:
        return input_error
    job = JOBS.get(normalized_id)
    if not job:
        return _error("JOB_NOT_FOUND", f"Không tìm thấy vị trí '{job_id}'.")
    validation_error = _validate_job_data(job)
    if validation_error:
        return validation_error
    result = deepcopy(job)
    result["ok"] = True
    return result


def score_candidate(candidate_id: str, job_id: str) -> dict[str, Any]:
    """Đối chiếu một CV với rubric cố định của vị trí.

    Args:
        candidate_id: Mã ứng viên cần đánh giá.
        job_id: Mã vị trí chứa tiêu chí và trọng số.

    Returns:
        Điểm, breakdown, bằng chứng và trạng thái đề xuất để HR xem xét.
        Mọi lỗi từ ``get_candidate`` hoặc ``get_job`` được trả nguyên trạng.

    Side effects:
        Không có. Tool không dùng PII và không tự tuyển hoặc loại ứng viên.
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
    education_score = (
        100
        if candidate["education"].casefold() == job["education"].casefold()
        else 50
    )
    weights = job["weights"]
    total = round(
        skills_score * weights["skills"]
        + experience_score * weights["experience"]
        + education_score * weights["education"],
        1,
    )
    missing_required = sorted(required - skills)
    if total >= 80 and not missing_required:
        tier = "high"
        status = "REVIEW_FOR_SHORTLIST"
        label = "có bằng chứng phù hợp cao"
        next_action = "chuyển HR xem xét trước khi hẹn phỏng vấn"
    elif missing_required:
        tier = "gaps"
        status = "REVIEW_GAPS"
        label = "còn thiếu bằng chứng cho tiêu chí bắt buộc"
        next_action = "chuyển HR kiểm tra hoặc yêu cầu bổ sung thông tin"
    else:
        tier = "review"
        status = "REVIEW_REQUIRED"
        label = "cần HR xem xét thêm"
        next_action = "đưa vào hàng chờ HR review"
    return {
        "ok": True,
        "candidate_id": candidate["id"],
        "job_id": job["id"],
        "score": total,
        "label": label,
        "tier": tier,
        "status": status,
        "next_action": next_action,
        "requires_hr_review": True,
        "breakdown": {
            "skills_score": skills_score,
            "experience_score": experience_score,
            "education_score": education_score,
        },
        "evidence": {
            "matched_required_skills": sorted(skills & required),
            "missing_required_skills": missing_required,
            "matched_preferred_skills": sorted(skills & preferred),
            "years_experience": candidate["years_experience"],
            "required_years": job["min_years"],
        },
        "decision": "Chỉ là gợi ý; HR phải review trước khi duyệt hoặc từ chối.",
    }


def rank_candidates(job_id: str) -> dict[str, Any]:
    """Xếp hạng hồ sơ hợp lệ và tách riêng các hồ sơ bị lỗi.

    Args:
        job_id: Mã vị trí dùng chung cho toàn bộ ứng viên.

    Returns:
        Danh sách ``ranking`` đã sắp xếp ổn định, ``failed_candidates`` và
        cờ ``requires_hr_review``. Tool không tự động loại ứng viên.

    Side effects:
        Không có.
    """
    job = get_job(job_id)
    if not job.get("ok"):
        return job

    ranking: list[dict[str, Any]] = []
    failed_candidates: list[dict[str, Any]] = []
    for candidate_id in CANDIDATES:
        result = score_candidate(candidate_id, job["id"])
        if result.get("ok"):
            ranking.append(result)
        else:
            failed_candidates.append({"candidate_id": candidate_id, **result})
    ranking.sort(key=lambda item: (-item["score"], item["candidate_id"]))
    return {
        "ok": True,
        "job_id": job["id"],
        "ranking": ranking,
        "failed_candidates": failed_candidates,
        "requires_hr_review": True,
    }


def find_interview_slots(job_id: str) -> dict[str, Any]:
    """Trả các slot phỏng vấn còn trống của một vị trí.

    Args:
        job_id: Mã vị trí cần tìm lịch.

    Returns:
        Danh sách slot ISO 8601 đã sắp xếp, hoặc lỗi từ ``get_job``.

    Side effects:
        Không có; tool không tạo sự kiện lịch.
    """
    job = get_job(job_id)
    if not job.get("ok"):
        return job
    booked = {
        booking["scheduled_time"]
        for booking in BOOKINGS
        if booking["job_id"] == job["id"]
    }
    slots = sorted(
        slot for slot in INTERVIEW_SLOTS.get(job["id"], []) if slot not in booked
    )
    return {
        "ok": True,
        "job_id": job["id"],
        "timezone": "Asia/Ho_Chi_Minh",
        "slots": slots,
    }


def schedule_interview(
    candidate_id: str, job_id: str, scheduled_time: str, hr_approved: bool = False
) -> dict[str, Any]:
    """Đặt lịch phỏng vấn mô phỏng sau khi HR xác nhận rõ ràng.

    Args:
        candidate_id: Mã ứng viên.
        job_id: Mã vị trí.
        scheduled_time: Slot theo định dạng ISO 8601 và phải có múi giờ.
        hr_approved: Chỉ giá trị boolean ``True`` mới được chấp nhận.

    Returns:
        Booking demo khi thành công; nếu thất bại trả lỗi có cấu trúc như
        ``HR_APPROVAL_REQUIRED``, ``INVALID_DATETIME``, ``ALREADY_SCHEDULED``
        hoặc ``SLOT_UNAVAILABLE``.

    Side effects:
        Thêm một booking vào bộ nhớ tiến trình; không gửi email/calendar thật.
    """
    if hr_approved is not True:
        return _error("HR_APPROVAL_REQUIRED", "Cần HR phê duyệt trước khi đặt lịch.")

    candidate = get_candidate(candidate_id)
    if not candidate.get("ok"):
        return candidate
    job = get_job(job_id)
    if not job.get("ok"):
        return job

    if not isinstance(scheduled_time, str):
        return _error("INVALID_DATETIME", "Thời gian phải là chuỗi ISO 8601.")
    try:
        parsed_time = datetime.fromisoformat(scheduled_time)
    except ValueError:
        return _error("INVALID_DATETIME", "Thời gian phải ở định dạng ISO 8601.")
    if parsed_time.tzinfo is None:
        return _error("INVALID_DATETIME", "Thời gian phải bao gồm múi giờ.")

    for booking in BOOKINGS:
        if (
            booking["candidate_id"] == candidate["id"]
            and booking["job_id"] == job["id"]
            and booking["scheduled_time"] == scheduled_time
        ):
            return _error(
                "ALREADY_SCHEDULED",
                "Ứng viên đã có đúng lịch phỏng vấn này.",
                booking=deepcopy(booking),
            )

    slots = find_interview_slots(job["id"])
    if not slots.get("ok"):
        return slots
    if scheduled_time not in slots["slots"]:
        return _error("SLOT_UNAVAILABLE", "Slot không tồn tại hoặc đã được đặt.")
    booking = {
        "booking_id": f"BOOKING-{len(BOOKINGS) + 1:03d}",
        "candidate_id": candidate["id"],
        "job_id": job["id"],
        "scheduled_time": scheduled_time,
        "status": "scheduled_demo",
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
