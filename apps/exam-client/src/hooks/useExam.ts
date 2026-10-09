import { useState, useCallback, useMemo, useEffect } from "react";
import type { ExamQuestion } from "@/types/exam";

export interface ExamState {
  currentQuestionIndex: number;
  selections: Record<number, string>;
  submittedAnswers: Record<number, string>;
  markedForReview: Set<number>;
  visitedQuestions: Set<number>;
}

export function useExam(questions: ExamQuestion[]) {
  const [state, setState] = useState<ExamState>(() => {
    const initial: Record<number, string> = {};
    const initialMarked: number[] = [];
    for (const q of questions) {
      if (q.selectedAnswer) {
        initial[q.questionNumber] = q.selectedAnswer;
      }
      if (q.submitType === "marked_review") {
        initialMarked.push(q.questionNumber);
      }
    }
    return {
      currentQuestionIndex: 0,
      selections: { ...initial },
      submittedAnswers: { ...initial },
      markedForReview: new Set(initialMarked),
      visitedQuestions: new Set(
        questions
          .filter((q) => q.selectedAnswer)
          .map((q) => q.questionNumber)
          .concat(questions[0]?.questionNumber ?? [])
          .filter(Boolean),
      ),
    };
  });

  // Sync selectedAnswer from server when questions load asynchronously.
  // useState initializer only runs once, so when questions arrive after mount
  // (e.g. session fetched via API), we need to populate pre-existing answers.
  useEffect(() => {
    setState((prev) => {
      let changed = false;
      const selections = { ...prev.selections };
      const submittedAnswers = { ...prev.submittedAnswers };
      const visitedQuestions = new Set(prev.visitedQuestions);
      const markedForReview = new Set(prev.markedForReview);
      for (const q of questions) {
        if (q.submitType === "marked_review" && !markedForReview.has(q.questionNumber)) {
          markedForReview.add(q.questionNumber);
          changed = true;
        }
        if (!q.selectedAnswer) continue;
        if (selections[q.questionNumber] || submittedAnswers[q.questionNumber]) continue;
        selections[q.questionNumber] = q.selectedAnswer;
        submittedAnswers[q.questionNumber] = q.selectedAnswer;
        visitedQuestions.add(q.questionNumber);
        changed = true;
      }
      if (!changed) return prev;
      return { ...prev, selections, submittedAnswers, visitedQuestions, markedForReview };
    });
  }, [questions]);

  const currentQuestion = questions[state.currentQuestionIndex];
  const totalQuestions = questions.length;
  const hasNext = state.currentQuestionIndex < totalQuestions - 1;
  const hasPrev = state.currentQuestionIndex > 0;

  const getQuestionStatus = useCallback(
    (questionNumber: number) => {
      const isCurrent = questions[state.currentQuestionIndex]?.questionNumber === questionNumber;
      const isVisited = state.visitedQuestions.has(questionNumber);
      const isMarked = state.markedForReview.has(questionNumber);
      const isAnswered = !!state.submittedAnswers[questionNumber];

      if (isCurrent) return "current";
      if (isMarked && isAnswered) return "marked-answered";
      if (isMarked && !isAnswered) return "marked-not-answered";
      if (isAnswered) return "answered";
      if (!isVisited) return "not-viewed";
      return "not-answered";
    },
    [state.currentQuestionIndex, state.visitedQuestions, state.markedForReview, state.submittedAnswers, questions],
  );

  const progress = useMemo(() => {
    let answered = 0;
    let notAnswered = 0;
    let markedAnswered = 0;
    let markedNotAnswered = 0;
    let notViewed = 0;

    for (const q of questions) {
      const qn = q.questionNumber;
      const isMarked = state.markedForReview.has(qn);
      const isAnswered = !!state.submittedAnswers[qn];
      if (!state.visitedQuestions.has(qn) && !isAnswered) {
        notViewed++;
      } else if (isMarked && isAnswered) {
        markedAnswered++;
      } else if (isMarked && !isAnswered) {
        markedNotAnswered++;
      } else if (isAnswered) {
        answered++;
      } else {
        notAnswered++;
      }
    }

    return { answered, notAnswered, markedAnswered, markedNotAnswered, notViewed };
  }, [questions, state]);

  const selectOption = useCallback((questionNumber: number, optionId: string) => {
    setState((prev) => ({
      ...prev,
      selections: { ...prev.selections, [questionNumber]: optionId },
    }));
  }, []);

  const confirmSubmission = useCallback((questionNumber: number, optionId: string) => {
    setState((prev) => ({
      ...prev,
      submittedAnswers: { ...prev.submittedAnswers, [questionNumber]: optionId },
      selections: { ...prev.selections, [questionNumber]: optionId },
    }));
  }, []);

  const clearResponse = useCallback((questionNumber: number) => {
    setState((prev) => {
      const newSelections = { ...prev.selections };
      delete newSelections[questionNumber];
      const newSubmitted = { ...prev.submittedAnswers };
      delete newSubmitted[questionNumber];
      return { ...prev, selections: newSelections, submittedAnswers: newSubmitted };
    });
  }, []);

  const toggleMarkForReview = useCallback((questionNumber: number) => {
    setState((prev) => {
      const newMarked = new Set(prev.markedForReview);
      if (newMarked.has(questionNumber)) {
        newMarked.delete(questionNumber);
      } else {
        newMarked.add(questionNumber);
      }
      return { ...prev, markedForReview: newMarked };
    });
  }, []);

  const goToQuestion = useCallback((questionNumber: number) => {
    const index = questions.findIndex((q) => q.questionNumber === questionNumber);
    if (index === -1) return;
    setState((prev) => ({
      ...prev,
      currentQuestionIndex: index,
      visitedQuestions: new Set([...prev.visitedQuestions, questionNumber]),
    }));
  }, [questions]);

  const navigateNext = useCallback(() => {
    setState((prev) => {
      if (prev.currentQuestionIndex >= questions.length - 1) return prev;
      const nextIndex = prev.currentQuestionIndex + 1;
      const nextQn = questions[nextIndex].questionNumber;
      return {
        ...prev,
        currentQuestionIndex: nextIndex,
        visitedQuestions: new Set([...prev.visitedQuestions, nextQn]),
      };
    });
  }, [questions]);

  const navigatePrev = useCallback(() => {
    setState((prev) => {
      if (prev.currentQuestionIndex <= 0) return prev;
      return { ...prev, currentQuestionIndex: prev.currentQuestionIndex - 1 };
    });
  }, []);

  const isMarkedForReview = currentQuestion
    ? state.markedForReview.has(currentQuestion.questionNumber)
    : false;

  const selectedOption = currentQuestion
    ? state.selections[currentQuestion.questionNumber] ??
      state.submittedAnswers[currentQuestion.questionNumber] ??
      null
    : null;

  return {
    currentQuestion,
    currentQuestionIndex: state.currentQuestionIndex,
    totalQuestions,
    hasNext,
    hasPrev,
    selections: state.selections,
    submittedAnswers: state.submittedAnswers,
    markedForReview: state.markedForReview,
    visitedQuestions: state.visitedQuestions,
    progress,
    selectedOption,
    isMarkedForReview,
    getQuestionStatus,
    selectOption,
    confirmSubmission,
    clearResponse,
    toggleMarkForReview,
    goToQuestion,
    navigateNext,
    navigatePrev,
  };
}