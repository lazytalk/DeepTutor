"use client";

import { useParams } from "next/navigation";

import { StudentRecord } from "@/features/classroom/components/StudentRecord";

export default function ClassroomStudentRecordPage() {
  const params = useParams<{ studentId: string }>();

  return <StudentRecord studentId={String(params.studentId || "")} />;
}