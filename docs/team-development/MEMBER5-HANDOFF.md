# 成员5：开发成果与接续交接

更新日期：2026-10-21。接续开发先读本文件和 [集成验收记录](./INTEGRATION-LOG.md)。

## 仓库与分支

- 仓库：<https://github.com/HuangLuofei/Agilecampus>
- 功能分支：`feature/member-5-workbench`，合并目标：`main`。
- 基线：`4595f77eb13dd49cf6c4e155552aa05c46799cf9`，包含成员1的 PR #13 和成员4的 PR #12。
- 本次使用重新 clone 的仓库对接远程历史，保留 ZIP 工作目录。后续在 clone 的 Git 仓库继续开发，不在旧 ZIP 目录 git init。
- 没有修改数据库 schema、迁移、依赖版本或运行时上传文件，不提交 `.env`、密钥、数据库及 node_modules。

## 已完成

1. 工作台按小组分类，显示角色、项目/成员数、状态分布、完成率、逾期和前置阻塞摘要；保留空小组。
2. URL `team=<UUID>` 专注模式统一项目、统计、待办、动态、提醒、我的任务和资产范围，刷新可保留。非法、未加入和已退出小组拒绝访问；空组不回退全部。
3. 任务、待办、动态、提醒显示小组及项目归属；支持多负责人，先按到期日排序再取前六项，退组历史指派不绕过成员范围。
4. 顶部只展开当前组提醒，其他组强提醒保留数量入口。强提醒为逾期任务或高优先级临期任务。
5. 保留 main 已有的单项目提醒直接跳看板；多项目提醒进入工作台提醒列表。网页任务创建、编辑、拖拽、删除成功后刷新共享 layout。
6. 看板筛选、任务深链、文档创建/编辑/删除、时间线、项目资产、返回工作台保留小组范围。
7. 合并资产页的原有新增、删除和类型图标，新增资产只提供当前组项目；切组重新初始化选择，避免沿用其他组项目。
8. 测试清库前要求独立 `*_test` 库，并拒绝与 `.env` 开发库同名。保留成员1/4新增表的清理列表。

## 关键文件

- `src/lib/workbench.ts`：成员范围与 UUID 校验。
- `src/lib/dashboard.ts`：按组统计、任务归属、待办排序、项目健康聚合。
- `src/lib/workbench-reminders.ts`：提醒读模型及单项目跳转信息；查询重新验证当前成员。
- `src/lib/workbench-navigation.ts`：客户端可用的导航、学生角色显示辅助函数。
- `src/app/(app)/due-reminder-banner.tsx`、`app-sidebar.tsx`、`layout.tsx`：专注导航和提醒。
- `src/app/(app)/projects/page.tsx`、`tasks/page.tsx`、`assets/page.tsx`：范围化页面。
- `src/app/(app)/projects/[projectId]`：看板、文档、资产和时间线的范围保留及任务修改刷新。
- `tests/workbench-*.test.*`、`tests/workbench.test.ts`：相关回归。
- `tests/db-safety.ts`、`tests/helpers.ts`：测试清库保护。

## 验证记录

本次在最新 main 的上传副本重新检查：

```bash
npm run lint
npx tsc --noEmit
npx vitest run tests/workbench-scope.test.ts tests/workbench-reminder-banner.test.tsx tests/workbench-document-navigation.test.ts tests/board-filters.test.ts tests/workbench-task-refresh.test.ts tests/unread-actions.test.ts tests/asset-types.test.ts
git diff --check
```

相关测试共7文件91项。具体最终结果以 PR 和集成记录为准；没有完整数据库测试和浏览器验收通过记录。

## 待办与限制

- `tests/workbench.test.ts` 的7项真实数据库回归尚未执行。配置独立测试库后再运行；测试会清空目标库，不能使用开发库。
- 完整 `npm test` 和浏览器跨模块端到端仍待完成。
- 原 ZIP 环境的生产构建曾因 Google Geist 字体下载失败，本次上传副本尚未重跑生产构建。
- 共享 layout 刷新覆盖网页四类任务修改；API、其他用户修改和跨午夜不主动推送。
- 成员1邀请/权限、成员4消息偏好/重要标记/置顶/图标已在 main，有待真实端到端联调，不能继续沿用旧快照中的“未实现”结论。
- 学生端工作台/侧栏将历史 teacher 显示为成员；成员1的通用 displayRole 仍显示导师。教师历史角色展示需团队后续统一；权限继续由既有服务端强制执行。
- 成员2周报/燃尽图和成员3任务依赖强制执行的交付状态须按各自分支确认，本次不代替实现。

## 新聊天接续提示

> 继续成员5验收，先阅读 docs/team-development/MEMBER5-HANDOFF.md 和 INTEGRATION-LOG.md。功能分支 feature/member-5-workbench 基于 main 4595f77，已人工保留成员1/4成果及单项目提醒跳转。不要覆盖其余成员代码，不使用开发库跑测试。优先补7项真实数据库回归和浏览器验收，生产构建待验证。上传状态请用 git status、git log 和远程 PR 核实。
