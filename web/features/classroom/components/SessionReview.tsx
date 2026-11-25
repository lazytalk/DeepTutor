"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Clock,
  HelpCircle,
  ListChecks,
  MessageSquareText,
  Wrench,
} from "lucide-react";

import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import {
  AssistantMessage,
  UserMessage,
  getModeBadgeLabel,
  type ChatMessageItem,
} from "@/features/chat/messages";
import {
  collectMasteryAnswerRejections,
  collectMasteryGrades,
  collectMasterySkips,
} from "@/lib/mastery-question";

import {
  studentSessionReview,
  type ReviewAskUserExchange,
  type ReviewMessage,
  type ReviewQuizResult,
  type ReviewTurn,
  type SessionReviewPayload,
} from "../api";

type ReviewFilter = "all" | "qa" | "quiz";

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  complete: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  running: "Running",
  queued: "Queued",
  waiting_input: "Pending",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "";
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function toChatMessage(message: ReviewMessage): ChatMessageItem {
  const metadata = message.metadata ?? {};
  const snapshot =
    metadata.request_snapshot ??
    metadata.requestSnapshot ??
    undefined;
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    capability: message.capability,
    events: message.events ?? [],
    trace: message.trace as ChatMessageItem["trace"],
    attachments: message.attachments as ChatMessageItem["attachments"],
    requestSnapshot: snapshot as ChatMessageItem["requestSnapshot"],
    parentMessageId: message.parent_message_id ?? null,
  };
}

function answerFor(
  exchange: ReviewAskUserExchange,
  questionId: string,
): string {
  return (
    exchange.answers.find((answer) => answer.questionId === questionId)?.text ??
    ""
  );
}

/** Free text a reviewer can search inside one turn. */
function turnSearchText(
  turn: ReviewTurn,
  messages: Map<number, ReviewMessage>,
): string {
  const parts: string[] = [];
  for (const messageId of turn.message_ids) {
    const message = messages.get(messageId);
    if (!message) continue;
    parts.push(message.content ?? "");
  }
  for (const exchange of turn.ask_user) {
    parts.push(exchange.intro ?? "");
    for (const question of exchange.questions) {
      parts.push(question.prompt, question.header ?? "");
      for (const option of question.options) {
        parts.push(option.label, option.description ?? "");
      }
    }
    for (const answer of exchange.answers) parts.push(answer.text);
  }
  for (const call of turn.tool_calls) {
    parts.push(call.name, call.args_preview, call.result_preview);
  }
  for (const stage of turn.stages) parts.push(stage.label, stage.stage);
  for (const quiz of turn.quiz_results) {
    parts.push(
      quiz.question,
      quiz.user_answer,
      quiz.correct_answer,
      quiz.explanation,
    );
  }
  for (const error of turn.errors) parts.push(error.message, error.code);
  return parts.join("\n").toLowerCase();
}

function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "danger";
}) {
  const tones = {
    muted:
      "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]",
    primary:
      "border-[var(--primary)]/50 bg-[var(--primary)]/10 text-[var(--primary)]",
    danger:
      "border-[var(--destructive)]/50 bg-[var(--destructive)]/10 text-[var(--destructive)]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function AskUserActivity({ exchanges }: { exchanges: ReviewAskUserExchange[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="review-ask-user">
      {exchanges.map((exchange, exchangeIndex) => (
        <div
          key={exchange.tool_call_id || `ask-${exchangeIndex}`}
          className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3"
        >
          {exchange.intro ? (
            <p className="mb-2 text-xs text-[var(--muted-foreground)]">
              {exchange.intro}
            </p>
          ) : null}
          <div className="space-y-2.5">
            {exchange.questions.map((question) => {
              const answer = answerFor(exchange, question.id);
              return (
                <div key={question.id || question.prompt}>
                  <p className="text-[13px] leading-relaxed text-[var(--foreground)]">
                    <MarkdownRenderer
                      content={question.prompt}
                      variant="compact"
                    />
                  </p>
                  <p
                    className={`mt-1 text-[13px] leading-relaxed ${
                      answer
                        ? "font-medium text-[var(--foreground)]"
                        : "italic text-[var(--muted-foreground)]"
                    }`}
                    data-testid="review-ask-user-answer"
                  >
                    {answer ? (
                      <MarkdownRenderer
                        content={answer}
                        variant="compact"
                      />
                    ) : (
                      t("No answer recorded.")
                    )}
                  </p>
                </div>
              );
            })}
            {exchange.questions.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {t("No questions were asked in this turn.")}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolCallActivity({ turn }: { turn: ReviewTurn }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-2" data-testid="review-tool-calls">
      {turn.tool_calls.map((call, index) => (
        <li
          key={call.call_id || `${call.name}-${index}`}
          className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-2.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-[12px] font-medium text-[var(--foreground)]">
              {call.name || t("Tool calls")}
            </code>
            <Badge tone={call.status === "error" ? "danger" : "muted"}>
              {call.status === "error" ? t("Failed") : call.status}
            </Badge>
            {call.finished_at && call.started_at ? (
              <span className="text-[11px] text-[var(--muted-foreground)]">
                {formatDuration(call.finished_at - call.started_at)}
              </span>
            ) : null}
          </div>
          {call.args_preview ? (
            <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--secondary)] p-1.5 text-[11px] text-[var(--muted-foreground)]">
              {call.args_preview}
            </pre>
          ) : null}
          {call.result_preview ? (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] text-[var(--muted-foreground)]">
              {call.result_preview}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function StageActivity({ turn }: { turn: ReviewTurn }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1.5" data-testid="review-stages">
      {turn.stages.map((stage, index) => (
        <li
          key={`${stage.stage}-${index}`}
          className="flex flex-wrap items-center gap-2 text-[12px]"
        >
          <span className="font-medium text-[var(--foreground)]">
            {stage.label}
          </span>
          <Badge tone={stage.status === "running" ? "primary" : "muted"}>
            {stage.status === "running" ? t("Running") : t("Completed")}
          </Badge>
          {stage.duration !== null ? (
            <span className="text-[var(--muted-foreground)]">
              {formatDuration(stage.duration)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function QuizActivity({ results }: { results: ReviewQuizResult[] }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-2" data-testid="review-quiz-results">
      {results.map((quiz) => (
        <li
          key={quiz.id}
          data-testid="review-quiz-result"
          className={`rounded-lg border p-3 ${
            quiz.is_correct
              ? "border-[var(--border)] bg-[var(--background)]"
              : "border-[var(--destructive)]/50 bg-[var(--destructive)]/5"
          }`}
        >
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={quiz.is_correct ? "primary" : "danger"}>
              {quiz.is_correct ? t("Correct") : t("Incorrect")}
            </Badge>
            {quiz.question_type ? (
              <Badge>{quiz.question_type}</Badge>
            ) : null}
            {quiz.assessment_type ? <Badge>{quiz.assessment_type}</Badge> : null}
          </div>
          <div className="text-[13px] leading-relaxed text-[var(--foreground)]">
            <MarkdownRenderer content={quiz.question} variant="compact" />
          </div>
          <p className="mt-1.5 text-[12px] text-[var(--muted-foreground)]">
            {t("Answers")}: <span className="text-[var(--foreground)]">{quiz.user_answer || t("No answer recorded.")}</span>
            {quiz.correct_answer ? (
              <>
                {" · "}
                {t("Correct")}:{" "}
                <span className="text-[var(--foreground)]">
                  {quiz.correct_answer}
                </span>
              </>
            ) : null}
          </p>
          {quiz.explanation ? (
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted-foreground)]">
              {quiz.explanation}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ErrorActivity({ turn }: { turn: ReviewTurn }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1.5" data-testid="review-errors">
      {turn.errors.map((error, index) => (
        <li
          key={`${error.code}-${index}`}
          className="rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/5 p-2 text-[12px] text-[var(--destructive)]"
        >
          {error.message}
          {error.code ? (
            <code className="ml-2 text-[11px] opacity-70">{error.code}</code>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function TurnActivity({ turn }: { turn: ReviewTurn }) {
  const { t } = useTranslation();
  const total =
    turn.counts.ask_user +
    turn.counts.tools +
    turn.counts.stages +
    turn.counts.quizzes +
    turn.counts.errors;
  if (total === 0) {
    return (
      <p className="mt-2 text-xs text-[var(--muted-foreground)]">
        {t("No activity recorded.")}
      </p>
    );
  }
  return (
    <details
      className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60"
      data-testid="review-turn-activity"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 text-xs text-[var(--muted-foreground)]">
        <ChevronDown size={13} />
        <span className="font-medium text-[var(--foreground)]">
          {t("Turn activity")}
        </span>
        {turn.counts.ask_user > 0 && (
          <Badge>
            <MessageSquareText size={11} /> {t("Questions")}:{" "}
            {turn.counts.ask_user}
          </Badge>
        )}
        {turn.counts.tools > 0 && (
          <Badge>
            <Wrench size={11} />{" "}
            {t("{{count}} tool calls", { count: turn.counts.tools })}
          </Badge>
        )}
        {turn.counts.quizzes > 0 && (
          <Badge tone={turn.counts.mistakes > 0 ? "danger" : "muted"}>
            <ListChecks size={11} /> {turn.counts.quizzes} {t("Quiz results")}
            {turn.counts.mistakes > 0
              ? ` · ${turn.counts.mistakes} ${t("Mistakes")}`
              : ""}
          </Badge>
        )}
        {turn.counts.errors > 0 && (
          <Badge tone="danger">
            <AlertTriangle size={11} /> {turn.counts.errors} {t("Errors")}
          </Badge>
        )}
      </summary>
      <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">
        {turn.ask_user.length > 0 && (
          <section>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <HelpCircle size={12} /> {t("Questions & answers")}
            </h4>
            <AskUserActivity exchanges={turn.ask_user} />
          </section>
        )}
        {turn.tool_calls.length > 0 && (
          <section>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <Wrench size={12} /> {t("Tool calls")}
            </h4>
            <ToolCallActivity turn={turn} />
          </section>
        )}
        {turn.stages.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {t("Stages")}
            </h4>
            <StageActivity turn={turn} />
          </section>
        )}
        {turn.quiz_results.length > 0 && (
          <section>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <ListChecks size={12} /> {t("Quiz results")}
            </h4>
            <QuizActivity results={turn.quiz_results} />
          </section>
        )}
        {turn.errors.length > 0 && (
          <section>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <AlertTriangle size={12} /> {t("Errors")}
            </h4>
            <ErrorActivity turn={turn} />
          </section>
        )}
        {turn.ask_user.length === 0 && turn.counts.ask_user > 0 && (
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("No questions were asked in this turn.")}
          </p>
        )}
        {turn.quiz_results.length === 0 && turn.counts.quizzes > 0 && (
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("No quiz results recorded.")}
          </p>
        )}
        {turn.tool_calls.length === 0 && turn.counts.tools > 0 && (
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("No tool calls recorded.")}
          </p>
        )}
      </div>
    </details>
  );
}

export function SessionReview({
  studentId,
  sessionId,
}: {
  studentId: string;
  sessionId: string;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<SessionReviewPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [search, setSearch] = useState("");
  const [activeTurn, setActiveTurn] = useState("");
  const turnRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- initial data load */
    let cancelled = false;
    setLoading(true);
    setError("");
    /* eslint-enable react-hooks/set-state-in-effect */
    void studentSessionReview(studentId, sessionId)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, sessionId]);

  const messagesById = useMemo(() => {
    const map = new Map<number, ReviewMessage>();
    for (const message of data?.messages ?? []) {
      if (message.role !== "system") map.set(message.id, message);
    }
    return map;
  }, [data]);

  const chatMessages = useMemo(
    () => [...messagesById.values()].map(toChatMessage),
    [messagesById],
  );
  const masteryGrades = useMemo(
    () => collectMasteryGrades(chatMessages),
    [chatMessages],
  );
  const masterySkips = useMemo(
    () => collectMasterySkips(chatMessages),
    [chatMessages],
  );
  const masteryAnswerRejections = useMemo(
    () => collectMasteryAnswerRejections(chatMessages),
    [chatMessages],
  );

  const filteredTurns = useMemo(() => {
    let turns = data?.turns ?? [];
    if (filter === "qa") turns = turns.filter((turn) => turn.counts.ask_user > 0);
    if (filter === "quiz")
      turns = turns.filter((turn) => turn.counts.quizzes > 0);
    const needle = search.trim().toLowerCase();
    if (needle) {
      turns = turns.filter((turn) =>
        turnSearchText(turn, messagesById).includes(needle),
      );
    }
    return turns;
  }, [data, filter, messagesById, search]);

  function jumpToTurn(turnId: string) {
    if (!turnId) return;
    setActiveTurn(turnId);
    const node = turnRefs.current[turnId];
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    window.setTimeout(() => {
      setActiveTurn((current) => (current === turnId ? "" : current));
    }, 1800);
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-[var(--muted-foreground)]">
        {t("Loading...")}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3 p-6">
        <Link
          href="/classroom"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft size={14} /> {t("Back to dashboard")}
        </Link>
        <p className="rounded-xl border border-[var(--destructive)]/40 bg-[var(--destructive)]/5 p-4 text-sm text-[var(--destructive)]">
          {error || t("This session could not be loaded.")}
        </p>
      </div>
    );
  }

  const context = data.context;
  const summary = data.summary;
  const filters: Array<{ key: ReviewFilter; label: string }> = [
    { key: "all", label: t("All activity") },
    { key: "qa", label: t("Questions & answers") },
    { key: "quiz", label: t("Quiz & mistakes") },
  ];

  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6"
      data-testid="session-review"
    >
      <Link
        href="/classroom"
        className="inline-flex w-fit items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        data-testid="review-back"
      >
        <ArrowLeft size={14} /> {t("Back to dashboard")}
      </Link>

      <header className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <h1
            className="font-serif text-xl font-semibold text-[var(--foreground)]"
            data-testid="review-student"
          >
            {context.student.username}
          </h1>
          <Badge>{t("Read-only review")}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
          <span data-testid="review-class">
            {t("Class")}:{" "}
            <span className="text-[var(--foreground)]">
              {context.class.name || "—"}
            </span>
          </span>
          <span data-testid="review-topic">
            {t("Topic")}:{" "}
            <span className="text-[var(--foreground)]">
              {context.topic.name || data.title || "—"}
            </span>
          </span>
          {data.title ? <span>{data.title}</span> : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge>
            {t("{{count}} turns", { count: summary.turns })}
          </Badge>
          <Badge>
            <MessageSquareText size={11} /> {t("Questions")}: {summary.ask_user}
          </Badge>
          <Badge tone={summary.mistakes > 0 ? "danger" : "muted"}>
            <ListChecks size={11} /> {summary.quizzes} {t("Quiz results")}
            {summary.mistakes > 0
              ? ` · ${summary.mistakes} ${t("Mistakes")}`
              : ""}
          </Badge>
          <Badge>
            <Wrench size={11} />{" "}
            {t("{{count}} tool calls", { count: summary.tools })}
          </Badge>
          {summary.errors > 0 && (
            <Badge tone="danger">
              <AlertTriangle size={11} /> {summary.errors} {t("Errors")}
            </Badge>
          )}
        </div>
      </header>

      <div className="sticky top-0 z-10 flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)]/95 p-2 shadow-sm backdrop-blur sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1" role="tablist">
          {filters.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={filter === entry.key}
              data-testid={`review-filter-${entry.key}`}
              onClick={() => setFilter(entry.key)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                filter === entry.key
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]/50 hover:text-[var(--foreground)]"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Search this session")}
            aria-label={t("Search this session")}
            data-testid="review-search"
            className="min-w-[160px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] sm:max-w-[260px]"
          />
          <select
            aria-label={t("Jump to turn")}
            value={activeTurn}
            onChange={(event) => jumpToTurn(event.target.value)}
            data-testid="review-jump"
            className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2 py-1.5 text-xs text-[var(--foreground)]"
          >
            <option value="">{t("Jump to turn")}</option>
            {filteredTurns.map((turn) => (
              <option key={turn.id} value={turn.id}>
                {t("Turn {{number}}", { number: turn.number })}
                {turn.capability
                  ? ` · ${t(getModeBadgeLabel(turn.capability))}`
                  : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-4" data-testid="review-transcript">
        {filteredTurns.length === 0 && (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm text-[var(--muted-foreground)]">
            {t("No turns match these filters.")}
          </p>
        )}
        {filteredTurns.map((turn) => {
          const turnMessages = turn.message_ids
            .map((messageId) => messagesById.get(messageId))
            .filter((message): message is ReviewMessage => Boolean(message));
          const isActive = activeTurn === turn.id;
          return (
            <section
              key={turn.id}
              ref={(node) => {
                turnRefs.current[turn.id] = node;
              }}
              data-testid={`review-turn-${turn.id}`}
              className={`rounded-xl border bg-[var(--secondary)]/40 p-3 transition-shadow sm:p-4 ${
                isActive
                  ? "border-[var(--primary)] shadow-[0_0_0_2px_var(--primary)]"
                  : "border-[var(--border)]"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-2">
                <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)]">
                  {t("Turn {{number}}", { number: turn.number })}
                </span>
                {turn.capability ? (
                  <Badge tone="primary">
                    {t(getModeBadgeLabel(turn.capability))}
                  </Badge>
                ) : null}
                <Badge tone={turn.status === "failed" ? "danger" : "muted"}>
                  {t(statusLabel(turn.status))}
                </Badge>
                {turn.duration !== null ? (
                  <Badge>
                    <Clock size={11} /> {formatDuration(turn.duration)}
                  </Badge>
                ) : null}
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  {turn.counts.ask_user > 0 && (
                    <Badge>
                      <MessageSquareText size={11} /> {turn.counts.ask_user}
                    </Badge>
                  )}
                  {turn.counts.quizzes > 0 && (
                    <Badge tone={turn.counts.mistakes > 0 ? "danger" : "muted"}>
                      <ListChecks size={11} /> {turn.counts.quizzes}
                    </Badge>
                  )}
                  {turn.counts.errors > 0 && (
                    <Badge tone="danger">
                      <AlertTriangle size={11} /> {turn.counts.errors}
                    </Badge>
                  )}
                </span>
              </div>

              {turnMessages.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {turnMessages.map((message, index) => {
                    const chatMessage = toChatMessage(message);
                    return message.role === "user" ? (
                      <div
                        key={message.id}
                        data-testid="review-user-message"
                        data-message-id={message.id}
                      >
                        <UserMessage
                          msg={chatMessage}
                          index={index}
                          showModeBadge={false}
                        />
                      </div>
                    ) : (
                      <div
                        key={message.id}
                        data-testid="review-assistant-message"
                        data-message-id={message.id}
                      >
                        <AssistantMessage
                          msg={chatMessage}
                          isStreaming={false}
                          sessionId={data.id}
                          readOnly
                          masteryGrades={masteryGrades}
                          masterySkips={masterySkips}
                          masteryAnswerRejections={masteryAnswerRejections}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[var(--muted-foreground)]">
                  {t("No activity recorded.")}
                </p>
              )}

              <TurnActivity turn={turn} />
            </section>
          );
        })}
      </div>
    </div>
  );
}