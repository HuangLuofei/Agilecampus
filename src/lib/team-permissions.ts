// 小组权限集中模块（成员 1 维护）：
// 所有「组长 / 成员」角色判断只允许从这里或 lib/team.ts 出口，页面、AI、Agent API 不得复制各自为政的判断。
//
// 显示口径：界面统一只展示「组长 / 成员（导师）」，不直接暴露 admin/student/teacher 原始值。
// 存储口径：team_members.role 沿用 teamRoleEnum（admin/student/teacher），新业务不新增第三种学生端角色。
import { ForbiddenError } from "./errors";
import { getTeamMembership, type TeamMembership } from "./team";

export type TeamRoleValue = "admin" | "teacher" | "student";

// 组长 = admin；teacher 为历史遗留角色，按导师展示，不具备组长管理权
export function isTeamLead(role: TeamRoleValue | string): boolean {
  return role === "admin";
}

// 成员 5 使用：把数据库角色翻译为界面展示文案，禁止工作台直接显示 admin/student/teacher
export function displayRole(role: TeamRoleValue | string): string {
  if (role === "admin") return "组长";
  if (role === "teacher") return "导师";
  return "成员";
}

// 以下均为组长专属能力；集中在此避免各处散落 role === "admin" 字面量
export function canCreateProject(role: TeamRoleValue | string): boolean {
  return isTeamLead(role);
}

export function canReviewJoinRequests(role: TeamRoleValue | string): boolean {
  return isTeamLead(role);
}

export function canManageInviteLinks(role: TeamRoleValue | string): boolean {
  return isTeamLead(role);
}

// 成员 2 使用：只有组长能发布正式周报（草稿人人可存）
export function canPublishReport(role: TeamRoleValue | string): boolean {
  return isTeamLead(role);
}

// 成员 3 使用：调整任务负责人 / 维护前后置依赖是组长权限
export function canReassignTaskOwner(role: TeamRoleValue | string): boolean {
  return isTeamLead(role);
}

export function canManageDependencies(role: TeamRoleValue | string): boolean {
  return isTeamLead(role);
}

// 成员 3 使用：任务“管理”口径（改负责人 / 依赖 / 里程碑 / 截止日等全组级调度）＝组长专属；
// 与 canEditTask 区分：canEditTask 是“编辑这条任务的内容/状态”（成员可编辑自己负责的），
// canManageTask 是“调度这条任务”（仅组长）。
export function canManageTask(role: TeamRoleValue | string): boolean {
  return isTeamLead(role);
}

// 成员 4 使用：区分「个人置顶」（人人可设）与「组长管理的全组重要标记」
export function canMarkTeamImportant(role: TeamRoleValue | string): boolean {
  return isTeamLead(role);
}

// 发布小组级重要消息 / 归档项目 / 创建迭代与里程碑，同为组长专属
export function canManageTeamAnnouncements(role: TeamRoleValue | string): boolean {
  return isTeamLead(role);
}

// 成员 3 使用：任务编辑口径——组长可编辑任意任务；成员只能编辑自己负责任务
export function canEditTask(
  role: TeamRoleValue | string,
  actorId: string,
  task: { assigneeId: string | null },
): boolean {
  if (isTeamLead(role)) return true;
  return task.assigneeId === actorId;
}

// 服务端强制版本：无成员记录或权限不符时抛统一 ForbiddenError（页面可以只藏按钮，服务端必须真拦）
export async function requireTeamLead(
  userId: string,
  teamId: string,
): Promise<TeamMembership> {
  const member = await getTeamMembership(userId, teamId);
  if (!member || !isTeamLead(member.role)) throw new ForbiddenError();
  return member;
}
