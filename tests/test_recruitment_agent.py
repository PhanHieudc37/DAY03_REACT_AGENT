import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))

from app import run_llm_react_agent, run_react_agent
from tools import BOOKINGS, rank_candidates, schedule_interview, score_candidate


class RecruitmentAgentTests(unittest.TestCase):
    def setUp(self):
        BOOKINGS.clear()

    def test_score_is_explainable(self):
        result = score_candidate("CV-001", "JOB-001")
        self.assertTrue(result["ok"])
        self.assertGreaterEqual(result["score"], 85)
        self.assertEqual(result["tier"], "high")
        self.assertEqual(set(result["breakdown"]), {
            "skills_score", "experience_score", "education_score", "other_score"
        })
        self.assertEqual(result["evidence"]["missing_required_skills"], [])

    def test_three_tier_policy(self):
        self.assertEqual(score_candidate("CV-001", "JOB-001")["tier"], "high")
        self.assertEqual(score_candidate("CV-002", "JOB-001")["tier"], "review")
        self.assertEqual(score_candidate("CV-003", "JOB-001")["tier"], "rejected")

    def test_ranking_is_descending(self):
        ranking = rank_candidates("JOB-001")["ranking"]
        self.assertEqual(ranking[0]["candidate_id"], "CV-001")
        self.assertEqual([x["score"] for x in ranking], sorted([x["score"] for x in ranking], reverse=True))

    def test_unknown_candidate_fails_safely(self):
        result = run_react_agent("Chấm điểm ứng viên CV-999 cho JOB-001.")
        self.assertIn("Không thể hoàn tất", result.answer)
        self.assertEqual(result.trace[0]["observation"]["error"], "CANDIDATE_NOT_FOUND")

    def test_scheduling_requires_approval(self):
        result = schedule_interview("CV-001", "JOB-001", "2026-08-03T09:00:00+07:00")
        self.assertEqual(result["error"], "HR_APPROVAL_REQUIRED")
        self.assertEqual(BOOKINGS, [])

    def test_agent_understands_negated_approval(self):
        result = run_react_agent(
            "Đặt lịch CV-001 với JOB-001 lúc 2026-08-03T09:00:00+07:00, chưa có HR duyệt."
        )
        self.assertEqual(result.trace[0]["observation"]["error"], "HR_APPROVAL_REQUIRED")
        self.assertEqual(BOOKINGS, [])

    def test_multi_step_trace(self):
        result = run_react_agent("Xếp hạng ứng viên cho JOB-001 và tìm lịch phỏng vấn còn trống.")
        self.assertEqual([step["action"] for step in result.trace], ["rank_candidates", "find_interview_slots"])
        self.assertIn("Xếp hạng gợi ý", result.answer)

    def test_iteration_guardrail(self):
        result = run_react_agent(
            "Xếp hạng ứng viên cho JOB-001 và tìm lịch phỏng vấn còn trống.",
            max_iterations=1,
        )
        self.assertTrue(result.guardrail_triggered)

    def test_llm_react_executes_real_tool(self):
        class FakeProvider:
            def __init__(self):
                self.calls = 0

            def generate(self, prompt, system_prompt=""):
                self.calls += 1
                if self.calls == 1:
                    return '{"thought":"Cần chấm điểm","action":"score_candidate","arguments":{"candidate_id":"CV-001","job_id":"JOB-001"}}'
                return '{"thought":"Đã đủ bằng chứng","final_answer":"CV-001 phù hợp cao; HR cần review."}'

        result = run_llm_react_agent("Chấm CV-001", provider=FakeProvider())
        self.assertEqual(result.trace[0]["action"], "score_candidate")
        self.assertEqual(result.trace[0]["observation"]["score"], 91.3)
        self.assertIn("HR cần review", result.answer)


if __name__ == "__main__":
    unittest.main()
