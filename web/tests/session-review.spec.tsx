import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionReview } from "@/features/classroom/components/SessionReview";
import type { SessionReviewPayload } from "@/features/classroom/api";
import type { StreamEvent } from "@/features/chat/model/protocol";
import { initI18n } from "@/i18n/init";

vi.mock("@/features/classroom/api", () => ({
  studentSessionReview: vi.fn(),
}));
// Keep the review's copy synchronous in jsdom: the real renderer lazily loads
// KaTeX plugins after mount, which schedules state updates outside act().
vi.mock("@/components/common/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@/hooks/useConnectedAgentKinds", () => ({
  useConnectedAgentKinds: () => ({}),
}));
vi.mock("@/hooks/useConsultationReference", () => ({
  useConsultationReference: () => null,
}));
// The activity header's animated orb schedules theme state updates outside
// act() in jsdom. The review assertions are about the transcript, not the
// orb, so render the process content directly.
vi.mock("@/features/chat/trace/TracePresentation", () => ({
  AssistantActivity: ({ processContent }: { processContent?: ReactNode }) => (
    <div>{processContent}</div>
  ),
  TraceFlow: () => null,
  NestedTraceFlow: () => null,
}));

import { studentSessionReview } from "@/features/classroom/api";

initI18n("en");

const event = (
  type: StreamEvent["type"],
  metadata: Record<string, unknown>,
  seq: number,
): StreamEvent => ({
  type,
  source: "chat",
  stage: "responding",
  content: "",
  metadata,
  session_id: "session-1",
  turn_id: "turn-1",
  seq,
  timestamp: 1_000 + seq,
});

function payload(): SessionReviewPayload {
  const askUserQuestion = event(
    "tool_result",
    {
      tool_name: "ask_user",
      call_id: "ask-call-1",
      tool_metadata: {
        ask_user: {
          intro: "Quick setup",
          questions: [
            {
              id: "prior",
              prompt: "Where are you starting from?",
              header: "Starting point",
              options: [{ label: "New to calculus" }],
              allow_free_text: true,
            },
          ],
        },
      },
    },
    2,
  );
  const askUserResolved = event(
    "progress",
    {
      ask_user_resolved: true,
      ask_user_tool_call_id: "ask-call-1",
      answers: [{ questionId: "prior", text: "New to calculus" }],
      trace_kind: "user_reply",
    },
    3,
  );

  return {
    id: "session-1",
    session_id: "session-1",
    title: "Limits review",
    created_at: 1,
    updated_at: 20,
    context: {
      student: { id: "u-student", username: "student1" },
      class: { id: "c1", name: "Math P3" },
      assignment: { id: "as-1", kind: "mastery_topic", target_id: "topic-1" },
      topic: { id: "topic-1", name: "AP Calculus BC" },
      session: { id: "session-1", title: "Limits review" },
    },
    summary: {
      turns: 3,
      messages: 5,
      ask_user: 1,
      tools: 1,
      quizzes: 2,
      mistakes: 1,
      errors: 0,
    },
    messages: [
      {
        id: 1,
        session_id: "session-1",
        role: "user",
        content: "What is a limit?",
        events: [],
        created_at: 2,
      },
      {
        id: 2,
        session_id: "session-1",
        role: "assistant",
        content: "A limit describes the value a function approaches.",
        capability: "mastery_path",
        events: [askUserQuestion, askUserResolved],
        created_at: 3,
      },
      {
        id: 3,
        session_id: "session-1",
        role: "user",
        content: "I think the answer is B.",
        events: [],
        created_at: 4,
      },
      {
        id: 4,
        session_id: "session-1",
        role: "assistant",
        content: "Nice work, the limit exists.",
        capability: "mastery_path",
        events: [],
        created_at: 5,
      },
      {
        id: 5,
        session_id: "session-1",
        role: "user",
        content: "One more question.",
        events: [],
        created_at: 6,
      },
    ],
    turns: [
      {
        id: "turn-1",
        turn_id: "turn-1",
        number: 1,
        capability: "mastery_path",
        status: "completed",
        error: "",
        failure_code: "",
        retryable: false,
        created_at: 2,
        updated_at: 3,
        finished_at: 4,
        duration: 2,
        user_message_id: 1,
        assistant_message_id: 2,
        message_ids: [1, 2],
        events: [],
        ask_user: [
          {
            tool_call_id: "ask-call-1",
            intro: "Quick setup",
            questions: [
              {
                id: "prior",
                prompt: "Where are you starting from?",
                header: "Starting point",
                multi_select: false,
                allow_free_text: true,
                placeholder: null,
                options: [{ label: "New to calculus", description: null }],
              },
            ],
            answers: [{ questionId: "prior", text: "New to calculus" }],
            resolved: true,
            asked_at: 2,
            answered_at: 3,
          },
        ],
        tool_calls: [],
        stages: [],
        quiz_results: [
          {
            id: 11,
            question_id: "q1",
            question: "The limit of $x^2$ as $x$ tends to 2 is:",
            question_type: "choice",
            options: { A: "2", B: "4" },
            user_answer: "B",
            correct_answer: "B",
            explanation: "Substitute x = 2.",
            is_correct: true,
            result: "correct",
            assessment_type: "quiz",
            knowledge_point_id: "kp1",
            mastery_path_id: "topic-1",
            attempt_count: 1,
            hints_used: 0,
            created_at: 3,
          },
        ],
        errors: [],
        counts: {
          ask_user: 1,
          tools: 0,
          stages: 0,
          quizzes: 1,
          mistakes: 0,
          errors: 0,
          messages: 2,
        },
      },
      {
        id: "turn-2",
        turn_id: "turn-2",
        number: 2,
        capability: "mastery_path",
        status: "completed",
        error: "",
        failure_code: "",
        retryable: false,
        created_at: 4,
        updated_at: 5,
        finished_at: 6,
        duration: 2,
        user_message_id: 3,
        assistant_message_id: 4,
        message_ids: [3, 4],
        events: [],
        ask_user: [],
        tool_calls: [],
        stages: [],
        quiz_results: [],
        errors: [],
        counts: {
          ask_user: 0,
          tools: 0,
          stages: 0,
          quizzes: 0,
          mistakes: 0,
          errors: 0,
          messages: 2,
        },
      },
      {
        id: "turn-3",
        turn_id: "turn-3",
        number: 3,
        capability: "mastery_path",
        status: "completed",
        error: "",
        failure_code: "",
        retryable: false,
        created_at: 6,
        updated_at: 7,
        finished_at: 8,
        duration: 2,
        user_message_id: 5,
        assistant_message_id: null,
        message_ids: [5],
        events: [],
        ask_user: [],
        tool_calls: [],
        stages: [],
        quiz_results: [
          {
            id: 12,
            question_id: "q2",
            question: "Which statement is wrong?",
            question_type: "choice",
            options: { A: "One", B: "Two" },
            user_answer: "A",
            correct_answer: "B",
            explanation: "Check the one-sided limits.",
            is_correct: false,
            result: "incorrect",
            assessment_type: "quiz",
            knowledge_point_id: "kp2",
            mastery_path_id: "topic-1",
            attempt_count: 1,
            hints_used: 0,
            created_at: 7,
          },
        ],
        errors: [],
        counts: {
          ask_user: 0,
          tools: 0,
          stages: 0,
          quizzes: 1,
          mistakes: 1,
          errors: 0,
          messages: 1,
        },
      },
    ],
  };
}

describe("SessionReview", () => {
  beforeEach(() => {
    vi.mocked(studentSessionReview).mockResolvedValue(payload());
  });

  it("renders the context header, rich transcript and ask_user exchange read-only", async () => {
    render(<SessionReview studentId="u-student" sessionId="session-1" />);

    expect(await screen.findByTestId("review-student")).toHaveTextContent(
      "student1",
    );
    expect(screen.getByTestId("review-class")).toHaveTextContent("Math P3");
    expect(screen.getByTestId("review-topic")).toHaveTextContent(
      "AP Calculus BC",
    );

    const turnOne = await screen.findByTestId("review-turn-turn-1");
    expect(
      await within(turnOne).findByTestId("review-assistant-message"),
    ).toHaveTextContent("A limit describes the value a function approaches.");
    // The existing chat renderer draws the resolved ask_user card read-only.
    expect(await screen.findByTestId("ask-user-answers")).toHaveTextContent(
      "Where are you starting from?",
    );
    expect(screen.getByTestId("ask-user-answers")).toHaveTextContent(
      "New to calculus",
    );
    // No chat actions / composer in a review surface.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit" }),
    ).not.toBeInTheDocument();
  });

  it("groups activity by turn and exposes ask_user + quiz results", async () => {
    render(<SessionReview studentId="u-student" sessionId="session-1" />);

    const turnOne = await screen.findByTestId("review-turn-turn-1");
    await waitFor(() => {
      expect(within(turnOne).getByTestId("review-ask-user")).toHaveTextContent(
        "Where are you starting from?",
      );
    });
    expect(
      within(turnOne).getByTestId("review-ask-user-answer"),
    ).toHaveTextContent("New to calculus");
    await waitFor(
      () => {
        expect(
          within(turnOne).getByTestId("review-quiz-result"),
        ).toHaveTextContent("The limit of $x^2$ as $x$ tends to 2 is:");
      },
      { timeout: 5000 },
    );
    expect(within(turnOne).getByTestId("review-quiz-result")).toHaveTextContent(
      "Correct",
    );

    const turnThree = screen.getByTestId("review-turn-turn-3");
    await waitFor(() => {
      expect(
        within(turnThree).getByTestId("review-quiz-result"),
      ).toHaveTextContent("Which statement is wrong?");
    });
    expect(
      within(turnThree).getByTestId("review-quiz-result"),
    ).toHaveTextContent("Incorrect");
  });

  it("filters to questions and to quiz/mistakes", async () => {
    render(<SessionReview studentId="u-student" sessionId="session-1" />);
    await screen.findByTestId("review-turn-turn-1");

    fireEvent.click(screen.getByTestId("review-filter-qa"));
    expect(screen.getByTestId("review-turn-turn-1")).toBeInTheDocument();
    expect(screen.queryByTestId("review-turn-turn-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-turn-turn-3")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("review-filter-quiz"));
    expect(screen.getByTestId("review-turn-turn-1")).toBeInTheDocument();
    expect(screen.getByTestId("review-turn-turn-3")).toBeInTheDocument();
    expect(screen.queryByTestId("review-turn-turn-2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("review-filter-all"));
    expect(screen.getByTestId("review-turn-turn-2")).toBeInTheDocument();
  });

  it("searches inside the transcript and jumps to a turn", async () => {
    render(<SessionReview studentId="u-student" sessionId="session-1" />);
    await screen.findByTestId("review-turn-turn-1");

    fireEvent.change(screen.getByTestId("review-search"), {
      target: { value: "nice work" },
    });
    expect(screen.queryByTestId("review-turn-turn-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("review-turn-turn-2")).toBeInTheDocument();
    expect(screen.queryByTestId("review-turn-turn-3")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("review-search"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("review-jump"), {
      target: { value: "turn-3" },
    });
    expect(screen.getByTestId("review-turn-turn-3").className).toContain(
      "border-[var(--primary)]",
    );
  });
});