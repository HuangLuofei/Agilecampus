import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import {
  projects,
  teamInviteLinks,
  teamJoinRequests,
  teamMembers,
  teams,
  users,
  type TeamRole,
} from "@/db/schema";
import { AppError, ForbiddenError, isUniqueViolation } from "./errors";
import { createNotification } from "./notification";

export type TeamMembership = {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  createdAt: Date;
};

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

// 通知团队全体管理员（发起人除外）有新的入组申请。邀请码与邀请链接两路共用。
async function notifyAdminsOfJoinRequest(
  teamId: string,
  teamName: string,
  applicantUserId: string,
) {
  const admins = await db
    .select({ id: teamMembers.userId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.role, "admin"),
        ne(teamMembers.userId, applicantUserId),
      ),
    );
  const [applicant] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, applicantUserId));
  await Promise.all(
    admins.map((a) =>
      createNotification({
        userId: a.id,
        title: "新的加入申请",
        content: `${applicant?.name ?? "有用户"} 申请加入团队「${teamName}」，请前往成员页审核`,
        type: "team_join_requested",
        linkUrl: `/teams/${teamId}/members`,
        actorId: applicantUserId,
      }),
    ),
  );
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

  await notifyAdminsOfJoinRequest(team.id, team.name, userId);
  return team;
}

// ── 邀请链接加入 · 审批流 ──────────────────────────────────────────
// 落地页解析 token 得到 teamId（+ 可选 projectId）后提交申请，复用同一审核机制。

export async function applyToJoinTeam(
  userId: string,
  teamId: string,
  projectId?: string | null,
) {
  const [existing] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  if (existing) throw new AppError("已在该团队中");

  if (projectId) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)));
    if (!project) throw new AppError("项目不属于该团队");
  }

  try {
    const [req] = await db
      .insert(teamJoinRequests)
      .values({ teamId, userId, projectId: projectId ?? null })
      .returning();
    const [team] = await db
      .select({ name: teams.name })
      .from(teams)
      .where(eq(teams.id, teamId));
    await notifyAdminsOfJoinRequest(teamId, team?.name ?? "", userId);
    return req;
  } catch (e) {
    // 已有待审申请时拦截（部分唯一索引仅约束 pending 行，被拒后重新申请会新增一条 pending）
    if (isUniqueViolation(e)) throw new AppError("已提交过申请，请等待组长审核");
    throw e;
  }
}

// 待审申请列表（申请时间倒序），供成员页 admin 审核面板；含意向项目（邀请链接场景）
export async function listPendingJoinRequests(teamId: string) {
  return db
    .select({
      id: teamJoinRequests.id,
      userId: teamJoinRequests.userId,
      userName: users.name,
      studentId: users.studentId,
      projectId: projects.id,
      projectName: projects.name,
      createdAt: teamJoinRequests.createdAt,
    })
    .from(teamJoinRequests)
    .innerJoin(users, eq(teamJoinRequests.userId, users.id))
    .leftJoin(projects, eq(teamJoinRequests.projectId, projects.id))
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
  const [target] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));

  if (!target) throw new AppError("该成员不在团队中");

  // 保护最后一个组长：组长降级为成员时，团队必须还有另一位组长，
  // 除非同时有新组长接任（由调用方先把别人升为组长再降级本组长）
  if (target.role === "admin" && role !== "admin") {
    const [leadCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "admin")));
    if ((leadCount?.count ?? 0) <= 1) {
      throw new AppError("不能撤销唯一的组长，请先将其他成员设为组长");
    }
  }

  const [updated] = await db
    .update(teamMembers)
    .set({ role })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
    .returning();
  if (!updated) throw new AppError("该成员不在团队中");
  return updated;
}

// ==================== 可分享邀请链接 ====================

// 高熵 token：24 字节 CSPRNG → base64url（约 192 bit 熵）；库中只存 sha256，明文仅创建时返回一次
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildInviteUrl(token: string): string {
  return `/join/${token}`;
}

export async function createInviteLink(
  actorId: string,
  teamId: string,
  opts: { projectId?: string | null; expiresInDays?: number | null } = {},
) {
  await requireTeamRole(actorId, teamId, ["admin"]);

  if (opts.projectId) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, opts.projectId), eq(projects.teamId, teamId)));
    if (!project) throw new AppError("项目不属于该团队");
  }

  const token = randomBytes(24).toString("base64url");
  const [link] = await db
    .insert(teamInviteLinks)
    .values({
      teamId,
      projectId: opts.projectId ?? null,
      tokenHash: hashInviteToken(token),
      createdById: actorId,
      expiresAt:
        opts.expiresInDays && opts.expiresInDays > 0
          ? new Date(Date.now() + opts.expiresInDays * 24 * 60 * 60 * 1000)
          : null,
    })
    .returning();
  return { link, token, url: buildInviteUrl(token) };
}

// 落地页解析：返回团队 + 意向项目；已撤销 / 过期 / 不存在统一按「链接已失效」处理，不泄露细节
export async function resolveInviteToken(token: string) {
  if (!token || token.length > 128) return null;
  const [row] = await db
    .select({
      link: teamInviteLinks,
      team: teams,
    })
    .from(teamInviteLinks)
    .innerJoin(teams, eq(teamInviteLinks.teamId, teams.id))
    .where(eq(teamInviteLinks.tokenHash, hashInviteToken(token)));

  if (!row) return null;
  if (row.link.revokedAt) return null;
  if (row.link.expiresAt && row.link.expiresAt.getTime() < Date.now()) return null;

  let project: { id: string; name: string } | null = null;
  if (row.link.projectId) {
    const [p] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, row.link.projectId));
    project = p ?? null;
  }
  return { link: row.link, team: row.team, project };
}

export async function revokeInviteLink(actorId: string, linkId: string) {
  const [link] = await db
    .select()
    .from(teamInviteLinks)
    .where(eq(teamInviteLinks.id, linkId));
  if (!link) throw new AppError("链接不存在");

  await requireTeamRole(actorId, link.teamId, ["admin"]);
  if (link.revokedAt) throw new AppError("链接已撤销");

  const [updated] = await db
    .update(teamInviteLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(teamInviteLinks.id, linkId), isNull(teamInviteLinks.revokedAt)))
    .returning();
  return updated;
}

// 组长查看本团队邀请链接（不回传明文 token，仅展示状态；链接复制走创建时的一次性回显）
export async function listInviteLinks(actorId: string, teamId: string) {
  await requireTeamRole(actorId, teamId, ["admin"]);
  return db
    .select({
      id: teamInviteLinks.id,
      revokedAt: teamInviteLinks.revokedAt,
      expiresAt: teamInviteLinks.expiresAt,
      createdAt: teamInviteLinks.createdAt,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(teamInviteLinks)
    .leftJoin(projects, eq(teamInviteLinks.projectId, projects.id))
    .where(eq(teamInviteLinks.teamId, teamId))
    .orderBy(desc(teamInviteLinks.createdAt));
}
