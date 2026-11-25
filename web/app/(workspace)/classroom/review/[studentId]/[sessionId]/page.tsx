"use client";

import { useParams } from "next/navigation";

import { SessionReview } from "@/features/classroom/components/SessionReview";

export default function ClassroomSessionReviewPage() {
  const params = useParams<{ studentId: string; sessionId: string }>();

  return (
    <SessionReview
      studentId={String(params.studentId || "")}
      sessionId={String(params.sessionId || "")}
    />
  );
}