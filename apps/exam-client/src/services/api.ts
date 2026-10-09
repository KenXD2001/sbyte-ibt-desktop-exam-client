const API_BASE = import.meta.env.VITE_API_BASE_URL;

if (!API_BASE) {
  throw new Error('VITE_API_BASE_URL environment variable is required');
}

type ExtendedRequestInit = RequestInit & {
  /** Set a deterministic or caller-generated `Idempotency-Key` header. */
  idempotencyKey?: string;
};

/**
 * Generate a UUID v4-like client-correlation id used as the value for
 * the Stripe-style `Idempotency-Key` header. It is generated ONCE per
 * logical operation (start exam / submit answer / submit exam / etc.)
 * so retries due to network failures get a single retry token.
 *
 * For "exactly once per session" actions the id is computed
 * deterministically (e.g. `${sessionId}:submit-exam`) so duplicates
 * from WS + REST races collapse into the same key server-side and
 * produce a single side-effect.
 */
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function request<T>(
  endpoint: string,
  options: ExtendedRequestInit = {},
): Promise<T> {
  const token = localStorage.getItem("token");

  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Caller-supplied Idempotency-Key. If absent, fall back to a generated
  // UUID so server-side dedupe still works for all mutating endpoints.
  const { idempotencyKey, ...restOptions } = options;
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  } else if (!headers["Idempotency-Key"] && (options.method === undefined || ["POST", "PUT", "DELETE", "PATCH"].includes(options.method.toUpperCase()))) {
    headers["Idempotency-Key"] = uuid();
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...restOptions,
    headers,
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.message || `Request failed: ${res.status}`);
  }

  return json.data;
}

export interface KpiData {
  totalExams: number;
  upcoming: number;
  active: number;
  completed: number;
}

export interface UpcomingExam {
  id: number;
  examTitle: string;
  subjectName: string;
  examMode: string | null;
  examType: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
  duration: number;
  status: "scheduled" | "active" | "ended" | string;
}

export interface ExamInstructions {
  examTitle: string;
  examDescription: string;
  subjectName: string;
  examMode?: string;
  examType?: string;
  duration: number;
  totalQuestions: number;
  totalMarks: number;
  passingMarks: number;
  examInstructions: string;
  examInstructionImage?: string;
  randomizeQuestions?: boolean;
  randomizeOptions?: boolean;
  questionDirection?: string;
  tabSwitchDetection?: boolean;
  tabSwitchAction?: 'terminate' | 'pause';
  tabSwitchAutoSubmitLimit?: number;
  kioskMode?: boolean;
  deviceVerification?: boolean;
  webcamScreenStreaming?: boolean;
  webcamRecording?: boolean;
  screenRecording?: boolean;
}

export interface SessionData {
  sessionId: number;
  examStartedAt: string;
  status: string;
  isResumed?: boolean;
  tabSwitchDetection?: boolean;
  tabSwitchAction?: 'terminate' | 'pause';
  tabSwitchAutoSubmitLimit?: number;
}

export interface ExamSessionCheck {
  hasSession: boolean;
  alreadyAttempted?: boolean;
  sessionId?: number;
  examStartedAt?: string;
  status?: string;
  isResumed?: boolean;
  isPaused?: boolean;
  /** True when a proctor manually paused the session — entry is blocked. */
  isManuallyPaused?: boolean;
  reentryRequired?: boolean;
  reentryStatus?: string | null;
}

export interface QuestionOption {
  id: string;
  label: string;
  text: string;
}

export interface ExamQuestionData {
  id: number;
  questionNumber: number;
  questionType: string;
  /** Owning subject for multi-subject exams; null for legacy rows. */
  subjectId: number | null;
  questionText: string;
  correctOption: string | null;
  options: QuestionOption[];
  marks: number;
  negativeMarks: number;
  selectedAnswer: string | null;
  submitType: string | null;
}

export interface ExamSubjectInfo {
  id: number;
  code: string;
  name: string;
  /** Per-subject time budget in minutes (null = no per-subject limit). */
  allowedMinutes: number | null;
  questionCount: number;
}

export interface ExamSubjectProgress {
  subjectId: number;
  status: string;
  startedAt: string;
  endedAt: string | null;
  completedSections: string[];
}

export interface ExamSectionConfig {
  perSubjectTimeRestriction: boolean;
  sectionDirection: string;
  perSectionTimeRestriction: boolean;
  sectionTimes: {
    mcq: number | null;
    subjective: number | null;
  };
}

export interface SessionSubjects {
  examId: number;
  examTitle: string;
  subjects: ExamSubjectInfo[];
  progress: ExamSubjectProgress[];
  sectionConfig: ExamSectionConfig;
}

export interface SubjectSubmitResult {
  subjectId: number;
  status: string;
  allCompleted: boolean;
}

export interface SessionQuestions {
  sessionId: number;
  examId: number;
  examTitle: string;
  duration: number;
  examStartedAt: string;
  /** Allotted extra seconds (allocation ledger, legacy column fallback). */
  totalExtraSeconds?: number;
  candidateName: string;
  candidateRollNumber: string;
  questions: ExamQuestionData[];
  randomizeOptions?: boolean;
  /** Shuffle intent for questions (fallback when nav state is lost). */
  randomizeQuestions?: boolean;
  questionDirection?: string;
  tabSwitchDetection?: boolean;
  tabSwitchAction?: 'terminate' | 'pause';
  tabSwitchAutoSubmitLimit?: number;
  kioskMode?: boolean;
}

export interface AnswerResult {
  questionId: number;
  answer: string;
  submitType: string;
}

export type SubmitType = "normal_submit" | "marked_review";

export interface ReentryRequestResult {
  id: number;
  status: string;
  createdAt: string;
}

export interface VerificationStatus {
  idCardImageUrl: string | null;
  idCardBackImageUrl: string | null;
  webcamImageUrl: string | null;
  verified: boolean;
}

export interface VerificationUploadResult {
  idCardImageKey: string;
  idCardBackImageKey: string;
  webcamImageKey: string;
  idCardImageUrl: string | null;
  idCardBackImageUrl: string | null;
  webcamImageUrl: string | null;
}

export interface VerificationPhoto {
  /** Webcam photo as a data URL (same-origin safe for pixel reads). */
  image: string | null;
}

export interface ExamFlagResult {
  id: number;
  deduped: boolean;
}

// ─── My Results Types ───────────────────────────────────────────────────────

export interface CandidateResultSummary {
  obtainedMarks: number;
  totalMarks: number;
  percentage: number;
  grade: string | null;
  correctAnswers: number;
  incorrectAnswers: number;
  unanswered: number;
  answeredQuestions: number;
  totalQuestions: number;
  sessionStatus: string;
  submittedAt: string | null;
}

export interface MyResultRow {
  examId: number;
  examTitle: string;
  subjectName: string;
  totalMarks: number;
  passingMarks: number;
  sessionStatus: string | null;
  attemptedAt: string | null;
  /** "awaiting_result" until admin publishes; "published" once visible to candidate */
  resultStatus: "awaiting_result" | "published";
  publishedAt: string | null;
  result: CandidateResultSummary | null;
}

export interface MyResultDetail {
  examId: number;
  examTitle: string;
  subjectName: string;
  totalMarks: number;
  passingMarks: number;
  publishedAt: string;
  result: CandidateResultSummary;
}

// ─── Support Types ─────────────────────────────────────────────────────────

export interface SupportTicketAttachment {
  id: number;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileUrl: string;
}

export interface SupportTicketMessage {
  id: number;
  ticketId: number;
  senderRole: string;
  senderId: number;
  senderName: string;
  content: string;
  createdAt: string;
  attachments: SupportTicketAttachment[];
}

export interface SupportTicket {
  id: number;
  ticketId: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  createdByRole: string;
  createdById: number;
  createdByName: string;
  createdByEmail: string;
  assignedToId: number | null;
  examId: number | null;
  createdAt: string;
  updatedAt: string;
  messages: SupportTicketMessage[];
}

export const candidateExamApi = {
  getKpis: () => request<KpiData>("/candidate-exam/kpis"),

  getUpcomingExams: () => request<UpcomingExam[]>("/candidate-exam/upcoming"),

  getExamInstructions: (examId: number, opts?: { logView?: boolean }) =>
    request<ExamInstructions>(
      `/candidate-exam/${examId}/instructions${opts?.logView === false ? '?logView=false' : ''}`,
    ),

  getExamSession: (examId: number) =>
    request<ExamSessionCheck>(`/candidate-exam/${examId}/session`),

  startExam: (examId: number, data?: { ipAddress?: string; geoLocation?: string; userAgent?: string; platform?: string }) =>
    request<SessionData>(`/candidate-exam/${examId}/start`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),

  requestReentry: (examId: number) =>
    request<ReentryRequestResult>(`/candidate-exam/${examId}/reentry-request`, {
      method: "POST",
    }),

  getMyResults: () =>
    request<MyResultRow[]>("/candidate-exam/results"),

  getMyResultDetail: (examId: number) =>
    request<MyResultDetail>(`/candidate-exam/results/${examId}`),

  getSessionQuestions: (sessionId: number) =>
    request<SessionQuestions>(`/candidate-exam/session/${sessionId}/questions`),

  getSessionSubjects: (sessionId: number) =>
    request<SessionSubjects>(`/candidate-exam/session/${sessionId}/subjects`),

  startSubject: (sessionId: number, subjectId: number) =>
    request<ExamSubjectProgress>(`/candidate-exam/session/${sessionId}/subjects/${subjectId}/start`, {
      method: "POST",
    }),

  submitSubject: (sessionId: number, subjectId: number) =>
    request<SubjectSubmitResult>(`/candidate-exam/session/${sessionId}/subjects/${subjectId}/submit`, {
      method: "POST",
    }),

  submitSection: (sessionId: number, subjectId: number, sectionId: string) =>
    request<ExamSubjectProgress>(`/candidate-exam/session/${sessionId}/subjects/${subjectId}/sections`, {
      method: "POST",
      body: JSON.stringify({ sectionId }),
    }),

  getVerification: (sessionId: number) =>
    request<VerificationStatus>(`/candidate-exam/session/${sessionId}/verification`),

  getVerificationPhoto: (sessionId: number) =>
    request<VerificationPhoto>(`/candidate-exam/session/${sessionId}/verification-photo`),

  saveVerification: (sessionId: number, data: { idCardImage: string; idCardBackImage: string; webcamImage: string }) =>
    request<VerificationUploadResult>(`/candidate-exam/session/${sessionId}/verification`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  reportFlag: (
    sessionId: number,
    data: { flagTitle: string; triggeredBy?: string; cameraImage?: string; screenImage?: string },
  ) =>
    request<ExamFlagResult>(`/candidate-exam/session/${sessionId}/flags`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Background proof upload for an already-reported flag (single frame).
   * Fire-and-forget: the flag alert (toast + SFU + admin poll) never waits
   * on this — callers must swallow failures.
   */
  uploadFlagProof: (
    sessionId: number,
    flagId: number,
    data: { kind: "camera" | "screen"; image: string },
  ) =>
    request<{ flagId: number; queued: boolean }>(
      `/candidate-exam/session/${sessionId}/flags/${flagId}/proof`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),

  submitAnswer: (
    sessionId: number,
    questionId: number,
    answer: string,
    submitType: SubmitType = "normal_submit",
    nav?: { fromQuestionNumber?: number; toQuestionNumber?: number },
  ) =>
    request<AnswerResult>(`/candidate-exam/session/${sessionId}/answer`, {
      method: "POST",
      body: JSON.stringify({ questionId, answer, submitType, ...nav }),
    }),

  updateAnswer: (sessionId: number, questionId: number, answer: string, submitType: SubmitType = "normal_submit") =>
    request<AnswerResult>(`/candidate-exam/session/${sessionId}/answer`, {
      method: "PUT",
      body: JSON.stringify({ questionId, answer, submitType }),
    }),

  clearAnswer: (sessionId: number, questionId: number) =>
    request<void>(`/candidate-exam/session/${sessionId}/answer/${questionId}`, {
      method: "DELETE",
    }),

  /**
   * Fire-and-forget navigation events (Previous / question-panel jump /
   * unanswered move). Callers must swallow failures — logging never blocks
   * the exam UI.
   */
  logNavigation: (
    sessionId: number,
    payload: {
      activityType: "PREVIOUS" | "PANEL_JUMP" | "UNANSWERED_MOVE";
      questionId?: number;
      questionNumber?: number;
      fromQuestionNumber?: number;
      toQuestionNumber?: number;
    },
  ) =>
    request<{ logged: boolean }>(`/candidate-exam/session/${sessionId}/activities`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  submitExam: (sessionId: number, options: { signal?: AbortSignal } = {}) =>
    request<{ sessionId: number; status: string; examStartedAt: string; examEndedAt: string }>(
      `/candidate-exam/session/${sessionId}/submit`,
      {
        method: "POST",
        // Deterministic idempotency key per (sessionId, action) so concurrent
        // WS-driven submit + REST submit with the same key get one response.
        idempotencyKey: `exam-session-${sessionId}:submit`,
        ...options,
      },
    ),

  pauseExam: (sessionId: number) =>
    request<{ sessionId: number; status: string; examStartedAt: string }>(
      `/candidate-exam/session/${sessionId}/pause`,
      { method: "POST" },
    ),

  terminateExam: (sessionId: number) =>
    request<{ sessionId: number; status: string; examStartedAt: string; examEndedAt: string }>(
      `/candidate-exam/session/${sessionId}/terminate`,
      { method: "POST" },
    ),

  getRemainingTime: (sessionId: number) =>
    request<{ remainingTimeMs: number }>(
      `/candidate-exam/session/${sessionId}/remaining-time`,
    ),

  initializeHotSession: (sessionId: number, examId: number, durationMinutes: number) =>
    request<{ remainingTimeMs: number; endsAt: string; status: string }>(
      `/candidate-exam/session/${sessionId}/initialize-hot`,
      {
        method: "POST",
        body: JSON.stringify({ examId, durationMinutes }),
      },
    ),

  // ─── Support API ────────────────────────────────────────────────────────

  uploadFile: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<{ url: string; fileName: string; fileSize: number; fileType: string }>("/upload/file", {
      method: "POST",
      body: formData,
    });
  },

  createTicket: (data: {
    subject: string;
    description: string;
    category: string;
    priority: string;
    examId?: number;
    attachments?: { fileName: string; fileSize: number; fileType: string; fileUrl: string }[];
  }) =>
    request<SupportTicket>("/support/tickets", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getTickets: () =>
    request<SupportTicket[]>("/support/tickets"),

  getTicketDetail: (ticketId: string) =>
    request<SupportTicket>(`/support/tickets/${ticketId}`),

  addMessage: (ticketId: string, content: string, attachments?: { fileName: string; fileSize: number; fileType: string; fileUrl: string }[]) =>
    request<SupportTicketMessage>(`/support/tickets/${ticketId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, attachments }),
    }),
};

// ─── Live exam chat (proctor ↔ candidate) ────────────────────────────────────
// Socket-first when both are inside the exam room, DB-backed history otherwise.
// Every message is persisted; sent/delivered/seen ticks travel over the socket.

export interface ExamChatMessage {
  id: number;
  examId: number;
  senderId: string;
  recipientId: string;
  messageText: string;
  sent: boolean;
  delivered: boolean;
  seen: boolean;
  createdAt: string;
  updatedAt: string;
}

export const candidateChatApi = {
  send: (examId: number, recipientId: string, messageText: string) =>
    request<ExamChatMessage>(`/exam-chat/messages`, {
      method: "POST",
      body: JSON.stringify({ examId, recipientId, messageText }),
    }),

  history: (examId: number, peerId?: string, limit = 100) => {
    const params = new URLSearchParams({ examId: String(examId), limit: String(limit) });
    if (peerId) params.set("peerId", peerId);
    return request<ExamChatMessage[]>(`/exam-chat/history?${params.toString()}`);
  },

  markDelivered: (messageId: number) =>
    request<ExamChatMessage>(`/exam-chat/messages/${messageId}/delivered`, {
      method: "PATCH",
    }),

  markSeen: (messageId: number) =>
    request<ExamChatMessage>(`/exam-chat/messages/${messageId}/seen`, {
      method: "PATCH",
    }),

  markThreadSeen: (examId: number, peerId?: string) =>
    request<ExamChatMessage[]>(`/exam-chat/seen`, {
      method: "PATCH",
      body: JSON.stringify({ examId, peerId }),
    }),
};
