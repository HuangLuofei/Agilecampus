import Link from "next/link";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { getTeamMembership, listTeamMembers } from "@/lib/team";
import { displayRole } from "@/lib/team-permissions";
import { listTeamProjectsWithStats } from "@/lib/project";
import { listTeamResourceUsages } from "@/lib/resource";
import { listTeamLabels } from "@/lib/label";

const AVATAR_COLORS = ["#2d4a8f", "#2ea121", "#ff8800", "#8b5cf6", "#00b0b9", "#f54a45"];
const LABEL_COLORS: Record<string, string> = {
  slate: "#64748b",
  red: "#ef4444",
  amber: "#f59e0b",
  green: "#22c55e",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  pink: "#ec4899",
};

export default async function TeamHomePage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!z.uuid().safeParse(teamId).success) notFound();
  const me = await getTeamMembership(session.user.id, teamId);
  if (!me) notFound();

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) notFound();

  const [projects, members, resourceResult, labels] = await Promise.all([
    listTeamProjectsWithStats(session.user.id, teamId),
    listTeamMembers(teamId),
    listTeamResourceUsages(session.user.id, teamId),
    listTeamLabels(session.user.id, teamId),
  ]);

  const activeUsages = resourceResult.usages.filter((u) => u.active);

  return (
    <main className="mx-auto max-w-3xl space-y-8">
      {/* 头部 */}
      <header>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-semibold text-ink">{team.name}</h1>
          <RoleBadge role={me.role} />
        </div>
        <p className="mt-1 text-sm text-ink-faint">
          邀请码 <span className="font-mono text-ink-soft">{team.inviteCode}</span> · 成员{" "}
          {members.length} · 项目 {projects.length}
        </p>
      </header>

      {/* 项目 */}
      <Section
        title="项目"
        count={projects.length}
        href={`/teams/${teamId}/projects`}
      >
        {projects.length === 0 ? (
          <div className="ac-card p-6 text-center text-sm text-ink-faint">暂无项目</div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => {
              const pct = p.taskTotal > 0 ? Math.round((p.doneCount / p.taskTotal) * 100) : 0;
              return (
                <li key={p.id} className="ac-card group p-4 transition-shadow hover:shadow-pop">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/projects/${p.id}`}
                      className="min-w-0 truncate font-display text-base font-semibold text-ink group-hover:text-primary"
                    >
                      {p.name}
                    </Link>
                    {p.status === "archived" ? (
                      <span className="ac-badge bg-low-soft text-low">已归档</span>
                    ) : (
                      <span className="ac-badge bg-done/12 text-done">进行中</span>
                    )}
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-ink-soft">
                      <span>任务进度</span>
                      <span className="tabular-nums">
                        {p.doneCount}/{p.taskTotal}
                        {p.taskTotal > 0 ? ` · ${pct}%` : ""}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                      <div
                        className="h-full rounded-full bg-done transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* 成员 */}
      <Section title="成员" count={members.length} href={`/teams/${teamId}/members`}>
        {members.length === 0 ? (
          <div className="ac-card p-6 text-center text-sm text-ink-faint">暂无成员</div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex">
              {members.slice(0, 7).map((m, i) => (
                <span
                  key={m.id}
                  title={m.name}
                  className="-ml-2 grid h-9 w-9 place-items-center rounded-full border-2 border-surface text-xs font-semibold text-white first:ml-0"
                  style={{ backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                >
                  {m.name.trim()?.[0] ?? "?"}
                </span>
              ))}
              {members.length > 7 && (
                <span className="-ml-2 grid h-9 w-9 place-items-center rounded-full border-2 border-surface bg-sunken text-xs font-medium text-ink-soft">
                  +{members.length - 7}
                </span>
              )}
            </div>
            <span className="text-sm text-ink-faint">{members.length} 位团队成员</span>
          </div>
        )}
      </Section>

      {/* 资源占用 */}
      <Section
        title="资源占用"
        count={activeUsages.length}
        href={`/teams/${teamId}/resources`}
        countLabel="项占用中"
      >
        {activeUsages.length === 0 ? (
          <div className="ac-card p-6 text-center text-sm text-ink-faint">暂无占用中的资源</div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {activeUsages.slice(0, 4).map((u) => (
              <li key={u.id} className="ac-card flex items-center gap-2 p-3 text-sm">
                <span aria-hidden>🖥</span>
                <span className="font-medium text-ink">{u.resourceName}</span>
                <span className="ml-auto text-xs text-ink-faint">
                  {u.userName} · 占用中
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 标签 */}
      <Section title="标签" count={labels.length} href={`/teams/${teamId}/labels`}>
        {labels.length === 0 ? (
          <div className="ac-card p-6 text-center text-sm text-ink-faint">暂无标签</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {labels.map((l) => (
              <span
                key={l.id}
                className="rounded-full px-3 py-1 text-xs font-medium text-white"
                style={{ backgroundColor: LABEL_COLORS[l.color] ?? "#64748b" }}
              >
                {l.name}
              </span>
            ))}
          </div>
        )}
      </Section>
    </main>
  );
}

function Section({
  title,
  count,
  href,
  countLabel,
  children,
}: {
  title: string;
  count: number;
  href: string;
  countLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-4 w-1 rounded-full bg-primary" />
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
        <span className="text-xs text-ink-faint">
          {count}
          {countLabel ? ` ${countLabel}` : ""}
        </span>
        <Link href={href} className="ml-auto text-sm text-primary hover:underline">
          查看全部 →
        </Link>
      </div>
      {children}
    </section>
  );
}

function RoleBadge({ role }: { role: string }) {
  const cls =
    role === "admin"
      ? "bg-primary-soft text-primary"
      : role === "teacher"
        ? "bg-accent-soft text-accent"
        : "bg-low-soft text-low";
  return <span className={`ac-badge ${cls}`}>{displayRole(role)}</span>;
}
