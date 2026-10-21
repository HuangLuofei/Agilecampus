# 成员 3：任务紧急排序、前后置强制关系与提醒

## 目标

让任务按紧急程度排序，并把前后置关系变成执行约束：前置任务没有全部完成时，后置任务不能开始或完成。提醒区分逾期、临期、高优先级和阻塞。

## 当前代码线索

- `src/db/schema.ts`：`tasks`、`taskDependencies`、`taskPriorityEnum`
- `src/lib/task.ts`：任务 CRUD、`setTaskSuccessors`、`listProjectDependencies`
- `src/app/(app)/projects/[projectId]/actions.ts`、`task-card.tsx`、`board.tsx`
- `src/lib/reminder.ts`、`src/lib/due.ts`
- `src/lib/dashboard.ts`：工作台统计和我的待办

## 需要完成的功能

### 1. 紧急程度和排序

- 保留 `low/medium/high`，界面显示中文“低/中/高”。
- 增加排序选择：紧急优先、截止日期优先、更新时间优先、手动排序。排序稳定，同优先级按截止日期再按 `sortOrder`。
- 逾期任务明确标记，但不覆盖优先级字段。
- 工作台和项目任务页使用同一套排序参数。

### 2. 强制前后置关系

- 设置依赖时防止任何环路，不只检查直接反向边；建议 DFS/BFS 检查传递闭包。
- 新增 `getBlockingPredecessors(taskId)`，返回未完成前置任务和状态。
- `updateTask` 改为 `doing` 或 `done` 前检查全部前置任务；未完成则返回任务名称列表。
- 前置任务被删除或跨项目时拒绝关联。
- 任务卡显示“被 X 个前置任务阻塞”，可点击查看。
- 组长可明确执行“跳过前置”并留下审计事件；成员不能绕过。
- AI 工具和 Agent API 复用同一 `updateTask` 校验。

### 3. 提醒分层

- 高优先级 + 临期/逾期：强提醒。
- 普通临期：普通提醒。
- 被前置阻塞：提示阻塞原因，不能误报成员未执行。
- 组长看到管理项目的风险摘要，成员看到自己负责或明确关注的任务。

## 数据契约

如果持久化“跳过前置”或“阻塞状态”，在 PR 说明字段和审计语义。不要把 `blocked` 静默塞进现有 `task_status`，除非同步修改所有统计和测试；推荐保留派生阻塞状态。

## 测试与验收

- A→B→C 中 A 未完成时 B/C 都不能启动。
- A 完成后 B 可启动，C 仍不能启动。
- A→B→C→A 被拒绝。
- 成员绕过依赖被拒，组长按明确跳过操作可继续并产生审计记录。
- 排序在高优先级、逾期、无截止日期和同时间时稳定。
- 运行现有 `tests/task-detail.test.ts`，新增 `tests/task-dependencies-enforcement.test.ts`。

## 与其他人的接口

- 使用成员 1 的权限函数。
- 给成员 2 提供阻塞任务和按日期重建状态所需事件。
- 给成员 5 提供任务排序 API 和工作台统计字段。
