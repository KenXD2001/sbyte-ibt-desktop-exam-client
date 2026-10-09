// Shared domain types. Frontend + Rust structs must match these shapes.
// Add types only when two packages need them.

export type User = {
  id: string;
  email: string;
  displayName: string;
};

export type ExamStatus = "draft" | "scheduled" | "live" | "ended";

export type Exam = {
  id: string;
  title: string;
  status: ExamStatus;
  startsAt: string;
  endsAt: string;
};
