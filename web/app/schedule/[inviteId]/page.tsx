"use client";
import { useEffect, useState } from "react";

export default function CandidateSchedule() {
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState<any>(null);
  const inviteId =
    typeof window !== "undefined"
      ? window.location.pathname.split("/").filter(Boolean).pop() || ""
      : "";
  useEffect(() => {
    if (!inviteId) return;
    fetch(`/api/schedule?invite_id=${encodeURIComponent(inviteId)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || d.detail);
        setInvite(d.invite);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [inviteId]);
  async function choose(slot: string) {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite_id: inviteId, chosen_slot: slot }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || d.detail);
      setConfirmed(d.interview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể xác nhận lịch");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="candidate-schedule">
      <section className="schedule-card">
        <div className="schedule-brand">
          <span>R</span>
          <div>
            <strong>RecruitFlow</strong>
            <small>Lịch phỏng vấn bảo mật</small>
          </div>
        </div>
        {loading && !invite ? (
          <div className="schedule-state">Đang tải lời mời…</div>
        ) : error && !invite ? (
          <div className="schedule-error">
            <strong>Không mở được lời mời</strong>
            <p>{error}</p>
          </div>
        ) : confirmed ? (
          <div className="schedule-success">
            <span>✓</span>
            <h1>Đã xác nhận lịch</h1>
            <p>
              Buổi phỏng vấn của bạn đã được đặt vào{" "}
              <strong>
                {new Date(confirmed.scheduled_time).toLocaleString("vi-VN")}
              </strong>
              .
            </p>
            {confirmed.meeting_link && (
              <a href={confirmed.meeting_link}>Mở link Google Meet</a>
            )}
            <small>
              Hệ thống đã cập nhật lịch cho HR và lên lịch nhắc trước 24 giờ, 1
              giờ.
            </small>
          </div>
        ) : (
          invite && (
            <>
              <p className="schedule-eyebrow">
                LỜI MỜI PHỎNG VẤN · VÒNG {invite.interview_round}
              </p>
              <h1>Chào {invite.candidate_name},</h1>
              <p className="schedule-intro">
                Hồ sơ của bạn cho vị trí <strong>{invite.job_title}</strong> đã
                được duyệt. Hãy chọn một khung giờ phù hợp.
              </p>
              <div className="schedule-meta">
                <span>◷ {invite.duration_minutes} phút</span>
                <span>
                  {invite.interview_type === "online"
                    ? "◉ Online · Google Meet"
                    : "⌖ Phỏng vấn Onsite"}
                </span>
              </div>
              <div className="candidate-slots">
                {invite.available_slots.length ? (
                  invite.available_slots.map((slot: string) => (
                    <button
                      disabled={loading}
                      key={slot}
                      onClick={() => choose(slot)}
                    >
                      <span>
                        {new Date(slot).toLocaleDateString("vi-VN", {
                          weekday: "long",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </span>
                      <strong>
                        {new Date(slot).toLocaleTimeString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </strong>
                      <i>Chọn giờ này →</i>
                    </button>
                  ))
                ) : (
                  <div className="schedule-error">
                    <p>
                      Không còn khung giờ trống. Vui lòng liên hệ HR để được hỗ
                      trợ.
                    </p>
                  </div>
                )}
              </div>
              <small className="schedule-note">
                Khung giờ sẽ được khóa ngay khi bạn xác nhận để tránh trùng
                lịch.
              </small>
            </>
          )
        )}
      </section>
    </main>
  );
}
