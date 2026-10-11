import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  primaryKey,
  date,
  doublePrecision,
  index,
  jsonb,
  boolean,
  bigint,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const notificationTypeEnum = pgEnum("notification_type", [
  "task_assigned",
  "task_reassigned",
  "task_completed",
  "task_commented",
  "task_updated",
  "ai_committed",
  "system",
  "announcement",
  "document_created",
  "document_updated",
  "document_deleted",
  "resource_logged",
  "resource_ended",
  "task_due_soon",
  "asset_created",
  "chat_mentioned",
]);
export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

export const actorTypeEnum = pgEnum("actor_type", ["human", "ai", "system"]);
export type ActorType = (typeof actorTypeEnum.enumValues)[number];

export const taskEventActionEnum = pgEnum("task_event_action", [
  "created",
  "updated",
  "status_changed",
  "assignee_changed",
  "due_date_changed",
  "priority_changed",
  "completion_note_changed",
  "comment_created",
  "comment_updated",
  "comment_deleted",
  "deleted",
]);
export type TaskEventAction = (typeof taskEventActionEnum.enumValues)[number];

export const teamRoleEnum = pgEnum("team_role", ["admin", "teacher", "student"]);
export type TeamRole = (typeof teamRoleEnum.enumValues)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  // 成员自报技能标签（自由文本数组，分工参考，非权限）；清洗/限量在 lib/skill-tags.ts
  skillTags: text("skill_tags").array().notNull().default(sql`'{}'::text[]`),
  // 飞书绑定（一对一，可空=未绑定）：open_id 为应用内用户唯一标识，发私信用之
  feishuOpenId: text("feishu_open_id").unique(),
  feishuName: text("feishu_name"),
  feishuBoundAt: timestamp("feishu_bound_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull().default("student"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_members_team_user_unique").on(t.teamId, t.userId)],
);

export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);
export const milestoneStatusEnum = pgEnum("milestone_status", ["open", "done"]);
export const taskStatusEnum = pgEnum("task_status", ["todo", "doing", "done"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high"]);
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("active"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("projects_team_idx").on(t.teamId)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    targetDate: date("target_date"),
    status: milestoneStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("milestones_project_idx").on(t.projectId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    // 子任务层级：自引用，空＝顶层任务。父任务删则子任务随之（cascade）。
    // 自引用外键须显式标注 AnyPgColumn，否则 TS 推断成环。
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    completionNote: text("completion_note"),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("tasks_project_idx").on(t.projectId),
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_parent_idx").on(t.parentTaskId),
  ],
);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "tool"]);
export type MessageRole = (typeof messageRoleEnum.enumValues)[number];

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("conversations_project_idx").on(t.projectId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    predecessorId: uuid("predecessor_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    successorId: uuid("successor_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("task_dep_pair_unique").on(t.predecessorId, t.successorId),
    index("task_dep_predecessor_idx").on(t.predecessorId),
  ],
);

// Personal API Token：CC 等浏览器外调用的认证凭据。
// 明文只生成时返回一次，库中仅存 sha256 hash（高熵 token 无需 bcrypt，且 hash 可建唯一索引供 O(1) 查验）。
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

// 资源占用登记：团队共享资源（服务器/算力等）的占用记录，纯登记无审批。
// endTime 可空=占用中；时长 = endTime - startTime（结束后计算）。
export const resourceUsages = pgTable(
  "resource_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceName: text("resource_name").notNull(),
    purpose: text("purpose"),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("resource_usages_team_idx").on(t.teamId),
    index("resource_usages_user_idx").on(t.userId),
  ],
);

export const labelColorEnum = pgEnum("label_color", [
  "slate",
  "red",
  "amber",
  "green",
  "blue",
  "violet",
  "pink",
]);
export type LabelColor = (typeof labelColorEnum.enumValues)[number];

// 标签挂在团队而非项目：实验室内项目多且同质，共享一套免去每建一项目重建之苦。
// 唯一索引建在普通两列，大小写不敏感去重由 lib/label.ts 的 lower() 查询承担。
export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: labelColorEnum("color").notNull().default("slate"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("labels_team_name_unique").on(t.teamId, t.name),
    index("labels_team_idx").on(t.teamId),
  ],
);

export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index("task_labels_label_idx").on(t.labelId),
  ],
);

// ==================== 本项目新增 P0 模块 ====================

// 公告表：一条公告 = 1 行；发布时按团队成员 fan-out 成 N 条 notifications（见 lib/announcement.ts）
export const announcements = pgTable('announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("announcements_project_created_idx").on(t.projectId, t.createdAt),
]);

// 公告评论表：镜像 task_comments（软删 deletedAt，作者或管理员/老师可删）
export const announcementComments = pgTable('announcement_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  announcementId: uuid('announcement_id').notNull().references(() => announcements.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("announcement_comments_announcement_created_idx").on(t.announcementId, t.createdAt),
]);

// 1. 站内通知表
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  type: notificationTypeEnum('type').notNull(),
  linkUrl: text('link_url'),
  // 公告用：发布者 + 对应项目（事件型通知为 null）
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  // 公告用：关联公告实体（同一次发布 fan-out 出的 N 行共享此 id）；事件型通知为 null
  announcementId: uuid('announcement_id').references(() => announcements.id, { onDelete: 'cascade' }),
  // 变更类通知用：关联具体某条 task_events（「查看变更」跳 /messages/changes/{id}）；公告/系统通知为 null
  taskEventId: uuid('task_event_id').references(() => taskEvents.id, { onDelete: 'cascade' }),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("notifications_user_created_idx").on(t.userId, t.createdAt),
  index("notifications_user_unread_idx").on(t.userId, t.isRead),
  index("notifications_announcement_idx").on(t.announcementId),
  index("notifications_task_event_idx").on(t.taskEventId),
]);

// 2. 任务评论表
export const taskComments = pgTable('task_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("task_comments_task_created_idx").on(t.taskId, t.createdAt),
]);

// 3. 任务变更审计表
export const taskEvents = pgTable('task_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  actorType: actorTypeEnum('actor_type').notNull(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: taskEventActionEnum('action').notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("task_events_task_created_idx").on(t.taskId, t.createdAt),
]);

// 3b. 变更评论表：挂在具体某条 task_events 上（镜像 announcement_comments）
export const taskEventComments = pgTable('task_event_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => taskEvents.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("task_event_comments_event_created_idx").on(t.eventId, t.createdAt),
]);

// 4. 云文档：挂在项目下，Markdown 正文，项目内全员可编辑。
// category 为自由文本分类/目录；全文搜索走 ILIKE（中文不适合 PG 默认分词器）。
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  category: text('category'),
  createdById: uuid('created_by_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("documents_project_idx").on(t.projectId),
  index("documents_project_category_idx").on(t.projectId, t.category),
]);

// 5. 真人聊天：dm=全局一对一私聊，group=项目群聊（按项目初始化）
export const chatRoomTypeEnum = pgEnum("chat_room_type", ["dm", "group"]);
export type ChatRoomType = (typeof chatRoomTypeEnum.enumValues)[number];

export const chatRooms = pgTable('chat_rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: chatRoomTypeEnum('type').notNull(),
  // group 用：绑定项目
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  // dm 用：全局一对一，规范化 A<B 存储，唯一约束防重复
  dmUserAId: uuid('dm_user_a_id').references(() => users.id, { onDelete: 'cascade' }),
  dmUserBId: uuid('dm_user_b_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("chat_rooms_project_idx").on(t.projectId),
  uniqueIndex("chat_rooms_dm_pair_unique").on(t.dmUserAId, t.dmUserBId),
]);

// 每成员每会话的已读水位（lastReadAt null=从未读）。DM 建会话即写两行；群聊首次读时懒写。
// 仅作读状态，不作为发消息的准入依据（发消息权限另由 dm 双方/团队身份判定）。
export const chatRoomMembers = pgTable('chat_room_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: uuid('room_id').notNull().references(() => chatRooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex("chat_room_members_room_user_unique").on(t.roomId, t.userId),
  index("chat_room_members_user_idx").on(t.userId),
]);

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: uuid('room_id').notNull().references(() => chatRooms.id, { onDelete: 'cascade' }),
  senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("chat_messages_room_created_idx").on(t.roomId, t.createdAt),
]);

// ==================== 资产管理模块（assets） ====================

// 资产类型：file=上传文件（url 存文件地址），link=外部链接（url 存链接地址）
export const assetTypeEnum = pgEnum("asset_type", ["file", "link"]);
export type AssetType = (typeof assetTypeEnum.enumValues)[number];

// 项目资产：挂在 project 下。权限沿用团队可见性——asset → project → team 链条，
// 同团队所有人可见本团队所有项目资产、非团队成员禁止访问；故不另设 team_id 字段。
// taskId / docId 可空：一个资产至多关联一个任务、一个文档；被关联对象删除时置 null，资产保留。
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 归属项目（权限锚点，经 project.teamId 推到团队）；删项目级联删资产
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // 关联任务（可空）：任务删则解除关联，资产保留
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    // 关联文档（可空）：文档删则解除关联，资产保留
    docId: uuid("doc_id").references(() => documents.id, { onDelete: "set null" }),
    // 上传人：用户删除时置 null，资产保留（团队共有资源）
    uploadUserId: uuid("upload_user_id").references(() => users.id, { onDelete: "set null" }),
    // 资产名：file=文件名，link=链接标题
    name: text("name").notNull(),
    // 描述（选填）
    description: text("description"),
    // file | link
    assetType: assetTypeEnum("asset_type").notNull(),
    // 文件地址（file 型）或外部链接（link 型）
    url: text("url").notNull(),
    // [file] MIME 类型（application/pdf、image/png…），检测不到可为 null
    fileMime: text("file_mime"),
    // [file] 字节数（int8，mode:number；单文件 < 2^53 字节足够安全）
    fileSize: bigint("file_size", { mode: "number" }),
    // 归档锁定：归档后不再展示于常规列表、禁止再编辑/删除/绑定
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assets_project_idx").on(t.projectId),
    index("assets_task_idx").on(t.taskId),
    index("assets_doc_idx").on(t.docId),
  ],
);
