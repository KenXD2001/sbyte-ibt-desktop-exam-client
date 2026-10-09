import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import AuthLayout from "@/components/layouts/AuthLayout";
import { MainLayout } from "@/components/layouts/MainLayout";
import LoginPage from "@/pages/auth/LoginPage";
import MyExamsPage from "@/pages/MyExamsPage";
import MyResultsPage from "@/pages/MyResultsPage";
import SupportPage from "@/pages/SupportPage";
import ExamPage from "@/pages/ExamPage";
import InstructionsPage from "@/pages/exam/InstructionsPage";
import SubjectsPage from "@/pages/exam/SubjectsPage";
import VerificationPage from "@/pages/exam/VerificationPage";
import ResultPage from "@/pages/exam/ResultPage";
import { useAuth } from "@/hooks/useAuth";
import { ExamSessionProvider } from "@/contexts/ExamSessionContext";
import { ProctorMediaProvider } from "@/contexts/ProctorMediaContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        !/429|too many requests/i.test(
          error instanceof Error ? error.message : String(error),
        ) && failureCount < 3,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/my-exams" replace />;
  }

  return <>{children}</>;
}

function ExamSessionLayout() {
  const { examId } = useParams<{ examId: string }>();
  return (
    <ProtectedRoute>
      <ExamSessionProvider initialExamId={examId ? Number(examId) : undefined}>
        <ProctorMediaProvider>
          <Outlet />
        </ProctorMediaProvider>
      </ExamSessionProvider>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/auth"
              element={
                <PublicRoute>
                  <AuthLayout>
                    <LoginPage />
                  </AuthLayout>
                </PublicRoute>
              }
            />
            <Route
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/my-exams" element={<MyExamsPage />} />
              <Route path="/my-results" element={<MyResultsPage />} />
              <Route path="/support" element={<SupportPage />} />
            </Route>
            <Route path="/exam/:examId" element={<ExamSessionLayout />}>
              <Route path="instructions" element={<InstructionsPage />} />
              <Route path="subjects" element={<SubjectsPage />} />
              <Route path="verify" element={<VerificationPage />} />
              <Route path="take" element={<ExamPage />} />
              <Route path="result" element={<ResultPage />} />
              <Route index element={<Navigate to="instructions" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/my-exams" replace />} />
          </Routes>
          <Toaster
            position="top-right"
            duration={2000}
            swipeDirections={["right"]}
            expand
            visibleToasts={4}
            gap={12}
          />
        </QueryClientProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
