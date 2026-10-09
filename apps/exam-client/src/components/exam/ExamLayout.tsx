import { useEffect, useCallback, useState } from "react";
import { CandidateSidebar } from "./CandidateSidebar";
import { ExamHeader } from "./ExamHeader";
import { ExamFooter } from "./ExamFooter";
import { QuestionCard } from "./QuestionCard";
import { ProctorSidePanel, type ProctorChatMessage } from "./ProctorSidePanel";
import type { ExamSectionInfo, ExamSectionId } from "./ExamSections";
import type { ExamQuestion } from "@/types/exam";
import type { ConnectionStatus } from "@/hooks/useWebSocket";

type QuestionStatus = "current" | "answered" | "not-answered" | "marked-answered" | "marked-not-answered" | "not-viewed";

const SIDEBAR_STORAGE_KEY = "exam_sidebar_state";

interface ExamLayoutProps {
  examTitle: string;
  subjectName: string;
  candidateName: string;
  candidateRollNumber: string;
  questions: ExamQuestion[];
  currentQuestion: ExamQuestion | null;
  totalQuestions: number;
  progress: {
    answered: number;
    notAnswered: number;
    markedAnswered: number;
    markedNotAnswered: number;
    notViewed: number;
  };
  selectedOption: string | null;
  isMarkedForReview: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  formattedTime: string;
  isLowTime: boolean;
  isCriticalTime: boolean;
  connectionStatus: ConnectionStatus;
  isSaving: boolean;
  isMarking: boolean;
  getQuestionStatus: (questionNumber: number) => QuestionStatus;
  onSelectOption: (optionId: string) => void;
  onAnswerTextChange?: (text: string) => void;
  sessionId?: number;
  onPrevious: () => void;
  onClear: (questionNumber: number) => void;
  onMarkForReview: (questionNumber: number) => void;
  onSaveNext: () => void;
  onNext: () => void;
  onGoToQuestion: (questionNumber: number) => void;
  onSubmitExam: () => void;
  onViewInstructions: () => void;
  /** Normalized exam mode: "normal" | "manual-proctor" | "ai-proctor". Unknown/loading hides proctor panels. */
  examMode?: string | null;
  verificationImageUrl?: string | null;
  chatMessages?: ProctorChatMessage[];
  onSendChat?: (text: string) => void;
  /** MCQ/Subjective sections; block hidden when 0-1 sections. */
  sections?: ExamSectionInfo[];
  activeSectionId?: ExamSectionId;
  /** Restricted direction: only the active section is selectable. */
  sectionLocked?: boolean;
  onSelectSection?: (id: ExamSectionId) => void;
  /** Restricted mode: submit the active section to advance. */
  onSubmitSection?: () => void;
  submitSectionLabel?: string;
  submittingSection?: boolean;
  /** Unidirectional exams: palette jumps, bare Next, and Mark shortcut are disabled. */
  navigationLocked?: boolean;
}

export function ExamLayout({
  examTitle,
  subjectName,
  candidateName,
  candidateRollNumber,
  questions,
  currentQuestion,
  selectedOption,
  isMarkedForReview,
  hasPrev,
  hasNext,
  formattedTime,
  isLowTime,
  isCriticalTime,
  connectionStatus,
  isSaving,
  isMarking,
  getQuestionStatus,
  onSelectOption,
  onAnswerTextChange,
  sessionId,
  onPrevious,
  onClear,
  onMarkForReview,
  onSaveNext,
  onNext,
  onGoToQuestion,
  onSubmitExam,
  onViewInstructions,
  examMode = "normal",
  verificationImageUrl = null,
  chatMessages = [],
  onSendChat,
  sections = [],
  activeSectionId = "mcq",
  sectionLocked = false,
  onSelectSection,
  onSubmitSection,
  submitSectionLabel,
  submittingSection = false,
  navigationLocked = false,
}: ExamLayoutProps) {
  // Persist the exam sidebar open/close state so a candidate refresh keeps it.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored !== null) return stored === "true";
    } catch {
      // ignore storage access errors (e.g. privacy mode)
    }
    return true;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarOpen));
    } catch {
      // ignore storage access errors (e.g. privacy mode)
    }
  }, [sidebarOpen]);

  const normalizedMode = (examMode || "").toLowerCase();
  const isProctored = normalizedMode !== "" && normalizedMode !== "normal";
  const [proctorPanelOpen, setProctorPanelOpen] = useState(true);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (hasPrev) onPrevious();
          break;
        case "ArrowRight":
          e.preventDefault();
          if (hasNext && !navigationLocked) onNext();
          break;
        case "a":
        case "A":
        case "1":
          if (currentQuestion?.questionType !== "subjective" && currentQuestion?.options[0]) onSelectOption(currentQuestion.options[0].id);
          break;
        case "b":
        case "B":
        case "2":
          if (currentQuestion?.questionType !== "subjective" && currentQuestion?.options[1]) onSelectOption(currentQuestion.options[1].id);
          break;
        case "c":
        case "C":
        case "3":
          if (currentQuestion?.questionType !== "subjective" && currentQuestion?.options[2]) onSelectOption(currentQuestion.options[2].id);
          break;
        case "d":
        case "D":
        case "4":
          if (currentQuestion?.questionType !== "subjective" && currentQuestion?.options[3]) onSelectOption(currentQuestion.options[3].id);
          break;
        case "m":
        case "M":
          if (currentQuestion && !navigationLocked) onMarkForReview(currentQuestion.questionNumber);
          break;
      }
    },
    [currentQuestion, hasPrev, hasNext, onPrevious, onNext, onSelectOption, onMarkForReview, navigationLocked],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30">
      <CandidateSidebar
        open={sidebarOpen}
        currentQuestionNumber={currentQuestion?.questionNumber ?? 1}
        questions={questions}
        candidateName={candidateName}
        candidateRollNumber={candidateRollNumber}
        getQuestionStatus={getQuestionStatus}
        onQuestionClick={onGoToQuestion}
        onViewInstructions={onViewInstructions}
        onToggle={() => setSidebarOpen((v) => !v)}
        showIdentity={isProctored}
        verificationImageUrl={verificationImageUrl}
        sections={sections}
        activeSectionId={activeSectionId}
        sectionLocked={sectionLocked}
        onSelectSection={onSelectSection}
        onSubmitSection={onSubmitSection}
        submitSectionLabel={submitSectionLabel}
        submittingSection={submittingSection}
        navigatorDisabled={navigationLocked}
      />

      <main className="flex flex-1 flex-col gap-2 p-2 overflow-hidden min-w-0">
        <ExamHeader
          examTitle={examTitle}
          subjectName={subjectName}
          formattedTime={formattedTime}
          isLowTime={isLowTime}
          isCriticalTime={isCriticalTime}
          connectionStatus={connectionStatus}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onSubmitExam={onSubmitExam}
          submitLabel={onSubmitSection ? submitSectionLabel : undefined}
          showProctorToggle={isProctored}
          proctorPanelOpen={proctorPanelOpen}
          onToggleProctorPanel={() => setProctorPanelOpen((v) => !v)}
        />

        {currentQuestion ? (
          <QuestionCard
            question={currentQuestion}
            selectedOption={selectedOption}
            onSelectOption={onSelectOption}
            onAnswerTextChange={onAnswerTextChange}
            sessionId={sessionId}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
            No questions available
          </div>
        )}

        <ExamFooter
          hasPrev={hasPrev}
          hasNext={hasNext}
          isMarkedForReview={isMarkedForReview}
          selectedOption={selectedOption}
          isSaving={isSaving}
          isMarking={isMarking}
          navigationLocked={navigationLocked}
          onPrevious={onPrevious}
          onClear={() => currentQuestion && onClear(currentQuestion.questionNumber)}
          onMarkForReview={() => currentQuestion && onMarkForReview(currentQuestion.questionNumber)}
          onSaveNext={onSaveNext}
        />
      </main>

      {isProctored && (
        <ProctorSidePanel
          open={proctorPanelOpen}
          messages={chatMessages}
          onSend={(text) => onSendChat?.(text)}
          onToggle={() => setProctorPanelOpen((v) => !v)}
        />
      )}
    </div>
  );
}
