import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { projects, teamJoinRequests, teamMembers, users } from "@/db/schema";
import { resolveInviteToken } from "@/lib/team";
import { JoinForm } from "./join-form";

// 邀请链接落地页（公开路由）：未登录可看小组信息，点申请时先登录再回到本页。
// 链接四种状态：未登录跳登录 / 待审 / 已加入 / 失效（撤销、过期、不存在统一按失效处理，不泄露细节）。
export default async function JoinPage({
  params,
}: {
  params: Promise<{ inviteToken: string }>;
}) {
  const { inviteToken } = await params;
  const resolved = await resolveInviteToken(inviteToken);

  if (!resolved) {
    return (
      <main className="mx-auto mt-24 w-full max-w-sm space-y-4 ac-card p-6 text-center">
        <h1 className="font-display text-xl font-semibold text-ink">链接已失效</h1>
        <p className="text-sm text-ink-soft">
          该邀请链接不存在、已被撤销或已过期。请联系组长重新生成。
        </p>
        <Link href="/teams" className="ac-btn-ghost inline-block">
          返回首页
        </Link>
      </main>
    );
  }

  const { team, project } = resolved;
  const session = await auth();

  // 组长名单（展示用）
  const leads = await db
    .select({ name: users.name })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.role, "admin")));
  const leadNames = leads.map((l) => l.name).join("、") || "暂无组长";

  return (
    <main className="mx-auto mt-16 w-full max-w-sm space-y-5 ac-card p-6">
      <div>
        <p className="text-xs text-ink-faint">你被邀请加入小组</p>
        <h1 className="font-display text-2xl font-semibold text-ink">{team.name}</h1>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-soft">组长</dt>
          <dd className="text-ink">{leadNames}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-soft">邀请项目</dt>
          <dd className="text-ink">{project ? project.name : "仅加入小组"}</dd>
        </div>
      </dl>

      <p className="rounded-lg bg-sunken px-4 py-3 text-xs text-ink-soft">
        提交申请后需组长审核，审核通过你才会正式加入该小组。
      </p>

      {!session?.user ? (
        <div className="space-y-3">
          <Link
            href={`/login?redirect=${encodeURIComponent(`/join/${inviteToken}`)}`}
            className="ac-btn w-full"
          >
            登录后申请加入
          </Link>
          <p className="text-center text-xs text-ink-faint">
            没有账号？注册后回到本页即可申请。
          </p>
        </div>
      ) : (
        <LoggedInState
          teamId={team.id}
          defaultProjectId={project?.id ?? null}
        />
      )}
    </main>
  );
}

// 已登录：根据「成员记录 / 申请记录」展示对应状态；都不是才给申请表单
async function LoggedInState({
  teamId,
  defaultProjectId,
}: {
  teamId: string;
  defaultProjectId: string | null;
}) {
  const session = await auth();
  const userId = session!.user!.id;

  const [membership] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));

  if (membership) {
    return (
      <p className="rounded-lg bg-done/12 px-4 py-3 text-center text-sm text-done">
        你已是该小组成员，可直接进入小组。
      </p>
    );
  }

  // 取最新一条申请（被拒后重新申请会产生多条，按时间倒序取最新状态）
  const [request] = await db
    .select({ status: teamJoinRequests.status })
    .from(teamJoinRequests)
    .where(and(eq(teamJoinRequests.teamId, teamId), eq(teamJoinRequests.userId, userId)))
    .orderBy(desc(teamJoinRequests.createdAt))
    .limit(1);

  if (request?.status === "pending") {
    return (
      <p className="rounded-lg bg-sunken px-4 py-3 text-center text-sm text-ink-soft">
        申请已提交，正在等待组长审核。
      </p>
    );
  }

  if (request?.status === "approved") {
    return (
      <p className="rounded-lg bg-done/12 px-4 py-3 text-center text-sm text-done">
        申请已通过，请刷新后进入小组。
      </p>
    );
  }

  const teamProjects = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.teamId, teamId));

  return (
    <>
      {request?.status === "rejected" && (
        <p className="rounded-lg bg-high/10 px-4 py-3 text-center text-sm text-high">
          上次申请被拒绝，可修改后重新申请。
        </p>
      )}
      <JoinForm
        teamId={teamId}
        defaultProjectId={defaultProjectId}
        projects={teamProjects}
      />
      <p className="text-center text-xs text-ink-faint">
        当前登录：{session!.user!.email}
      </p>
    </>
  );
}
