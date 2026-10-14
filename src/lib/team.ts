import { and, desc, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import {
  teamJoinRequests,
  teamMembers,
  teams,
  users,
  type TeamRole,
} from "@/db/schema";
import { AppError, ForbiddenError, isUniqueViolation } from "./errors";
import { createNotification } from "./notification";

export async function createTeam(userId: string, name: string) {
  return db.transaction(async (tx) => {
    const [team] = await tx
      .insert(teams)
      .values({ name, inviteCode: nanoid(10) })
      .returning();
    await tx.insert(teamMembers).values({
      teamId: team.id,
      userId,
      role: "admin",
    });
    return team;
  });
}

export async function joinTeam(userId: string, inviteCode: string) {
  const [team] = await db.select().from(teams).where(eq(teams.inviteCode, inviteCode));
  if (!team) throw new AppError("邀请码无效");

  const [existing] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)));
  if (existing) throw new AppError("已在该团队中");

  try {
    const [member] = await db
      .insert(teamMembers)
      .values({ teamId: team.id, userId, role: "student" })
      .returning();
    return member;
  } catch (e) {
    // 查重与插入之间的并发窗口：另一请求已抢先加入，由 DB 唯一约束兜底
    if (isUniqueViolation(e)) throw new AppError("已在该团队中");
    throw e;
  }
}

export async function getTeamMembership(userId: string, teamId: string) {
  const [member] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  return member ?? null;
}

// ── 邀请码加入 · 审批流 ────────────────────────────────────────────
// 学生凭有效邀请码提交申请（不直接入团），团队 admin 审核通过后写入成员表。

export async function requestJoinTeam(userId: string, inviteCode: string) {
  const [team] = await db.select().from(teams).where(eq(teams.inviteCode, inviteCode));
  if (!team) throw new AppError("邀请码无效");

  const [existing] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)));
  if (existing) throw new AppError("已在该团队中");

  try {
    await db.insert(teamJoinRequests).values({ teamId: team.id, userId });
  } catch (e) {
    // (team_id, user_id) 的部分唯一索引：已有待审申请时拦截
    if (isUniqueViolation(e)) throw new AppError("已提交过申请，请等待组长审核");
    throw e;
  }

  // 通知全体管理员（发起人除外）有新申请
  const admins = await db
    .select({ id: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.role, "admin"), ne(teamMembers.userId, userId)));
  const [applicant] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId));
  await Promise.all(
    admins.map((a) =>
      createNotification({
        userId: a.id,
        title: "新的加入申请",
        content: `${applicant?.name ?? "有用户"} 申请加入团队「${team.name}」，请前往成员页审核`,
        type: "team_join_requested",
        linkUrl: `/teams/${team.id}/members`,
        actorId: userId,
      }),
    ),
  );
  return team;
}

// 待审申请列表（申请时间倒序），供成员页 admin 审核面板
export async function listPendingJoinRequests(teamId: string) {
  return db
    .select({
      id: teamJoinRequests.id,
      userId: teamJoinRequests.userId,
      userName: users.name,
      studentId: users.studentId,
      createdAt: teamJoinRequests.createdAt,
    })
    .from(teamJoinRequests)
    .innerJoin(users, eq(teamJoinRequests.userId, users.id))
    .where(and(eq(teamJoinRequests.teamId, teamId), eq(teamJoinRequests.status, "pending")))
    .orderBy(desc(teamJoinRequests.createdAt));
}

export async function reviewJoinRequest(
  actorId: string,
  requestId: string,
  decision: "approved" | "rejected",
) {
  const [request] = await db
    .select()
    .from(teamJoinRequests)
    .where(eq(teamJoinRequests.id, requestId));
  if (!request) throw new AppError("申请不存在");
  if (request.status !== "pending") throw new AppError("该申请已处理过");
  await requireTeamRole(actorId, request.teamId, ["admin"]);

  const [team] = await db.select().from(teams).where(eq(teams.id, request.teamId));

  if (decision === "approved") {
    try {
      await db
        .insert(teamMembers)
        .values({ teamId: request.teamId, userId: request.userId, role: "student" });
    } catch (e) {
      // 申请处理期间已通过其他途径入团：把申请关掉即可，不必报错
      if (!isUniqueViolation(e)) throw e;
    }
  }

  await db
    .update(teamJoinRequests)
    .set({ status: decision, reviewedBy: actorId, reviewedAt: new Date() })
    .where(eq(teamJoinRequests.id, requestId));

  await createNotification({
    userId: request.userId,
    title: decision === "approved" ? "加入申请已通过" : "加入申请被拒绝",
    content:
      decision === "approved"
        ? `你已加入团队「${team?.name ?? ""}」，快去看看吧`
        : `你加入团队「${team?.name ?? ""}」的申请未被通过，可联系组长了解原因`,
    type: decision === "approved" ? "team_join_approved" : "team_join_rejected",
    linkUrl: decision === "approved" ? `/teams/${request.teamId}` : null,
    actorId,
  });
}

export async function requireTeamRole(
  userId: string,
  teamId: string,
  allowed: TeamRole[],
) {
  const member = await getTeamMembership(userId, teamId);
  if (!member || !allowed.includes(member.role)) throw new ForbiddenError();
  return member;
}

// 无权限前置：调用方须已校验访问权（如 getProjectForUser / requireTeamRole）后再调用
export async function listTeamMembers(teamId: string) {
  return db
    .select({
      id: users.id,
      name: users.name,
      role: teamMembers.role,
      skillTags: users.skillTags,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));
}

// 我担任管理员的团队（供「所有项目」页新建项目选择所属团队）
export async function listAdminTeams(actorId: string) {
  return db
    .select({ id: teams.id, name: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(and(eq(teamMembers.userId, actorId), eq(teamMembers.role, "admin")));
}

export async function updateMemberRole(
  actorId: string,
  teamId: string,
  targetUserId: string,
  role: TeamRole,
) {
  await requireTeamRole(actorId, teamId, ["admin"]);
  const [updated] = await db
    .update(teamMembers)
    .set({ role })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
    .returning();
  if (!updated) throw new AppError("该成员不在团队中");
  return updated;
}
