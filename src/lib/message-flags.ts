import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { chatMessageFlags, chatMessages, chatRooms, projects } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getTeamMembership } from "./team";

// ── 消息标记：important=小组级重要（组长设置）；saved=个人收藏（每人独立） ──
// 权限口径：
//  - important 仅项目群聊可标，且只能由群所属团队的组长（admin）设置/取消；
//  - saved 任何会话参与者可对自己设置，互不可见彼此的收藏。

async function requireRoomContext(actorId: string, messageId: string) {
  const [row] = await db
    .select({
      messageId: chatMessages.id,
      roomId: chatMessages.roomId,
      roomType: chatRooms.type,
      projectId: chatRooms.projectId,
    })
    .from(chatMessages)
    .innerJoin(chatRooms, eq(chatMessages.roomId, chatRooms.id))
    .where(eq(chatMessages.id, messageId));
  if (!row) throw new AppError("消息不存在");

  if (row.roomType === "dm") {
    const [room] = await db.select().from(chatRooms).where(eq(chatRooms.id, row.roomId));
    if (room.dmUserAId !== actorId && room.dmUserBId !== actorId) throw new ForbiddenError();
    return { ...row, teamId: null as string | null };
  }

  if (!row.projectId) throw new AppError("消息不存在");
  const [project] = await db
    .select({ teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, row.projectId));
  if (!project) throw new AppError("消息不存在");
  const member = await getTeamMembership(actorId, project.teamId);
  if (!member) throw new ForbiddenError();
  return { ...row, teamId: project.teamId };
}

// 组长标记/取消小组级重要消息（仅项目群聊）
export async function setMessageImportant(
  actorId: string,
  messageId: string,
  important: boolean,
) {
  const ctx = await requireRoomContext(actorId, messageId);
  if (ctx.roomType !== "group" || !ctx.teamId) {
    throw new AppError("仅项目群聊支持标记重要消息");
  }
  const member = await getTeamMembership(actorId, ctx.teamId);
  if (!member || member.role !== "admin") throw new ForbiddenError("只有组长可以标记重要消息");

  if (important) {
    await db
      .insert(chatMessageFlags)
      .values({ messageId, userId: actorId, kind: "important" })
      .onConflictDoNothing();
  } else {
    // 小组级标记是单条消息一份语义：取消时清掉该消息所有 important 行（换人标记也只留一条）
    await db
      .delete(chatMessageFlags)
      .where(and(eq(chatMessageFlags.messageId, messageId), eq(chatMessageFlags.kind, "important")));
  }
  return { messageId, important };
}

// 个人收藏/取消收藏（任何会话，只影响自己）
export async function setMessageSaved(actorId: string, messageId: string, saved: boolean) {
  await requireRoomContext(actorId, messageId);
  if (saved) {
    await db
      .insert(chatMessageFlags)
      .values({ messageId, userId: actorId, kind: "saved" })
      .onConflictDoNothing();
  } else {
    await db
      .delete(chatMessageFlags)
      .where(
        and(
          eq(chatMessageFlags.messageId, messageId),
          eq(chatMessageFlags.userId, actorId),
          eq(chatMessageFlags.kind, "saved"),
        ),
      );
  }
  return { messageId, saved };
}

// 消息 → 标记状态（供列表渲染 / 过滤复用）
export type MessageFlags = {
  isImportant: boolean;
  savedByMe: boolean;
};

export async function getFlagsForMessages(
  actorId: string,
  messageIds: string[],
): Promise<Map<string, MessageFlags>> {
  const result = new Map<string, MessageFlags>();
  for (const id of messageIds) result.set(id, { isImportant: false, savedByMe: false });
  if (messageIds.length === 0) return result;

  const rows = await db
    .select({
      messageId: chatMessageFlags.messageId,
      userId: chatMessageFlags.userId,
      kind: chatMessageFlags.kind,
    })
    .from(chatMessageFlags)
    .where(inArray(chatMessageFlags.messageId, messageIds));

  for (const row of rows) {
    const f = result.get(row.messageId);
    if (!f) continue;
    if (row.kind === "important") f.isImportant = true;
    if (row.kind === "saved" && row.userId === actorId) f.savedByMe = true;
  }
  return result;
}

// 「仅重要」判定：小组级重要 或 我收藏的
export function isImportantToUser(flags: MessageFlags): boolean {
  return flags.isImportant || flags.savedByMe;
}

// 成员 2 接口：只看某会话内的重要消息（小组级重要 + 我收藏的），默认不读取普通聊天冗余
export async function listImportantRoomMessages(actorId: string, roomId: string) {
  const flags = await db
    .select({
      messageId: chatMessageFlags.messageId,
      userId: chatMessageFlags.userId,
      kind: chatMessageFlags.kind,
    })
    .from(chatMessageFlags)
    .innerJoin(chatMessages, eq(chatMessageFlags.messageId, chatMessages.id))
    .where(
      and(
        eq(chatMessages.roomId, roomId),
        // 重要（任意人标）或 我收藏的
        eq(chatMessageFlags.kind, "important"),
      ),
    );

  const savedRows = await db
    .select({ messageId: chatMessageFlags.messageId })
    .from(chatMessageFlags)
    .innerJoin(chatMessages, eq(chatMessageFlags.messageId, chatMessages.id))
    .where(
      and(
        eq(chatMessages.roomId, roomId),
        eq(chatMessageFlags.userId, actorId),
        eq(chatMessageFlags.kind, "saved"),
      ),
    );

  const ids = new Set<string>([...flags.map((r) => r.messageId), ...savedRows.map((r) => r.messageId)]);
  if (ids.size === 0) return [];

  const rows = await db
    .select({
      id: chatMessages.id,
      roomId: chatMessages.roomId,
      senderId: chatMessages.senderId,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(inArray(chatMessages.id, [...ids]))
    .orderBy(chatMessages.createdAt);
  return rows;
}
