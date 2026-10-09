import { Button } from "@/components/ui/button";
import { QuestionNavigator } from "./QuestionNavigator";
import { ExamSections, type ExamSectionInfo, type ExamSectionId } from "./ExamSections";
import type { ExamQuestion } from "@/types/exam";
import { Eye, User } from "lucide-react";
import { cn } from "@/lib/utils";

type QuestionStatus = "current" | "answered" | "not-answered" | "marked-answered" | "marked-not-answered" | "not-viewed";

interface CandidateSidebarProps {
  open: boolean;
  currentQuestionNumber: number;
  questions: ExamQuestion[];
  candidateName: string;
  candidateRollNumber: string;
  getQuestionStatus: (questionNumber: number) => QuestionStatus;
  onQuestionClick: (questionNumber: number) => void;
  onViewInstructions: () => void;
  onToggle: () => void;
  /** Normal mode hides the identity photo; manual/AI proctor show the verification capture. */
  showIdentity?: boolean;
  /** Webcam capture image taken during verification (proctored modes). */
  verificationImageUrl?: string | null;
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
  /** Unidirectional exams: palette is display-only, all jumps disabled. */
  navigatorDisabled?: boolean;
}

export function CandidateSidebar({
  open,
  currentQuestionNumber,
  questions,
  candidateName,
  candidateRollNumber,
  getQuestionStatus,
  onQuestionClick,
  onViewInstructions,
  onToggle,
  showIdentity = true,
  verificationImageUrl = null,
  sections = [],
  activeSectionId = "mcq",
  sectionLocked = false,
  onSelectSection,
  onSubmitSection,
  submitSectionLabel,
  submittingSection = false,
  navigatorDisabled = false,
}: CandidateSidebarProps) {

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        className={cn(
          "flex flex-col border-r bg-card w-60",
          "fixed inset-y-0 left-0 z-50",
          "lg:static lg:z-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          "transition-transform duration-300 lg:transition-none",
        )}
      >
        {showIdentity ? (
          <div className="flex flex-col items-center gap-3 border-b px-3 py-3">
            {/* Verification capture — static webcam photo from verification (live feed lives in the right panel) */}
            <div className="relative w-full aspect-[4/3] overflow-hidden rounded-lg border bg-black flex items-center justify-center">
              {verificationImageUrl ? (
                <img
                  src={verificationImageUrl}
                  alt="Candidate verification photo"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-muted/50">
                  <User className="size-8 text-muted-foreground/50" strokeWidth={1.5} />
                  <span className="text-[10px] text-muted-foreground">Verification photo</span>
                </div>
              )}
            </div>
            <div className="flex flex-col items-center gap-0.5 text-center w-full">
              <span className="text-sm font-semibold leading-tight line-clamp-1">
                {candidateName || " "}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {candidateRollNumber ? `App No: ${candidateRollNumber}` : " "}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5 border-b px-3 py-3 text-center w-full">
            <span className="text-sm font-semibold leading-tight line-clamp-1">
              {candidateName || " "}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {candidateRollNumber ? `App No: ${candidateRollNumber}` : " "}
            </span>
          </div>
        )}

        {sections.length > 1 && onSelectSection && (
          <ExamSections
            sections={sections}
            activeId={activeSectionId}
            locked={sectionLocked}
            onSelect={onSelectSection}
            onSubmitSection={onSubmitSection}
            submitLabel={submitSectionLabel}
            submitting={submittingSection}
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          <QuestionNavigator
            questions={questions}
            currentQuestionNumber={currentQuestionNumber}
            getQuestionStatus={getQuestionStatus}
            disabled={navigatorDisabled}
            onQuestionClick={(qn) => {
              onQuestionClick(qn);
              onToggle();
            }}
          />
        </div>

        <div className="shrink-0 p-2.5 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5 text-xs"
            onClick={onViewInstructions}
          >
            <Eye className="size-3.5" />
            View Instructions
          </Button>
        </div>
      </aside>
    </>
  );
}
