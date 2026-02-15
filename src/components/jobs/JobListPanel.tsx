import { useJobStore, jobDisplayName, type Job } from "@/stores/jobStore";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  X,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Ban,
} from "lucide-react";

function JobStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />;
    case "pending":
      return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
    case "cancelled":
      return <Ban className="h-4 w-4 text-muted-foreground shrink-0" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function JobRow({
  job,
  onCancel,
  onRetry,
}: {
  job: Job;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const isActive = job.status === "pending" || job.status === "running";
  const progress =
    job.progressTotal > 0
      ? (job.progressCurrent / job.progressTotal) * 100
      : 0;

  return (
    <div className="px-3 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <JobStatusIcon status={job.status} />
          <span className="text-sm font-medium truncate">
            {jobDisplayName(job)}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {isActive && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onCancel(job.id)}
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
          {(job.status === "failed" || job.status === "cancelled") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onRetry(job.id)}
              title="Retry"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {job.status === "running" && job.progressTotal > 0 && (
        <Progress value={progress} className="h-1.5" />
      )}

      {job.progressMessage && isActive && (
        <p className="text-xs text-muted-foreground truncate">
          {job.progressMessage}
        </p>
      )}

      {isActive && job.progressTotal > 0 && (
        <p className="text-xs text-muted-foreground">
          {job.progressCurrent} / {job.progressTotal}
        </p>
      )}

      {job.status === "failed" && job.errorMessage && (
        <p className="text-xs text-destructive truncate" title={job.errorMessage}>
          {job.errorMessage}
        </p>
      )}
    </div>
  );
}

export function JobListPanel() {
  const { jobs, cancelJob, retryJob, clearFinished } = useJobStore();

  const activeJobs = jobs.filter(
    (j) => j.status === "pending" || j.status === "running"
  );
  const finishedJobs = jobs.filter(
    (j) =>
      j.status === "completed" ||
      j.status === "failed" ||
      j.status === "cancelled"
  );

  return (
    <div className="max-h-[400px] flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-sm font-medium">Background Tasks</span>
        {finishedJobs.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearFinished()}
            className="h-6 text-xs px-2"
          >
            Clear finished
          </Button>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="px-3 py-8 text-center text-sm text-muted-foreground">
          No background tasks
        </div>
      ) : (
        <div className="overflow-y-auto divide-y">
          {[...activeJobs, ...finishedJobs].map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onCancel={cancelJob}
              onRetry={retryJob}
            />
          ))}
        </div>
      )}
    </div>
  );
}
