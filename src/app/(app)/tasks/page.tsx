import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyTasks } from "@/lib/dashboard";
import { toDayString, todayStartMs } from "@/lib/due";
import { BackButton } from "@/components/back-button";

const STATUS_LABEL: Record<string, string> = { todo: "待办", doing: "进行中", done: "已完成" };

export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const status =
    sp.status === "todo" || sp.status === "doing" || sp.status === "overdue" ? sp.status : "all";

  const tasks = await listMyTasks(session.user.id);
  const today = toDayString(todayStartMs());

  const countBy = (f: (t: (typeof tasks)[number]) => boolean) => tasks.filter(f).length;
  const counts = {
    all: tasks.length,
    todo: countBy((t) => t.status === "todo"),
    doing: countBy((t) => t.status === "doing"),
    overdue: countBy((t) => !!t.dueDate && t.dueDate < today),
  };

  const filtered = tasks.filter((t) => {
    if (status === "todo") return t.status === "todo";
    if (status === "doing") return t.status === "doing";
    if (status === "overdue") return !!t.dueDate && t.dueDate < today;
    return true;
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 py-8">
      <BackButton fallbackHref="/projects" />
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">我的任务</h1>
        <p className="mt-1 text-sm text-ink-faint">分配给我、尚未完成的任务</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <TaskTab href="/tasks" active={status === "all"}>
          全部 <span className="opacity-60">{counts.all}</span>
        </TaskTab>
        <TaskTab href="/tasks?status=todo" active={status === "todo"}>
          待办 <span className="opacity-60">{counts.todo}</span>
        </TaskTab>
        <TaskTab href="/tasks?status=doing" active={status === "doing"}>
          进行中 <span className="opacity-60">{counts.doing}</span>
        </TaskTab>
        <TaskTab href="/tasks?status=overdue" active={status === "overdue"}>
          已逾期 <span className="opacity-60">{counts.overdue}</span>
        </TaskTab>
      </div>

      {filtered.length === 0 ? (
        <div className="ac-card p-10 text-center text-sm text-ink-soft">
          {status === "overdue" ? "没有逾期的任务 🎉" : "没有相关任务"}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((t) => {
            const overdue = !!t.dueDate && t.dueDate < today;
            return (
              <li key={t.id} className="ac-card flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/projects/${t.projectId}?task=${t.id}`}
                    className="truncate font-medium text-ink hover:text-primary"
                  >
                    {t.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-faint">{t.projectName}</p>
                </div>
                <StatusBadge status={t.status} />
                <span className={`w-24 shrink-0 text-right text-xs ${overdue ? "text-alert" : "text-ink-faint"}`}>
                  {overdue ? "已逾期" : t.dueDate ?? "无截止"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function TaskTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] ${
        active
          ? "border-primary bg-primary font-medium text-white"
          : "border-line-strong bg-surface text-ink-soft hover:border-primary hover:text-primary"
      }`}
    >
      {children}
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "doing"
      ? "bg-primary-soft text-primary"
      : status === "done"
        ? "bg-done/15 text-done"
        : "bg-low-soft text-low";
  return <span className={`ac-badge ${cls}`}>{STATUS_LABEL[status] ?? status}</span>;
}
