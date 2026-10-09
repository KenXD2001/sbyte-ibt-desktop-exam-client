export interface ExamOption {
  id: string;
  label: string;
  text: string;
}

export interface ExamQuestion {
  id: number;
  questionNumber: number;
  /** Display-only number within its section (MCQ 1..N, Subjective 1..M). Identity stays questionNumber. */
  displayNumber?: number;
  questionType: "mcq" | "subjective";
  sectionName: string;
  /** Owning subject for multi-subject exams; null for legacy rows. */
  subjectId?: number | null;
  questionText: string;
  options: ExamOption[];
  marks: number;
  negativeMarks: number;
  imageUrl?: string;
  selectedAnswer?: string | null;
  submitType?: string | null;
  correctOption?: string | null;
}

export interface ExamData {
  id: number;
  title: string;
  description: string;
  duration: number;
  startDateTime: string;
  endDateTime: string;
  questions: ExamQuestion[];
  currentStatus: string;
  candidateName: string;
  candidateRollNumber: string;
  subjectName: string;
}
