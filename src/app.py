"""CLI demo Chatbot baseline vs ReAct Agent cho bài toán tuyển dụng."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Any, Callable

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from prompts import MAX_ITERATIONS
from prompts import REACT_SYSTEM_PROMPT
from providers import get_llm_provider
from tools import AVAILABLE_TOOLS


@dataclass
class AgentResult:
    answer: str
    trace: list[dict[str, Any]] = field(default_factory=list)
    guardrail_triggered: bool = False


def load_test_cases() -> list[dict[str, Any]]:
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config", "test_cases.json")
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def run_baseline_chatbot(user_query: str) -> str:
    """Baseline offline: một lượt trả lời, không gọi tool."""
    query = user_query.casefold()
    if "thay thế" in query and "hr" in query:
        return "Không. Điểm phù hợp chỉ là gợi ý; HR phải review và quyết định cuối cùng."
    return (
        "Tôi không có quyền truy cập hồ sơ hoặc lịch trong chế độ Chatbot. "
        "Hãy chuyển yêu cầu này sang ReAct Agent để lấy dữ liệu có bằng chứng."
    )


def _extract(pattern: str, text: str, default: str = "") -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return match.group(0).upper() if match else default


def _plan(user_query: str) -> list[tuple[str, dict[str, Any], str]]:
    """Planner deterministic giúp demo ổn định, không phụ thuộc API key."""
    query = user_query.casefold()
    candidate_id = _extract(r"CV-\d+", user_query)
    job_id = _extract(r"JOB-\d+", user_query, "JOB-001")
    if "xếp hạng" in query and ("lịch" in query or "slot" in query):
        return [
            ("rank_candidates", {"job_id": job_id}, "Cần xếp hạng theo JD trước."),
            ("find_interview_slots", {"job_id": job_id}, "Cần lấy các slot còn trống."),
        ]
    if "xếp hạng" in query:
        return [("rank_candidates", {"job_id": job_id}, "Cần xếp hạng hồ sơ bằng dữ liệu hệ thống.")]
    if "chấm điểm" in query:
        return [("score_candidate", {"candidate_id": candidate_id, "job_id": job_id}, "Cần chấm điểm có bằng chứng.")]
    if "đặt lịch" in query:
        time_match = re.search(r"\d{4}-\d{2}-\d{2}T\S+", user_query)
        denied = any(token in query for token in ("chưa duyệt", "chưa có hr duyệt", "không duyệt", "chưa phê duyệt"))
        approved = not denied and any(
            token in query for token in ("đã duyệt", "hr đã duyệt", "đã phê duyệt")
        )
        return [(
            "schedule_interview",
            {
                "candidate_id": candidate_id, "job_id": job_id,
                "scheduled_time": time_match.group(0).rstrip(".,") if time_match else "",
                "hr_approved": approved,
            },
            "Cần kiểm tra phê duyệt và tính khả dụng của slot.",
        )]
    return []


def _summarize(observations: list[dict[str, Any]]) -> str:
    if not observations:
        return run_baseline_chatbot("")
    for obs in observations:
        if not obs.get("ok"):
            return f"Không thể hoàn tất: {obs.get('message', 'tool trả lỗi')}"
    parts: list[str] = []
    for obs in observations:
        if "score" in obs:
            evidence = obs["evidence"]
            parts.append(
                f"{obs['candidate_id']} đạt {obs['score']}/100 ({obs['label']}); "
                f"khớp kỹ năng bắt buộc: {', '.join(evidence['matched_required_skills']) or 'không có'}, "
                f"thiếu: {', '.join(evidence['missing_required_skills']) or 'không có'}."
            )
        elif "ranking" in obs:
            ranking = ", ".join(f"{item['candidate_id']} ({item['score']})" for item in obs["ranking"])
            parts.append(f"Xếp hạng gợi ý: {ranking}. HR cần review trước quyết định.")
        elif "slots" in obs:
            parts.append(f"Slot còn trống ({obs['timezone']}): {', '.join(obs['slots']) or 'không còn slot'}.")
        elif obs.get("status") == "scheduled_demo":
            parts.append(
                f"Đã đặt lịch mô phỏng {obs['candidate_id']} lúc {obs['scheduled_time']}; "
                "chưa gửi email hoặc calendar thật."
            )
    return " ".join(parts)


def run_react_agent(
    user_query: str,
    tools: dict[str, Callable[..., dict[str, Any]]] | None = None,
    max_iterations: int = MAX_ITERATIONS,
) -> AgentResult:
    registry = tools or AVAILABLE_TOOLS
    actions = _plan(user_query)
    if not actions:
        return AgentResult(answer=run_baseline_chatbot(user_query))

    trace: list[dict[str, Any]] = []
    seen: set[str] = set()
    observations: list[dict[str, Any]] = []
    for step, (tool_name, arguments, thought) in enumerate(actions, start=1):
        if step > max_iterations:
            return AgentResult(
                "Đã dừng an toàn vì vượt giới hạn bước.", trace, guardrail_triggered=True
            )
        signature = json.dumps([tool_name, arguments], ensure_ascii=False, sort_keys=True)
        if signature in seen:
            return AgentResult(
                "Đã dừng an toàn vì phát hiện action lặp.", trace, guardrail_triggered=True
            )
        seen.add(signature)
        tool = registry.get(tool_name)
        if not tool:
            observation = {"ok": False, "error": "UNKNOWN_TOOL", "message": f"Tool '{tool_name}' không tồn tại."}
        else:
            try:
                observation = tool(**arguments)
            except Exception as exc:
                observation = {"ok": False, "error": "TOOL_EXCEPTION", "message": str(exc)}
        trace.append({
            "step": step, "thought": thought, "action": tool_name,
            "arguments": arguments, "observation": observation,
        })
        observations.append(observation)
        if not observation.get("ok"):
            break
    return AgentResult(answer=_summarize(observations), trace=trace)


def _parse_llm_json(raw_response: str) -> dict[str, Any]:
    """Parse JSON thuần hoặc JSON nằm trong code fence của model."""
    text = raw_response.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Model không trả JSON object hợp lệ.")
        data = json.loads(text[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("Phản hồi của model phải là JSON object.")
    return data


def run_llm_react_agent(
    user_query: str,
    provider: Any | None = None,
    tools: dict[str, Callable[..., dict[str, Any]]] | None = None,
    max_iterations: int = MAX_ITERATIONS,
) -> AgentResult:
    """Vòng lặp ReAct thật: LLM chọn action, application tạo Observation."""
    llm = provider or get_llm_provider()
    registry = tools or AVAILABLE_TOOLS
    history: list[dict[str, Any]] = [{"role": "user", "content": user_query}]
    trace: list[dict[str, Any]] = []
    seen: set[str] = set()

    for step in range(1, max_iterations + 1):
        prompt = (
            "Lịch sử làm việc dạng JSON bên dưới. Hãy quyết định bước tiếp theo.\n"
            + json.dumps(history, ensure_ascii=False)
        )
        raw = llm.generate(prompt, system_prompt=REACT_SYSTEM_PROMPT)
        if not raw or raw.startswith("["):
            return AgentResult(
                answer=f"Không gọi được LLM: {raw or 'phản hồi rỗng'}",
                trace=trace,
                guardrail_triggered=True,
            )
        try:
            decision = _parse_llm_json(raw)
        except (ValueError, json.JSONDecodeError) as exc:
            trace.append({
                "step": step, "thought": "Không parse được phản hồi LLM",
                "action": "parse_response", "arguments": {},
                "observation": {"ok": False, "error": "INVALID_LLM_OUTPUT", "message": str(exc), "raw": raw},
            })
            return AgentResult(
                answer="Đã dừng an toàn vì Gemini trả về sai định dạng JSON.",
                trace=trace,
                guardrail_triggered=True,
            )

        thought = str(decision.get("thought", "Model không nêu lý do."))
        if isinstance(decision.get("final_answer"), str):
            return AgentResult(answer=decision["final_answer"], trace=trace)

        tool_name = decision.get("action")
        arguments = decision.get("arguments", {})
        if not isinstance(tool_name, str) or not isinstance(arguments, dict):
            return AgentResult(
                answer="Đã dừng an toàn: Gemini không cung cấp action/arguments hợp lệ.",
                trace=trace,
                guardrail_triggered=True,
            )

        signature = json.dumps([tool_name, arguments], ensure_ascii=False, sort_keys=True)
        if signature in seen:
            return AgentResult(
                answer="Đã dừng an toàn vì Gemini lặp lại cùng một action.",
                trace=trace,
                guardrail_triggered=True,
            )
        seen.add(signature)
        tool = registry.get(tool_name)
        if not tool:
            observation = {
                "ok": False, "error": "UNKNOWN_TOOL",
                "message": f"Tool '{tool_name}' không tồn tại. Tool hợp lệ: {', '.join(registry)}.",
            }
        else:
            try:
                observation = tool(**arguments)
            except TypeError as exc:
                observation = {"ok": False, "error": "INVALID_ARGUMENTS", "message": str(exc)}
            except Exception as exc:
                observation = {"ok": False, "error": "TOOL_EXCEPTION", "message": str(exc)}
        trace.append({
            "step": step, "thought": thought, "action": tool_name,
            "arguments": arguments, "observation": observation,
        })
        history.extend([
            {"role": "assistant", "content": decision},
            {"role": "tool", "name": tool_name, "content": observation},
        ])

    return AgentResult(
        answer=f"Đã dừng an toàn sau {max_iterations} bước mà chưa có câu trả lời cuối.",
        trace=trace,
        guardrail_triggered=True,
    )


def _print_agent_result(result: AgentResult) -> None:
    for item in result.trace:
        print(f"Thought: {item['thought']}")
        print(f"Action: {item['action']}({json.dumps(item['arguments'], ensure_ascii=False)})")
        print(f"Observation: {json.dumps(item['observation'], ensure_ascii=False)}")
    print(f"Final Answer: {result.answer}")


def print_result(case: dict[str, Any], mode: str, planner: str = "offline") -> None:
    print(f"\n[Test #{case['id']}] {case['question']}")
    if mode in ("baseline", "both"):
        print(f"Chatbot: {run_baseline_chatbot(case['question'])}")
    if mode in ("agent", "both"):
        result = run_llm_react_agent(case["question"]) if planner == "llm" else run_react_agent(case["question"])
        _print_agent_result(result)


def main() -> None:
    parser = argparse.ArgumentParser(description="Demo trợ lý tuyển dụng ReAct")
    parser.add_argument("--case", type=int, help="Chạy một test case theo ID")
    parser.add_argument("--mode", choices=["baseline", "agent", "both"], default="both")
    parser.add_argument("--planner", choices=["offline", "llm"], default="offline",
                        help="offline ổn định hoặc llm dùng provider trong .env")
    parser.add_argument("--query", help="Chạy một câu hỏi tùy ý thay vì test case")
    args = parser.parse_args()
    if args.query:
        print("TRỢ LÝ SÀNG LỌC CV & HẸN PHỎNG VẤN")
        if args.mode in ("baseline", "both"):
            print(f"Chatbot: {run_baseline_chatbot(args.query)}")
        if args.mode in ("agent", "both"):
            result = run_llm_react_agent(args.query) if args.planner == "llm" else run_react_agent(args.query)
            _print_agent_result(result)
        return
    cases = load_test_cases()
    selected = [case for case in cases if case["id"] == args.case] if args.case else cases
    if not selected:
        parser.error("Không tìm thấy test case.")
    print("TRỢ LÝ SÀNG LỌC CV & HẸN PHỎNG VẤN — OFFLINE MVP")
    for case in selected:
        print_result(case, args.mode, args.planner)


if __name__ == "__main__":
    main()
