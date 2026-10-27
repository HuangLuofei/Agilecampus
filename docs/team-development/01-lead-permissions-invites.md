# 成员 1：组长权限、成员管理与邀请

## 目标

把学生端权限收敛为“组长 / 成员”，完成邀请码和邀请链接两种加入方式。邀请链接打开后显示目标小组和项目，登录后仍回到同一邀请确认页。

## 当前代码线索

- `src/db/schema.ts`：`teams`、`teamMembers`、`teamJoinRequests`、`teamRoleEnum`
- `src/lib/team.ts`：创建团队、邀请码申请、审核、角色校验
- `src/app/(app)/teams/page.tsx`、`team-forms.tsx`、`actions.ts`
- `src/app/(app)/teams/[teamId]/members/page.tsx`
- `src/lib/project.ts`：项目创建使用 `admin` 权限

## 需要完成的功能

### 1. 角色模型

- 统一显示“组长”和“成员”。数据库可暂存 `admin/student/teacher`，但新业务不增加第三种学生端角色。
- 组长可以创建/归档项目、创建迭代和里程碑、调整任务负责人和依赖、审核入组、复制邀请信息、发布正式周报、管理小组级重要消息。
- 成员可以查看项目、创建任务、编辑自己负责的任务、更新自己负责的状态和完成说明、上传资料、聊天和个人筛选。
- 成员越权时，服务端返回统一 403/业务错误，不能只隐藏按钮。
- 保护最后一个组长：不能把唯一组长改成成员，除非同时指定新的组长。

### 2. 邀请码与邀请链接

- 保留已有邀请码申请和组长审核流程。
- 新增可分享链接，例如 `/join/<inviteToken>`；token 使用高熵随机值，数据库保存 hash 或不可逆值。
- 落地页显示小组名称、可选项目、组长信息和需审核提示。
- 未登录用户点击申请先跳登录，登录成功后回到邀请页；已登录用户显示 pending/已加入/已拒绝状态。
- 支持“只加入小组”和“加入小组并关注某项目”两种语义；项目授权仍通过小组成员关系判断。
- 组长可以撤销链接并生成新链接；旧链接撤销后不能继续申请。

### 3. 测试与验收

- 成员不能创建项目、审核申请、修改他人任务负责人。
- 组长能审核、变更角色、撤销邀请链接。
- 邀请链接在未登录、待审、已加入、失效四种状态下正确。
- 增加 `tests/team-permissions.test.ts`、`tests/invite-link.test.ts`，补充 `tests/helpers.ts` 清理表。

## 数据契约

建议新增 `teamInviteLinks`：`id/teamId/projectId?/tokenHash/createdById/expiresAt/revokedAt/createdAt`，并为活动 token 建查询索引。不要修改任务表。

## 与其他人的接口

- 给成员 2 提供 `requireTeamLead` 或 `canPublishReport`。
- 给成员 3 提供 `canManageTask` 与“只能编辑自己负责任务”的判断。
- 给成员 4 提供小组级权限校验，区分“个人置顶”和“组长管理的全组重要标记”。
- 给成员 5 提供 `displayRole`，避免工作台直接显示 `admin/student/teacher`。

## 完成标准

所有新权限由 `src/lib/team.ts` 或专门权限模块集中校验；页面、AI、Agent API 不复制不一致的角色判断。PR 描述列出新增字段、迁移方式和历史 `teacher` 的兼容处理。
