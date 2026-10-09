import { useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { BarChart3, Award, TrendingUp, TrendingDown, Eye } from "lucide-react"

import { StatusBadge } from "@/components/ui/status-badges"
import { DataTable } from "@/components/shared/data-table"
import StatCard from "@/components/shared/stat-card"
import PageHeader from "@/components/shared/page-header"
import { useSetBreadcrumbs } from "@/hooks/useBreadcrumbs"
import { useMyResults } from "@/hooks/queries/use-results"
import type { MyResultRow } from "@/services/api"

const formatPercentage = (value: number) => `${Math.round(value * 100) / 100}%`

const formatDate = (value: string | null) => {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

function buildKpis(results: MyResultRow[]) {
  const published = results.filter((r) => r.resultStatus === "published" && r.result)

  if (published.length === 0) {
    return [
      { title: "Average Score", value: "-", icon: Award },
      { title: "Best Score", value: "-", icon: TrendingUp },
      { title: "Lowest Score", value: "-", icon: TrendingDown },
      { title: "Results Published", value: "0", icon: BarChart3 },
    ]
  }

  const percentages = published.map((r) => r.result!.percentage)
  const avg = percentages.reduce((sum, p) => sum + p, 0) / percentages.length
  const best = Math.max(...percentages)
  const lowest = Math.min(...percentages)

  return [
    { title: "Average Score", value: formatPercentage(avg), icon: Award },
    { title: "Best Score", value: formatPercentage(best), icon: TrendingUp },
    { title: "Lowest Score", value: formatPercentage(lowest), icon: TrendingDown },
    { title: "Results Published", value: String(published.length), icon: BarChart3 },
  ]
}

function GradePill({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-muted-foreground">-</span>
  const isPass = grade.toLowerCase() === "pass"
  return (
    <span
      className={
        isPass
          ? "inline-flex items-center justify-center rounded-md border bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700"
          : "inline-flex items-center justify-center rounded-md border bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"
      }
    >
      {grade}
    </span>
  )
}

export default function MyResultsPage() {
  useSetBreadcrumbs([{ label: "General" }, { label: "My Results" }])
  const { data: results, isLoading, isError, refetch } = useMyResults()
  const [activeExamId, setActiveExamId] = useState<number | null>(null)

  const rows = results ?? []
  const kpiCards = buildKpis(rows)
  const publishedCount = rows.filter((r) => r.resultStatus === "published").length
  const awaitingCount = rows.filter((r) => r.resultStatus === "awaiting_result").length

  const activeRow = activeExamId != null ? rows.find((r) => r.examId === activeExamId) : null

  const columns: ColumnDef<MyResultRow>[] = [
    {
      accessorKey: "examTitle",
      header: "Exam",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.examTitle || "-"}</span>
      ),
    },
    {
      accessorKey: "subjectName",
      header: "Subject",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.subjectName || "-"}</span>
      ),
    },
    {
      accessorKey: "attemptedAt",
      header: "Attempted On",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{formatDate(row.original.attemptedAt)}</span>
      ),
    },
    {
      id: "score",
      header: "Score",
      accessorFn: (row) =>
        row.resultStatus === "published" && row.result
          ? `${row.result.obtainedMarks}/${row.result.totalMarks}`
          : "—",
      cell: ({ row }) => {
        const isPublished = row.original.resultStatus === "published"
        const r = row.original.result
        return (
          <span className={isPublished ? "text-muted-foreground" : "text-muted-foreground/60"}>
            {isPublished && r ? `${r.obtainedMarks}/${r.totalMarks}` : "—"}
          </span>
        )
      },
    },
    {
      id: "percentage",
      header: "Percentage",
      accessorFn: (row) =>
        row.resultStatus === "published" && row.result
          ? formatPercentage(row.result.percentage)
          : "—",
      cell: ({ row }) => {
        const isPublished = row.original.resultStatus === "published"
        const r = row.original.result
        return (
          <span className={isPublished ? "font-semibold" : "text-muted-foreground/60"}>
            {isPublished && r ? formatPercentage(r.percentage) : "—"}
          </span>
        )
      },
    },
    {
      id: "grade",
      header: "Grade",
      accessorFn: (row) => row.result?.grade ?? "—",
      cell: ({ row }) => {
        const isPublished = row.original.resultStatus === "published"
        const r = row.original.result
        if (isPublished && r) return <GradePill grade={r.grade} />
        return <span className="text-muted-foreground">—</span>
      },
    },
    {
      accessorKey: "resultStatus",
      header: "Status",
      cell: ({ row }) => {
        const result = row.original
        if (result.resultStatus !== "published") {
          return <StatusBadge variant="pending">Awaiting Result</StatusBadge>
        }
        return (
          <span className="inline-flex items-center gap-2">
            <StatusBadge variant="completed">Published</StatusBadge>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setActiveExamId((prev) => (prev === result.examId ? null : result.examId))}
              aria-label="Toggle result detail"
            >
              <Eye className="h-3.5 w-3.5" />
              {activeExamId === result.examId ? "Hide" : "View"}
            </button>
          </span>
        )
      },
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="My Results"
        description="View your exam scores, grades, and performance analytics"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((stat) => (
          <StatCard
            key={stat.title}
            title={stat.title}
            value={stat.value}
            icon={stat.icon}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary" />
          {publishedCount} published
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-yellow-400" />
          {awaitingCount} awaiting
        </span>
      </div>

      <DataTable
        title="Exam Results"
        description="Browse your exam outcomes, scores, and grades. Results appear here once published by the administrator."
        columns={columns}
        data={rows}
        loading={isLoading}
        error={isError ? "Failed to load results. Please try again after some time. later." : null}
        onRetry={() => refetch()}
        emptyMessage="You have not attempted any exams yet. Your results will appear here once available."
        searchPlaceholder="Search results..."
      />

      {activeRow && activeRow.result && (
        <div className="rounded-xl border bg-card px-6 py-4 shadow-sm">
          <h3 className="text-sm font-semibold">{activeRow.examTitle} — Detailed Breakdown</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Published on {formatDate(activeRow.publishedAt)}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Total Questions</div>
              <div className="mt-1 text-sm font-medium">{activeRow.result.totalQuestions}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Answered</div>
              <div className="mt-1 text-sm font-medium">{activeRow.result.answeredQuestions}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Correct</div>
              <div className="mt-1 text-sm font-medium text-green-600">{activeRow.result.correctAnswers}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Incorrect</div>
              <div className="mt-1 text-sm font-medium text-red-600">{activeRow.result.incorrectAnswers}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Unanswered</div>
              <div className="mt-1 text-sm font-medium">{activeRow.result.unanswered}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Passing Marks</div>
              <div className="mt-1 text-sm font-medium">{activeRow.passingMarks || "-"}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
