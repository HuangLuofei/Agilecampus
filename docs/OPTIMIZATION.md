# AgileCampus 优化清单

> 来源：2026-10-12 全量代码审查（`src/` 全部 138 个源文件 + `src/db/schema.ts`）。
> 本清单只收录**可执行的具体改动**，每条含：问题定位 → 为什么要改 → 具体改法 → 验证方式。不含泛泛而谈。
>
> **前置动作**：分支 `feat/team-home` 上尚有 50+ 文件未提交（`git status` 全是 `M`/`??`）。
> 请先落一次 commit，再开始动优化，否则改动会糊在一起没法 review。

---

## 优先级总览

| # | 项目 | 影响 | 成本 | 涉及文件 |
|---|---|---|---|---|
| P0-1 | 提醒逻辑（含写库）塞在 layout 里，每次导航都跑 | 高 | 中 | `(app)/layout.tsx`、`lib/reminder.ts` |
| P0-2 | 未读通知计数「查全行再 .length」 | 高 | 极低 | `lib/notification.ts` |
| P0-3 | 未读聊天计数走 `listMyRooms()` 全家桶 | 高 | 低 | `lib/chat.ts` |
| P1-4 | 通知 fan-out 逐条串行 insert | 高 | 低 | `lib/notification.ts`、`lib/reminder.ts`、`lib/announcement.ts` |
| P1-5 | `syncDueSoonNotificationsForAll` 串行遍历用户 | 中 | 低 | `lib/reminder.ts` |
| P1-6 | 缺 `tasks(due_date)` 索引 | 中 | 极低 | `db/schema.ts` |
| P1-7 | 缺 `notifications(user_id, type, created_at)` 索引 | 中 | 极低 | `db/schema.ts` |
| P1-8 | 全站 0 个 `loading.tsx`，切页白屏 | 高（体感） | 极低 | `src/app/(app)/` |
| P1-9 | 20 处 `notFound()` 但无 `not-found.tsx` | 中 | 极低 | `src/app/(app)/` |
| P1-10 | `error.tsx` 配色脱离设计 token、无出口 | 低 | 极低 | `src/app/error.tsx` |
| P2-11 | 上传的 SVG 同源直出 → 存储型 XSS | 中（安全） | 极低 | `lib/asset.ts` |
| P2-12 | `tasks.assigneeId` 与 `task_assignees` 双写 | 长期 | 高 | `db/schema.ts`、`lib/task.ts` |
| P2-13 | 超大单文件 | 可维护性 | 中 | `lib/task.ts`(572)、`chat-app.tsx`(450)、`projects/page.tsx`(344) |

---

## P0-1 · 提醒逻辑移出渲染路径

**定位**：`src/app/(app)/layout.tsx:18`

```ts
const due = await syncDueSoonNotifications(session.user.id);
```

**问题**：`syncDueSoonNotifications`（`lib/reminder.ts:17`）是**带写库的**函数，却挂在 sidebar layout 里 —— 意味着**每点一次导航都要完整跑一遍**：

| 步骤 | 开销 |
|---|---|
| `listManagedProjectIds` | 2 条查询 |
| 主查询（tasks ⋈ projects ⋈ users） | 1 条 |
| `myAssignedTaskIds` | 1 条（串行，可并行） |
| `assigneesByTask` | 1 条 |
| 当日去重 `existing` | 1 条 |
| 逐条 `createNotification` | **N 次串行单行 insert** |

读一个页面，为了算一条红条，付出 5 条查询 + 若干次写入。且这 5 条查询**没有 try/catch**（只有 insert 有），DB 一抖整个应用 500。

**改法（方案 A，推荐）**：把「算数量」和「写通知」拆开，layout 只读。

在 `lib/reminder.ts` 抽出纯读版本：

```ts
// 纯读：只算临期/逾期数量，不写库。供 layout 渲染红条用（每请求调用，须廉价）。
export async function getDueSummary(
  userId: string,
): Promise<{ dueSoon: number; overdue: number; managed: number }> {
  const todayMs = todayStartMs();
  const horizon = toDayString(todayMs + DUE_SOON_DAYS * DAY);
  const managedProjectIds = await listManagedProjectIds(userId);
  const scope = [isAssigneeOf(userId)];
  if (managedProjectIds.length > 0) scope.push(inArray(tasks.projectId, managedProjectIds));

  const [rows, myAssignedTaskIds] = await Promise.all([
    db
      .select({ id: tasks.id, assigneeId: tasks.assigneeId, dueDate: tasks.dueDate, status: tasks.status })
      .from(tasks)
      .where(and(or(...scope), ne(tasks.status, "done"), isNotNull(tasks.dueDate), lte(tasks.dueDate, horizon))),
    db
      .select({ id: taskAssignees.taskId })
      .from(taskAssignees)
      .where(eq(taskAssignees.userId, userId))
      .then((rs) => new Set(rs.map((r) => r.id))),
  ]);

  let dueSoon = 0;
  let overdue = 0;
  let managed = 0;
  for (const r of rows) {
    const state = classifyDue(r.dueDate, r.status, todayMs);
    if (state === "ok") continue;
    if (state === "soon") dueSoon++;
    else overdue++;
    if (!(r.assigneeId === userId || myAssignedTaskIds.has(r.id))) managed++;
  }
  return { dueSoon, overdue, managed };
}
```

`syncDueSoonNotifications` 保留，但只由 cron（`/api/cron/reminders`）调用；内部把上面这段复用，再加去重与写入。

**代价**：未登录期间不再即时生成通知。cron 每日跑一次已覆盖「逾期/临期」这类按天去重的语义，丢失的即时性极小。

**改法（方案 B，若坚持保留即时性）**：
- layout 里保留 sync，但加**同步节流**（进程内 `Map<userId, number>` 记录上次同步时间，60s 内跳过，多实例下各自节流可接受）；
- 同时必须做 P1-4（批量 insert）与「查询并行化」，否则成本仍高。

**验证**：
- `npx tsc --noEmit`
- `npm test`（`tests/reminder.test.ts` 直接测 `syncDueSoonNotifications`，拆分后应保持全绿）
- 登录后连续点击侧边栏各页，确认红条文案与数字不变；用 `EXPLAIN ANALYZE` 或 DB 日志确认每请求查询数下降。

---

## P0-2 · 未读通知计数改用 `count(*)`

**定位**：`src/lib/notification.ts:67`

```ts
export async function countUnreadNotifications(actorId: string) {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, actorId), eq(notifications.isRead, false)));
  return rows.length;   // ← 把全部未读行拉回 Node 只为数个数
}
```

**改法**：`lib/notification.ts` 顶部 drizzle 导入加 `sql`（当前是 `{ and, desc, eq }`），然后：

```ts
export async function countUnreadNotifications(actorId: string) {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, actorId), eq(notifications.isRead, false)));
  return row?.c ?? 0;
}
```

`notifications_user_unread_idx (user_id, is_read)` 正好覆盖此查询。

---

## P0-3 · 未读聊天计数走专用聚合

**定位**：`src/lib/chat.ts`

```ts
export async function countUnreadChats(actorId: string) {
  const { unreadTotal } = await listMyRooms(actorId);   // ← 为了一个数字跑了整个会话列表
  return unreadTotal;
}
```

`listMyRooms` 内部要跑 `myAccessibleRoomIds`（2 条）+ `unreadByRoom`（聚合）+ `dmRows` + `groupRows` ≈ **5~6 条查询、还带 join**，且它同时构造了 `groupRooms`/`dmRooms` 两个 map 和全量房间对象。侧边栏只需要一个总数，且**每请求都调用**。

**改法**：改成专用计数查询（复用同一条未读判定口径）：

```ts
// 侧边栏角标用：只求总数，不构造房间列表（每请求调用，须廉价）。
// 未读口径与 unreadByRoom 保持一致：他人消息且晚于我的读水位（null 视为全未读）。
export async function countUnreadChats(actorId: string) {
  const roomIds = await myAccessibleRoomIds(actorId);
  if (roomIds.length === 0) return 0;
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chatMessages)
    .leftJoin(
      chatRoomMembers,
      and(eq(chatRoomMembers.roomId, chatMessages.roomId), eq(chatRoomMembers.userId, actorId)),
    )
    .where(
      and(
        inArray(chatMessages.roomId, roomIds),
        ne(chatMessages.senderId, actorId),
        or(isNull(chatRoomMembers.lastReadAt), gt(chatMessages.createdAt, chatRoomMembers.lastReadAt)),
      ),
    );
  return row?.c ?? 0;
}
```

（`and/eq/inArray/ne/or/isNull/gt/sql` 都已在该文件导入，无需新增。）

**进一步可选**：把 `myAccessibleRoomIds` 的两个查询合成一条 `UNION`，或直接把房间过滤条件内联成子查询，做到「一条 SQL 出总数」。

**验证**：与旧实现的返回值比对 —— 在测试库造两个会话（一个有未读、一个读净），断言两版数字一致。

---

## P1-4 · 通知 fan-out 改批量插入

**定位**（四处同样的模式，全是 `for (...) await createNotification(...)`）：

- `lib/notification.ts:151` `notifyTeamMembers` —— 发全团队
- `lib/notification.ts:131` `notifyTaskParticipants` —— 发全部负责人 + 创建者
- `lib/reminder.ts:93` —— 逐条生成到期提醒
- `lib/announcement.ts` —— 公告发布按团队 fan-out

团队 50 人 = 50 次独立 INSERT 往返。drizzle 支持一次 `values([...])` 插多行。

**改法**（以 `notifyTeamMembers` 为例）：

```ts
export async function notifyTeamMembers(input: {...}) {
  const members = await listTeamMembers(input.teamId);
  if (members.length === 0) return;
  const rows = members.map((m) => ({
    userId: m.id,
    title: input.title,
    content: input.content,
    type: input.type,
    linkUrl: input.linkUrl,
    actorId: input.actorId ?? null,
    projectId: input.projectId ?? null,
    isRead: m.id === input.actorId,
  }));
  try {
    // 分片防超参上限；单批 500 行足够
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(notifications).values(rows.slice(i, i + 500));
    }
  } catch (e) {
    // 保持 fire-and-forget 语义：通知失败绝不反噬主业务
    console.error("[notify] 站内通知写入失败", e);
  }
}
```

`notifyTaskParticipants` 同理（收件人 Set → 数组 → 一次插入）。`lib/reminder.ts` 里：

```ts
const toInsert = items
  .filter((r) => !seen.has(`/projects/${r.projectId}?task=${r.id}`))
  .map((r) => ({ /* ...同现有 createNotification 参数... */ }));
if (toInsert.length > 0) {
  try {
    await db.insert(notifications).values(toInsert);
  } catch (e) {
    console.error("[reminder] 到期提醒写入失败", e);
  }
}
```

**注意**：批量插入后失去「逐行 try/catch」的粒度。原代码那样做是为了单条失败不影响其余 —— 但实际上同一批插入不存在「部分行违法」的场景（都是同构数据），整体失败重试即可，语义反而更干净。

---

## P1-5 · `syncDueSoonNotificationsForAll` 并行化

**定位**：`src/lib/reminder.ts:166`

```ts
for (const id of targets) {
  await syncDueSoonNotifications(id);   // ← 串行，用户数越多越慢
  users++;
}
```

**改法**：分片并发（受连接池上限约束，分片不宜过小）：

```ts
const ids = [...targets];
const CHUNK = 8;
for (let i = 0; i < ids.length; i += CHUNK) {
  await Promise.all(ids.slice(i, i + CHUNK).map((id) => syncDueSoonNotifications(id)));
}
return { users: ids.length };
```

**注意**：`postgres` 驱动的默认连接数有限，`CHUNK` 建议 ≤ 10，并观察日志有无 `too many clients`。

---

## P1-6 · 补 `tasks(due_date)` 索引

**定位**：`src/db/schema.ts:170`（`tasks` 表索引块）

现有索引只有 `tasks_project_idx` / `tasks_assignee_idx` / `tasks_parent_idx`。但按 `due_date` 过滤或排序的地方有三处：

- `lib/reminder.ts:48` —— `lte(tasks.dueDate, horizon)`（每请求跑）
- `lib/dashboard.ts:85` —— `orderBy(asc(tasks.dueDate))`
- `lib/notify.ts:112` —— `dueDate <= CURRENT_DATE + INTERVAL '1 day'`

全部走全表扫描。

**改法**：`src/db/schema.ts` 的 `tasks` 表索引数组里追加：

```ts
    index("tasks_due_date_idx").on(t.dueDate),
```

**落库**（**关键**，务必按这个方式）：

```bash
# 主库
DATABASE_URL=postgres://agilecampus:agilecampus_dev@localhost:5432/agilecampus \
  node node_modules/drizzle-kit/bin.cjs push --force
# 测试库
npm run db:push:test
```

> ⚠️ **切勿使用 `drizzle-kit generate`**。`drizzle/` 里的快照早已与 schema 脱节（P0 模块都是 `push` 出来的），`generate` 会产出「重建 announcements/notifications 等全部表」的迁移，套用必炸。历史上已踩过这个坑。
> 若误生成：删掉新产出的 `drizzle/0002_*.sql` + `drizzle/meta/0002_snapshot.json`，并 `git checkout drizzle/meta/_journal.json`。

---

## P1-7 · 补 `notifications(user_id, type, created_at)` 索引

**定位**：`src/db/schema.ts:384`（`notifications` 表索引块）

现有：`(user_id, created_at)`、`(user_id, is_read)`、`(announcement_id)`、`(task_event_id)`。

但 `lib/reminder.ts:81` 的「当日去重」查询正好用这三列：

```ts
.where(and(
  eq(notifications.userId, userId),
  eq(notifications.type, "task_due_soon"),
  gte(notifications.createdAt, new Date(todayMs)),
))
```

`(user_id, created_at)` 能命中前两列，但 `type` 只能回表过滤。

**改法**：追加

```ts
  index("notifications_user_type_created_idx").on(t.userId, t.type, t.createdAt),
```

落库方式同 P1-6。落库后跑一次 `EXPLAIN ANALYZE` 对比该查询是否转为 Index Scan。

---

## P1-8 · 加 loading 骨架屏

**现状**：全项目 `loading.tsx` **数量为 0**。12+ 个路由页面全是 `async` server component 直连 DB，切页期间浏览器停在旧页面上、没有任何反馈。

**改法**：只需在 `(app)` 路由组根放一个，即可覆盖所有未自带 loading 的子路由：

新建 `src/app/(app)/loading.tsx`：

```tsx
// 路由段级骨架屏：覆盖 (app) 下所有未自带 loading.tsx 的页面。
// 纯静态、无数据依赖，务必保持轻量（它会在每次导航时先于页面渲染）。
export default function AppLoading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-7 w-40 rounded bg-primary-soft" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ac-card h-24" />
        ))}
      </div>
      <div className="ac-card h-64" />
      <span className="sr-only">加载中</span>
    </div>
  );
}
```

若想更精细，可给 `projects/[projectId]/` 再放一个贴合的骨架（看板三列）。

**验证**：`next dev` 下打开 DevTools Network 限速到 Slow 3G，点击侧边栏切换，应看到骨架而非白屏。

---

## P1-9 · 加 `not-found.tsx`

**现状**：`notFound()` 在 **20 处**页面里被调用（`teams/[teamId]/*`、`projects/[projectId]/*`、`messages/*`），但项目里**没有任何 `not-found.tsx`**。当前这些分支全部落到 Next.js 默认 404 页：英文文案、无侧边栏、无返回入口。

**改法**：新建 `src/app/(app)/not-found.tsx`（放在路由组内，这样侧边栏与顶部布局依然渲染）：

```tsx
import Link from "next/link";

export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="font-display text-5xl text-ink-faint">404</p>
      <h1 className="mt-4 text-lg font-medium text-ink">没找到这个页面</h1>
      <p className="mt-2 text-sm text-ink-soft">
        它可能已被删除，或你没有访问权限。
      </p>
      <Link href="/projects" className="ac-btn mt-6">回到工作台</Link>
    </div>
  );
}
```

**验证**：登录后访问 `/teams/00000000-0000-0000-0000-000000000000`，应看到上述页面且侧边栏仍在；HTTP 状态码为 404。若 Next 16 未按预期命中路由组内的 `not-found.tsx`，退回到 `src/app/not-found.tsx`（代价是失去侧边栏）。

---

## P1-10 · `error.tsx` 对齐设计 token

**定位**：`src/app/error.tsx`

当前用的是 Tailwind 原生色：`text-gray-500`、`bg-black`、`text-white` —— 与全站 `globals.css` 的 `--color-*` 体系完全脱节；且除「重试」外没有别的出口。

**改法**：

```tsx
"use client";

import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);

  return (
    <main className="mx-auto mt-24 w-full max-w-sm space-y-4 p-6 text-center">
      <h1 className="font-display text-xl font-semibold text-ink">出了点问题</h1>
      <p className="text-sm text-ink-soft">操作未能完成，请稍后重试。</p>
      {error.digest && (
        <p className="text-xs text-ink-faint">错误编号：{error.digest}</p>
      )}
      <div className="flex justify-center gap-2 pt-2">
        <button onClick={reset} className="ac-btn">重试</button>
        <Link href="/projects" className="ac-btn-ghost">回到工作台</Link>
      </div>
    </main>
  );
}
```

**可选**：在 `(app)` 目录下再加一个 `error.tsx`，让应用内报错时侧边栏不丢失（根 `error.tsx` 会替换整个 root layout 子树）。

---

## P2-11 · 上传 SVG 的存储型 XSS

**定位**：`src/lib/asset.ts:16`（白名单）+ `lib/asset.ts:72`（`saveUploadedFile`）

```ts
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", ...
```

`saveUploadedFile` **只校验后缀、不校验 MIME / 文件内容**，文件写进 `public/uploads`，由 Next 静态直出。同源访问 `image/svg+xml` 时，浏览器会**执行 SVG 内联的 `<script>`** —— 任何项目成员上传一个恶意 SVG、再把链接发给别人，就是一次存储型 XSS（可窃取会话）。

**改法（二选一，推荐同时做）**：

1. **最简单**：从白名单移除 `"svg"`。若确实需要图标，让用户传 png。
2. **保留 SVG 但降级为下载**：对 `svg`（及一切非图片位图）响应加 `Content-Disposition: attachment`，使其不会被当作文档渲染。这需要在文件服务层做（`public/` 直出无法设头），或改走 API route 读取后手动设头。

**长期**（正式上线前）：按 `asset.ts` 顶部注释自己的计划，换对象存储 + 签名 URL，并把上传目录移出 `public/`。

---

## P2-12 · `tasks.assigneeId` 与 `task_assignees` 双写

**现状**：多负责人改造后，负责人集合的真相源是 `task_assignees`，但 `tasks.assigneeId` 被保留并同步为「集合首位」（见 `lib/task.ts:setTaskAssignees`）。所有读取路径要么用 `isAssigneeOf()`（两处取并集），要么直接用 `assigneeId`（拖拽落列、飞书卡片、变更留痕）。

**风险**：同一语义存两份，靠代码维持一致。任何一处漏同步就是静默的数据不一致，且 `isAssigneeOf` 的「并集」写法会**掩盖**这类 bug（因为 `assigneeId` 残留值仍会命中）。

**建议方向**（不急，但值得排期）：
1. 先加一个**一致性断言测试**：随机造若干任务，校验 `tasks.assigneeId === (task_assignees 中 position 最小的 userId)`，作为回归护栏。
2. 逐步把读取路径收敛到 `task_assignees`，最后把 `assigneeId` 降级为**仅供查询优化的冗余列**，或直接移除。

---

## P2-13 · 拆分超大文件

| 文件 | 行数 |
|---|---|
| `src/lib/task.ts` | 572 |
| `src/app/(app)/chat/chat-app.tsx` | 450 |
| `src/app/(app)/projects/page.tsx` | 344 |

`lib/task.ts` 同时承担 CRUD、负责人集合、子任务、变更留痕、查询组装五类职责，可拆成 `task-write.ts` / `task-assignees.ts` / `task-query.ts`。`chat-app.tsx` 可把会话列表、消息气泡、输入框拆为独立组件。

**建议时机**：等 P0/P1 改完并提交后再做，避免大 diff 与功能改动混在一起。

---

## 建议执行顺序

1. **先提交现状**（`feat/team-home` 上 50+ 文件）
2. **第一批（纯收益、风险低）**：P0-2、P0-3、P1-6、P1-7、P1-8、P1-9、P1-10
3. **第二批（涉及核心逻辑，需仔细回归）**：P0-1、P1-4、P1-5
4. **第三批（安全 / 架构）**：P2-11、P2-12、P2-13

## 每批的统一验证清单

```bash
npx tsc --noEmit          # 类型检查必须 0 错误
npm test                  # 38 文件 / 319 通过 / 2 跳过（agent-live 需联网）
npm run lint
```

- 路由探活：`/`、`/projects`、`/tasks`、`/teams`、`/messages`、`/settings`、`/settings/profile`、
  `/settings/tokens`、`/projects/{id}`、`/projects/{id}/timeline|docs|assets`、
  `/teams/{id}/members` —— 未登录应全部 307 跳转登录，不应出现 500。
- 动了 schema（P1-6/7）时，**主库与测试库都要 push**，否则测试会因缺列/缺索引行为不一致。
