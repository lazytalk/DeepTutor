import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ObjectiveReport,
  StudentRecordPayload,
} from "@/features/classroom/api";

const translate = (key: string, values?: Record<string, unknown>) =>
  key.replace(/{{(\w+)}}/g, (_, name) => String(values?.[name] ?? name));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("@/hooks/useAuthStatus", () => ({ useAuthStatus: () => ({ role: "teacher" }) }));
vi.mock("@/lib/workspace-scope", () => ({ selectWorkspace: vi.fn() }));

const evidence: ObjectiveReport = {
  id: "kp1",
  name: "Wingspan",
  type: "memory",
  module_id: "m1",
  module_name: "Module 1",
  status: "learning",
  gate: "quantitative",
  mastered: false,
  assessed_mastered: false,
  mastery_source: "quiz",
  override_note: "",
  mastery: 0.4,
  threshold: 0.7,
  attempts: [
    {
      question_id: "q1",
      prompt: "How wide is a crane?",
      is_correct: false,
      independent: true,
      answer: "narrow",
      error_type: "recall",
      at: 100,
    },
  ],
  correct_count: 0,
  explanation: "",
  explained: null,
  errors: [
    {
      id: "err1",
      error_type: "recall",
      status: "active",
      self_attribution: "",
      retries: 0,
      created_at: 100,
    },
  ],
  review: { due_at: null },
  evidence_count: 1,
};

const record: StudentRecordPayload = {
  student: { id: "s1", username: "alice", role: "student" },
  classes: [{ id: "c1", name: "Math P3", workspace_id: "w1" }],
  assignments: [
    {
      id: "as1",
      class_id: "c1",
      class_name: "Math P3",
      kind: "mastery_topic",
      source_id: "topic_src",
      target_id: "topic_copy",
      target_name: "Cranes",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
      revoked_at: null,
      workspace_id: "",
    },
    {
      id: "as2",
      class_id: "c1",
      class_name: "Math P3",
      kind: "question_set",
      source_id: "7",
      target_id: "8",
      target_name: "Crane quiz",
      status: "revoked",
      created_at: "2026-01-02T00:00:00Z",
      revoked_at: "2026-01-03T00:00:00Z",
      workspace_id: "",
    },
  ],
  mastery: {
    counts: { mastered: 1, learning: 2, new: 1, total: 4 },
    due_reviews: 2,
    topics: [
      {
        assignment_id: "as1",
        class_id: "c1",
        class_name: "Math P3",
        path_id: "topic_copy",
        name: "Cranes",
        counts: { mastered: 1, learning: 2, new: 1, total: 4 },
        due_reviews: 2,
        complete: false,
        next: {
          action: "review",
          module_id: "m1",
          module_name: "Module 1",
          knowledge_point_id: "kp1",
          knowledge_point_name: "Wingspan",
          knowledge_point_type: "memory",
          status: "learning",
          gate: "quantitative",
          mastery: 0.4,
          threshold: 0.7,
          reason: "Review due",
        },
        modules: [
          {
            id: "m1",
            name: "Module 1",
            objective: "",
            order: 0,
            mastered: 1,
            total: 2,
            knowledge_points: [
              {
                id: "kp1",
                name: "Wingspan",
                type: "memory",
                status: "learning",
                mastery: 0.4,
                mastery_source: "quiz",
                override_note: "",
                deferred: false,
              },
              {
                id: "kp2",
                name: "Migration",
                type: "memory",
                status: "mastered",
                mastery: 0.9,
                mastery_source: "quiz",
                override_note: "",
                deferred: false,
              },
            ],
          },
        ],
        session_count: 1,
        updated_at: 100,
        workspace_id: "",
      },
    ],
  },
  practice: {
    summary: { total: 10, mistakes: 4, due: 3, overdue: 2 },
    analytics: { totals: { questions: 10, mistakes: 4, reviews: 6 } },
    sets: [
      {
        assignment_id: "as1",
        class_id: "c1",
        class_name: "Math P3",
        category_id: 8,
        name: "Crane quiz",
        entry_count: 5,
        mistakes: 2,
        due: 3,
      },
    ],
    queue: [
      {
        id: 1,
        question: "How wide is a crane?",
        question_type: "short_answer",
        is_correct: false,
        result: "incorrect",
        knowledge_point_id: "",
        mastery_path_id: "",
        category_id: 8,
        category_name: "Crane quiz",
        assignment_id: "as1",
        class_id: "c1",
        due_at: 100,
        is_mistake: true,
        interval_days: 1,
        review_count: 0,
      },
    ],
  },
  courseware: [
    {
      book_id: "bk1",
      title: "Crane Handbook",
      workspace_id: "w1",
      class_ids: ["c1"],
      class_names: ["Math P3"],
      reading: { current_page_id: "p2", visited_pages: 2, total_pages: 10, percent: 20 },
    },
  ],
  sessions: [
    {
      session_id: "sess_assigned",
      title: "Crane review",
      created_at: 90,
      updated_at: 100,
      capability: "mastery_path",
      message_count: 4,
      class_id: "c1",
      class_name: "Math P3",
      assignment_id: "as1",
      topic_id: "topic_copy",
      topic_name: "Cranes",
    },
  ],
  highlights: {
    total: 2,
    recent: [
      {
        id: 2,
        question: "ASSIGNED CRANE QUESTION",
        question_type: "short_answer",
        is_correct: false,
        result: "incorrect",
        created_at: 100,
        knowledge_point_id: "",
        mastery_path_id: "",
        category_id: 8,
        category_name: "Crane quiz",
        assignment_id: "as1",
        class_id: "c1",
      },
    ],
  },
  needs_attention: [
    { kind: "reviews_due", count: 2 },
    { kind: "practice_due", count: 3 },
  ],
};

vi.mock("@/features/classroom/api", () => ({
  studentRecord: vi.fn(async () => record),
  studentObjectiveEvidence: vi.fn(async () => ({ objective: evidence })),
  classroomDashboard: vi.fn(async () => ({
    classes: [
      {
        class_id: "c1",
        class_name: "Math P3",
        workspace_id: "w1",
        member_count: 1,
        assignments: 1,
        reviews_due: 0,
        students: [
          {
            student_id: "s1",
            username: "alice",
            topics: [],
            practice_totals: {},
          },
        ],
      },
    ],
    totals: { classes: 1, students: 1, assignments: 1, reviews_due: 0, sessions: 0 },
  })),
  classAssignments: vi.fn(async () => []),
  studentQuestionSets: vi.fn(async () => []),
  studentTopic: vi.fn(async () => ({})),
  studentTopicSessions: vi.fn(async () => []),
  studentSetEntries: vi.fn(async () => []),
  patchStudentEntry: vi.fn(async () => ({ ok: true })),
  renameStudentTopic: vi.fn(async () => ({ path_id: "", name: "" })),
}));

import { StudentRecord } from "@/features/classroom/components/StudentRecord";
import { StudentActivityViewer } from "@/features/classroom/components/StudentActivityViewer";
import { TeacherDashboard } from "@/features/classroom/components/TeacherDashboard";
import {
  classAssignments,
  studentObjectiveEvidence,
  studentRecord,
} from "@/features/classroom/api";

beforeEach(() => {
  vi.mocked(studentRecord).mockResolvedValue(record);
  vi.mocked(studentObjectiveEvidence).mockResolvedValue({
    book_id: "topic_copy",
    path_revision: 1,
    objective: evidence,
  });
  vi.mocked(classAssignments).mockResolvedValue([]);
});

describe("StudentRecord", () => {
  it("renders the overview and every learning tab", async () => {
    render(<StudentRecord studentId="s1" />);

    expect(await screen.findByTestId("student-record-title")).toHaveTextContent(
      "Learning record for alice",
    );
    expect(screen.getByTestId("record-mastered")).toHaveTextContent("1/4");
    expect(screen.getByTestId("record-reviews")).toHaveTextContent("2");
    expect(screen.getByText("2 reviews due")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Mastery" }));
    const topic = await screen.findByTestId("mastery-topic-topic_copy");
    expect(within(topic).getByText("Cranes")).toBeInTheDocument();
    expect(within(topic).getAllByText("Wingspan").length).toBeGreaterThan(0);
    fireEvent.click(within(topic).getByTestId("mastery-kp-kp1"));
    const report = await screen.findByTestId("objective-evidence");
    expect(within(report).getByText(/How wide is a crane\?/)).toBeInTheDocument();
    expect(within(report).getByText(/Attempts: 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Practice" }));
    expect(await screen.findByTestId("practice-set-8")).toHaveTextContent("Crane quiz");
    expect(screen.getByText("How wide is a crane?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Courseware" }));
    expect(await screen.findByTestId("courseware-bk1")).toHaveTextContent(
      "Crane Handbook",
    );
    expect(screen.getByText("20%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Conversations" }));
    const sessionLink = await screen.findByTestId("conversation-sess_assigned");
    expect(sessionLink).toHaveAttribute(
      "href",
      "/classroom/review/s1/sess_assigned",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Highlights" }));
    expect(await screen.findByTestId("highlight-2")).toHaveTextContent(
      "ASSIGNED CRANE QUESTION",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Assignments" }));
    expect(await screen.findByTestId("record-assignment-as1")).toHaveTextContent(
      "Cranes",
    );
    expect(screen.getByTestId("record-assignment-as2")).toHaveTextContent("Revoked");
  });
});

describe("learning record drill-down links", () => {
  it("links the dashboard student row to the record route", async () => {
    render(<TeacherDashboard onOpenClass={() => {}} />);
    const link = await screen.findByTestId("dashboard-student-c1-s1");
    expect(link).toHaveAttribute("href", "/classroom/record/s1");
  });

  it("links the assigned-work viewer to the record route", async () => {
    render(
      <StudentActivityViewer classId="c1" studentId="s1" username="alice" />,
    );
    expect(await screen.findByTestId("open-learning-record")).toHaveAttribute(
      "href",
      "/classroom/record/s1",
    );
  });
});