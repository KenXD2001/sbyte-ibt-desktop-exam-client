import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { ClipboardList, Clock, CheckCircle, PlayCircle, Play } from "lucide-react"

import { ExamLifecycleStatusBadge } from "@/components/shared/status-badges"
import { DataTable } from "@/components/shared/data-table"
import { Button } from "@/components/ui/button"
import StatCard from "@/components/shared/stat-card"
import PageHeader from "@/components/shared/page-header"
import { useSetBreadcrumbs } from "@/hooks/useBreadcrumbs"
import { candidateExamApi, type KpiData, type UpcomingExam } from "@/services/api"

const formatDateTime = (value: string | null) => {
  if (!value) return "--"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "--"
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

export default function MyExamsPage() {
  useSetBreadcrumbs([{ label: "General" }, { label: "My Exams" }])
  const navigate = useNavigate()
  const [kpis, setKpis] = useState<KpiData | null>(null)
  const [exams, setExams] = useState<UpcomingExam[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    Promise.all([
      candidateExamApi.getKpis(),
      candidateExamApi.getUpcomingExams(),
    ])
      .then(([kpiData, examData]) => {
        setKpis(kpiData)
        setExams(examData)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  const handleStartExam = (examId: number) => {
    // Desktop shell has no new tabs — open the exam flow in this window.
    navigate(`/exam/${examId}/instructions`)
  }

  const kpiCards = [
    { title: "Total Exams", value: kpis?.totalExams ?? "-", icon: ClipboardList },
    { title: "Upcoming", value: kpis?.upcoming ?? "-", icon: Clock },
    { title: "Active", value: kpis?.active ?? "-", icon: PlayCircle },
    { title: "Completed", value: kpis?.completed ?? "-", icon: CheckCircle },
  ]

  const columns: ColumnDef<UpcomingExam>[] = [
    {
      accessorKey: "examTitle",
      header: "Title",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.examTitle}</span>
      ),
    },
    {
      accessorKey: "subjectName",
      header: "Subject",
      accessorFn: (row) => row.subjectName ?? "--",
      cell: ({ row }) => (
        <span>{row.original.subjectName ?? "--"}</span>
      ),
    },
    {
      id: "examMode",
      header: "Exam Mode",
      accessorFn: (row) => row.examMode ?? "--",
      cell: ({ row }) => (
        <span className="capitalize">{row.original.examMode ?? "--"}</span>
      ),
    },
    {
      id: "examType",
      header: "Exam Type",
      accessorFn: (row) => row.examType ?? "--",
      cell: ({ row }) => (
        <span className="capitalize">{row.original.examType ?? "--"}</span>
      ),
    },
    {
      accessorKey: "startDateTime",
      header: "Start Date & Time",
      accessorFn: (row) => row.startDateTime ?? "",
      cell: ({ row }) => (
        <span>{formatDateTime(row.original.startDateTime)}</span>
      ),
    },
    {
      accessorKey: "endDateTime",
      header: "End Date & Time",
      accessorFn: (row) => row.endDateTime ?? "",
      cell: ({ row }) => (
        <span>{formatDateTime(row.original.endDateTime)}</span>
      ),
    },
    {
      accessorKey: "duration",
      header: "Duration",
      accessorFn: (row) => row.duration ?? "",
      cell: ({ row }) => (
        <span>{row.original.duration ? `${row.original.duration} min` : "--"}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <ExamLifecycleStatusBadge status={row.original.status} />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const exam = row.original
        if (exam.status !== "active") return null
        return (
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={() => handleStartExam(exam.id)}>
              <Play data-icon="inline-start" className="size-3.5" />
              Start Exam
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="My Exams"
        description="View and manage your upcoming and completed examinations"
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

      <DataTable
        title="Upcoming Exams"
        description="View your scheduled examinations and start them when ready."
        columns={columns}
        data={exams}
        loading={loading}
        error={error ? "Failed to load exams. Please try again after some time.." : null}
        onRetry={() => window.location.reload()}
        emptyMessage="No upcoming exams are scheduled right now."
        searchPlaceholder="Search exams..."
      />
    </div>
  )
}
