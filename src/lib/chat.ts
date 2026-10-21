import { and, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  chatMessages,
  chatRoomMembers,
  chatRooms,
  projects,
  teamMembers,
  teams,
  users,
} from "@/db/schema";
import { AppError, ForbiddenError, isUniqueViolation } from "./errors";
import { getTeamMembership } from "./team";
import { createNotification } from "./notification";
import { getFlagsForMessages, isImportantToUser, type MessageFlags } from "./message-flags";
import type { MessageFilterMode } from "@/db/schema";

// 会话访问收敛点：DM 校验是双方之一；群聊校验是项目所属团队成员
async function requireRoomAccess(actorId: string, roomId: string) {
  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId));
  if (!room) throw new AppError("会话不存在");

  if (room.type === "dm") {
    if (room.dmUserAId !== actorId && room.dmUserBId !== actorId) throw new ForbiddenError();
    return { room, kind: "dm" as const };
  }

  if (!room.projectId) throw new AppError("会话不存在");
  const [project] = await db
    .select({ teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, room.projectId));
  if (!project) throw new AppError("会话不存在");
  const member = await getTeamMembership(actorId, project.teamId);
  if (!member) throw new ForbiddenError();
  return { room, kind: "group" as const };
}

// 我可达的全部会话 id（DM 双方之一 + 我所在项目团队的群聊）
async function myAccessibleRoomIds(actorId: string): Promise<string[]> {
  const dmRows = await db
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(
      and(
        eq(chatRooms.type, "dm"),
        or(eq(chatRooms.dmUserAId, actorId), eq(chatRooms.dmUserBId, actorId)),
      ),
    );

  const groupRows = await db
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .innerJoin(projects, eq(chatRooms.projectId, projects.id))
    .innerJoin(
      teamMembers,
      and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, actorId)),
    )
    .where(eq(chatRooms.type, "group"));

  return [...dmRows.map((r) => r.id), ...groupRows.map((r) => r.id)];
}

// 未读 = 他人消息且晚于我的读水位（null 视为全未读）。单条聚合查询。
async function unreadByRoom(actorId: string, roomIds: string[]): Promise<Map<string, number>> {
  if (roomIds.length === 0) return new Map();
  const rows = await db
    .select({ roomId: chatMessages.roomId, count: sql<number>`count(*)::int` })
    .from(chatMessages)
    .leftJoin(
      chatRoomMembers,
      and(
        eq(chatRoomMembers.roomId, chatMessages.roomId),
        eq(chatRoomMembers.userId, actorId),
      ),
    )
    .where(
      and(
        inArray(chatMessages.roomId, roomIds),
        ne(chatMessages.senderId, actorId),
        or(
          isNull(chatRoomMembers.lastReadAt),
          gt(chatMessages.createdAt, chatRoomMembers.lastReadAt),
        ),
      ),
    )
    .groupBy(chatMessages.roomId);
  return new Map(rows.map((r) => [r.roomId, r.count]));
}

// 我的会话及未读数（供页面与顶栏红点复用）
export async function listMyRooms(actorId: string) {
  const roomIds = await myAccessibleRoomIds(actorId);
  const unread = await unreadByRoom(actorId, roomIds);

  const dmRows = await db
    .select({
      roomId: chatRooms.id,
      dmUserAId: chatRooms.dmUserAId,
      dmUserBId: chatRooms.dmUserBId,
    })
    .from(chatRooms)
    .where(
      and(
        eq(chatRooms.type, "dm"),
        or(eq(chatRooms.dmUserAId, actorId), eq(chatRooms.dmUserBId, actorId)),
      ),
    );

  const dmRooms: Record<string, { roomId: string; unread: number }> = {};
  for (const r of dmRows) {
    const other = r.dmUserAId === actorId ? r.dmUserBId : r.dmUserAId;
    if (other) dmRooms[other] = { roomId: r.roomId, unread: unread.get(r.roomId) ?? 0 };
  }

  const groupRows = await db
    .select({ roomId: chatRooms.id, projectId: chatRooms.projectId })
    .from(chatRooms)
    .innerJoin(projects, eq(chatRooms.projectId, projects.id))
    .innerJoin(
      teamMembers,
      and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, actorId)),
    )
    .where(eq(chatRooms.type, "group"));

  const groupRooms: Record<string, { roomId: string; unread: number }> = {};
  for (const r of groupRows) {
    if (r.projectId) groupRooms[r.projectId] = { roomId: r.roomId, unread: unread.get(r.roomId) ?? 0 };
  }

  const unreadTotal = [...unread.values()].reduce((n, c) => n + c, 0);
  return { groupRooms, dmRooms, unreadTotal };
}

// 供 /chat 页：会话 + 项目分组 + 成员（私聊入口）
export async function listMyChatOverview(actorId: string) {
  const { groupRooms, dmRooms, unreadTotal } = await listMyRooms(actorId);

  const memberships = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, actorId));
  const teamIds = memberships.map((m) => m.teamId);
  if (teamIds.length === 0) return { projects: [], groupRooms, dmRooms, unreadTotal };

  const projectRows = await db
    .select({ id: projects.id, name: projects.name, teamId: projects.teamId, teamName: teams.name })
    .from(projects)
    .innerJoin(teams, eq(projects.teamId, teams.id))
    .where(inArray(projects.teamId, teamIds))
    .orderBy(projects.createdAt);

  const memberRows = await db
    .select({ teamId: teamMembers.teamId, userId: users.id, name: users.name })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(inArray(teamMembers.teamId, teamIds));

  const membersByTeam = new Map<string, { id: string; name: string }[]>();
  for (const r of memberRows) {
    const list = membersByTeam.get(r.teamId) ?? [];
    list.push({ id: r.userId, name: r.name });
    membersByTeam.set(r.teamId, list);
  }

  const projectsList = projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    teamName: p.teamName,
    members: membersByTeam.get(p.teamId) ?? [],
  }));

  return { projects: projectsList, groupRooms, dmRooms, unreadTotal };
}

// 全局一对一私聊：规范化 A<B 存储，先查后建，唯一索引兜底并发
export async function getOrCreateDmRoom(actorId: string, otherUserId: string) {
  if (actorId === otherUserId) throw new AppError("不能与自己私聊");
  const a = actorId < otherUserId ? actorId : otherUserId;
  const b = actorId < otherUserId ? otherUserId : actorId;

  const [existing] = await db
    .select()
    .from(chatRooms)
    .where(and(eq(chatRooms.type, "dm"), eq(chatRooms.dmUserAId, a), eq(chatRooms.dmUserBId, b)));
  if (existing) return existing;

  try {
    const [room] = await db
      .insert(chatRooms)
      .values({ type: "dm", dmUserAId: a, dmUserBId: b })
      .returning();
    await db.insert(chatRoomMembers).values([
      { roomId: room.id, userId: a },
      { roomId: room.id, userId: b },
    ]);
    return room;
  } catch (e) {
    if (isUniqueViolation(e)) {
      const [room] = await db
        .select()
        .from(chatRooms)
        .where(and(eq(chatRooms.type, "dm"), eq(chatRooms.dmUserAId, a), eq(chatRooms.dmUserBId, b)));
      if (room) return room;
    }
    throw e;
  }
}

// 项目群聊：按项目懒初始化（兼容既有项目），成员身份才可获取
export async function getOrCreateGroupRoom(actorId: string, projectId: string) {
  const [project] = await db
    .select({ teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new AppError("项目不存在");
  const member = await getTeamMembership(actorId, project.teamId);
  if (!member) throw new ForbiddenError();

  const [existing] = await db
    .select()
    .from(chatRooms)
    .where(and(eq(chatRooms.type, "group"), eq(chatRooms.projectId, projectId)));
  if (existing) return existing;

  const [room] = await db
    .insert(chatRooms)
    .values({ type: "group", projectId })
    .returning();
  return room;
}

// 会话消息（升序，含发送者姓名、mine 标记与读回执 readBy）
// filter=important 时只返回「小组级重要 + 我收藏的」（供仅重要视图与成员 2 周报复用）
export async function listRoomMessages(
  actorId: string,
  roomId: string,
  filter: MessageFilterMode = "all",
) {
  await requireRoomAccess(actorId, roomId);
  const rows = await db
    .select({
      id: chatMessages.id,
      senderId: chatMessages.senderId,
      senderName: users.name,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .innerJoin(users, eq(chatMessages.senderId, users.id))
    .where(eq(chatMessages.roomId, roomId))
    .orderBy(chatMessages.createdAt);

  // 读回执：该会话各成员读水位（含姓名）。群聊成员懒写 chatRoomMembers，
  // 未开过会话的成员无行 → 自然视为未读。
  const members = await db
    .select({
      userId: chatRoomMembers.userId,
      name: users.name,
      lastReadAt: chatRoomMembers.lastReadAt,
    })
    .from(chatRoomMembers)
    .innerJoin(users, eq(chatRoomMembers.userId, users.id))
    .where(eq(chatRoomMembers.roomId, roomId));

  const flags = await getFlagsForMessages(actorId, rows.map((r) => r.id));

  const withFlags = rows.map((r) => ({
    ...r,
    mine: r.senderId === actorId,
    flags: flags.get(r.id) ?? ({ isImportant: false, savedByMe: false } satisfies MessageFlags),
    readBy: members
      .filter(
        (m) =>
          m.userId !== r.senderId &&
          m.lastReadAt != null &&
          m.lastReadAt.getTime() >= r.createdAt.getTime(),
      )
      .map((m) => ({ id: m.userId, name: m.name ?? "" })),
  }));

  return filter === "important"
    ? withFlags.filter((m) => isImportantToUser(m.flags))
    : withFlags;
}

// 我的会话摘要列表（含最近活动时间与未读数，供消息中心排序展示）
export async function listMyConversationSummaries(actorId: string) {
  const roomIds = await myAccessibleRoomIds(actorId);
  const unread = await unreadByRoom(actorId, roomIds);
  if (roomIds.length === 0) return [];

  const rooms = await db
    .select({
      roomId: chatRooms.id,
      type: chatRooms.type,
      projectId: chatRooms.projectId,
      dmUserAId: chatRooms.dmUserAId,
      dmUserBId: chatRooms.dmUserBId,
      updatedAt: chatRooms.updatedAt,
    })
    .from(chatRooms)
    .where(inArray(chatRooms.id, roomIds));

  // 标题：群聊「项目-团队」/ 私聊对方名
  const projectIds = rooms.map((r) => r.projectId).filter((x): x is string => !!x);
  const otherIds = rooms
    .filter((r) => r.type === "dm")
    .map((r) => (r.dmUserAId === actorId ? r.dmUserBId : r.dmUserAId))
    .filter((x): x is string => !!x);

  const projectRows = projectIds.length
    ? await db
        .select({ id: projects.id, name: projects.name, teamName: teams.name })
        .from(projects)
        .innerJoin(teams, eq(projects.teamId, teams.id))
        .where(inArray(projects.id, projectIds))
    : [];
  const userRows = otherIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, otherIds))
    : [];
  const projectTitles = new Map(projectRows.map((p) => [p.id, `${p.name}-${p.teamName}`]));
  const userTitles = new Map(userRows.map((u) => [u.id, u.name]));

  return rooms.map((r) => ({
    roomId: r.roomId,
    type: r.type,
    title:
      r.type === "group"
        ? (projectTitles.get(r.projectId ?? "") ?? "群聊")
        : (userTitles.get((r.dmUserAId === actorId ? r.dmUserBId : r.dmUserAId) ?? "") ?? "私聊"),
    lastActivityAt: r.updatedAt,
    unread: unread.get(r.roomId) ?? 0,
  }));
}

// 会话元信息（深链自动打开用）：标题 = 群聊「项目-团队」/ 私聊对方名
// canManageImportant：群聊里当前用户是否为该团队组长（仅组长可标小组级重要）
export async function getRoomMeta(actorId: string, roomId: string) {
  const { room, kind } = await requireRoomAccess(actorId, roomId);
  if (kind === "dm") {
    const otherId = room.dmUserAId === actorId ? room.dmUserBId : room.dmUserAId;
    const [other] = otherId
      ? await db.select({ name: users.name }).from(users).where(eq(users.id, otherId))
      : [];
    return { id: room.id, type: "dm" as const, title: other?.name ?? "私聊", canManageImportant: false };
  }
  const [project] = await db
    .select({ name: projects.name, teamName: teams.name, teamId: projects.teamId })
    .from(projects)
    .innerJoin(teams, eq(projects.teamId, teams.id))
    .where(eq(projects.id, room.projectId!));
  const member = project ? await getTeamMembership(actorId, project.teamId) : null;
  return {
    id: room.id,
    type: "group" as const,
    title: `${project?.name ?? "?"}-${project?.teamName ?? "?"}`,
    canManageImportant: member?.role === "admin",
  };
}

// 会话成员：群聊 = 项目团队全员；私聊 = 双方。供成员面板 / @ 艾特解析
export async function listRoomMembers(actorId: string, roomId: string) {
  const { room, kind } = await requireRoomAccess(actorId, roomId);
  if (kind === "dm") {
    const ids = [room.dmUserAId, room.dmUserBId].filter((x): x is string => !!x);
    return db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  }
  const [project] = await db
    .select({ teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, room.projectId!));
  if (!project) return [];
  return db
    .select({ id: users.id, name: users.name })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, project.teamId));
}

// 发消息：校验访问 + 内容非空，刷新会话活跃时间；解析 @ 艾特并通知被提及成员
export async function sendMessage(actorId: string, roomId: string, content: string) {
  await requireRoomAccess(actorId, roomId);
  const text = content.trim();
  if (!text) throw new AppError("消息不能为空");

  const [message] = await db
    .insert(chatMessages)
    .values({ roomId, senderId: actorId, content: text })
    .returning();
  await db.update(chatRooms).set({ updatedAt: new Date() }).where(eq(chatRooms.id, roomId));

  // @ 艾特通知：内容里 @名字 → 命中成员即发通知（排除自己；重名只通知首个匹配）
  const [sender] = await db.select({ name: users.name }).from(users).where(eq(users.id, actorId));
  const mentionedNames = [...new Set([...text.matchAll(/@([^\s@]+)/g)].map((m) => m[1]))];
  if (mentionedNames.length > 0) {
    const members = await listRoomMembers(actorId, roomId);
    for (const name of mentionedNames) {
      const target = members.find((m) => m.id !== actorId && m.name === name);
      if (!target) continue;
      void createNotification({
        userId: target.id,
        title: "群聊提及",
        content: `${sender?.name ?? "有人"} 在群聊中 @ 了你`,
        type: "chat_mentioned",
        linkUrl: `/messages?tab=chat&room=${roomId}`,
        actorId,
      }).catch(() => {});
    }
  }

  return message;
}

// 标记已读：upsert 读水位 = now
export async function markRoomRead(actorId: string, roomId: string) {
  await requireRoomAccess(actorId, roomId);
  await db
    .insert(chatRoomMembers)
    .values({ roomId, userId: actorId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [chatRoomMembers.roomId, chatRoomMembers.userId],
      set: { lastReadAt: new Date() },
    });
}

// 顶栏红点：我所有会话未读总数
export async function countUnreadChats(actorId: string) {
  const { unreadTotal } = await listMyRooms(actorId);
  return unreadTotal;
}
