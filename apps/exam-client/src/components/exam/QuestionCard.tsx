import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { OptionCard } from "./OptionCard";
import { SubjectiveAnswer } from "./SubjectiveAnswer";
import type { ExamQuestion } from "@/types/exam";

interface QuestionCardProps {
  question: ExamQuestion;
  selectedOption: string | null;
  onSelectOption: (optionId: string) => void;
  /** Typed answer for subjective questions (same backing store as selectedOption). */
  onAnswerTextChange?: (text: string) => void;
  sessionId?: number;
}

export function QuestionCard({
  question,
  selectedOption,
  onSelectOption,
  onAnswerTextChange,
  sessionId,
}: QuestionCardProps) {
  const { examId } = useParams<{ examId: string }>();
  const isSubjective = question.questionType === "subjective";

  return (
    <div className="flex-1 overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="h-full overflow-y-auto">
        <div className="flex flex-col gap-5 p-5">
          <div className="flex items-center gap-3 pb-2 border-b">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Question</span>
              <span className="text-sm font-semibold tabular-nums">
                {question.displayNumber ?? question.questionNumber}
              </span>
            </div>
            <div className="h-4 w-px bg-border" />
            <Badge variant="secondary" className="text-[10px] px-2 py-0 h-5 uppercase">
              {question.questionType}
            </Badge>
          </div>

          <div
            className="text-sm leading-relaxed text-foreground [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-2 [&_p]:my-1"
            dangerouslySetInnerHTML={{ __html: question.questionText }}
          />

          {question.imageUrl && (
            <div className="overflow-hidden rounded-lg border bg-muted/30">
              <img
                src={question.imageUrl}
                alt=""
                className="h-auto max-w-full object-contain"
              />
            </div>
          )}

          {isSubjective ? (
            <SubjectiveAnswer
              key={question.id}
              questionId={question.id}
              questionNumber={question.questionNumber}
              displayNumber={question.displayNumber}
              examId={examId}
              sessionId={sessionId}
              answerText={selectedOption ?? ""}
              onAnswerTextChange={(text) => onAnswerTextChange?.(text)}
            />
          ) : (
            <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Answer options">
              {question.options.map((option) => (
                <OptionCard
                  key={option.id}
                  option={option}
                  selected={selectedOption === option.id}
                  disabled={false}
                  onSelect={onSelectOption}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
