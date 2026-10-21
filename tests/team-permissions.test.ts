import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import {
  applyToJoinTeam,
  createTeam,
  createInviteLink,
  reviewJoinRequest,
  getTeamMembership,
  joinTeam,
  listPendingJoinRequests,
  updateMemberRole,
} from "@/lib/team";
import {
  canCreateProject,
  canEditTask,
  canManageDependencies,
  canManageTask,
  canMarkTeamImportant,
  canPublishReport,
  canReassignTaskOwner,
  canReviewJoinRequests,
  displayRole,
  isTeamLead,
  requireTeamLead,
} from "@/lib/team-permissions";
import { AppError, ForbiddenError } from "@/lib/errors";
import { createProject } from "@/lib/project";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function setupTeam() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  return { owner, team };
}

describe("displayRole / isTeamLead（统一展示口径）", () => {
  beforeEach(resetDb);

  it("admin 显示组长，student 显示成员，teacher 显示导师", () => {
    expect(displayRole("admin")).toBe("组长");
    expect(displayRole("student")).toBe("成员");
    expect(displayRole("teacher")).toBe("导师");
    expect(isTeamLead("admin")).toBe(true);
    expect(isTeamLead("student")).toBe(false);
    expect(isTeamLead("teacher")).toBe(false);
  });
});

describe("requireTeamLead（服务端组长校验）", () => {
  beforeEach(resetDb);

  it("组长通过并返回成员记录", async () => {
    const { owner, team } = await setupTeam();
    const m = await requireTeamLead(owner.id, team.id);
    expect(m.role).toBe("admin");
  });

  it("成员与非成员抛 ForbiddenError", async () => {
    const { team } = await setupTeam();
    const member = await makeUser("member@example.com");
    await joinTeam(member.id, team.inviteCode);

    await expect(requireTeamLead(member.id, team.id)).rejects.toBeInstanceOf(ForbiddenError);
    const outsider = await makeUser("outsider@example.com");
    await expect(requireTeamLead(outsider.id, team.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("组长专属能力矩阵", () => {
  it("成员不能创建项目 / 审核 / 改负责人 / 依赖 / 全组重要标记 / 发正式周报", () => {
    expect(canCreateProject("student")).toBe(false);
    expect(canReviewJoinRequests("student")).toBe(false);
    expect(canReassignTaskOwner("student")).toBe(false);
    expect(canManageDependencies("student")).toBe(false);
    expect(canManageTask("student")).toBe(false);
    expect(canMarkTeamImportant("student")).toBe(false);
    expect(canPublishReport("student")).toBe(false);
  });

  it("组长全部通过", () => {
    expect(canCreateProject("admin")).toBe(true);
    expect(canReviewJoinRequests("admin")).toBe(true);
    expect(canReassignTaskOwner("admin")).toBe(true);
    expect(canManageDependencies("admin")).toBe(true);
    expect(canManageTask("admin")).toBe(true);
    expect(canMarkTeamImportant("admin")).toBe(true);
    expect(canPublishReport("admin")).toBe(true);
  });

  it("canEditTask：组长可编辑任意任务，成员只能编辑自己负责任务", () => {
    const actor = "u1";
    expect(canEditTask("admin", actor, { assigneeId: "someone-else" })).toBe(true);
    expect(canEditTask("student", actor, { assigneeId: actor })).toBe(true);
    expect(canEditTask("student", actor, { assigneeId: null })).toBe(false);
    expect(canEditTask("student", actor, { assigneeId: "someone-else" })).toBe(false);
  });
});

describe("成员越权的服务端拦截", () => {
  beforeEach(resetDb);

  it("成员创建项目被拒（服务端 403 语义，不只是藏按钮）", async () => {
    const { owner, team } = await setupTeam();
    const member = await makeUser("member@example.com");
    await joinTeam(member.id, team.inviteCode);

    await expect(
      createProject(member.id, team.id, { name: "越权项目" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // 同一操作组长可以成功
    const p = await createProject(owner.id, team.id, { name: "正常项目" });
    expect(p.teamId).toBe(team.id);
  });

  it("成员审核入组申请被拒", async () => {
    const { owner, team } = await setupTeam();
    const member = await makeUser("member@example.com");
    await joinTeam(member.id, team.inviteCode);
    const applicant = await makeUser("applicant@example.com");
    const req = await applyToJoinTeam(applicant.id, team.id);

    await expect(reviewJoinRequest(member.id, req.id, "approved")).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // 组长审核通过后申请人才真正入组
    await reviewJoinRequest(owner.id, req.id, "approved");
    const m = await getTeamMembership(applicant.id, team.id);
    expect(m?.role).toBe("student");
  });
});

describe("保护最后一个组长", () => {
  beforeEach(resetDb);

  it("唯一组长降级为成员时被拒", async () => {
    const { owner, team } = await setupTeam();
    await expect(updateMemberRole(owner.id, team.id, owner.id, "student")).rejects.toThrow(
      AppError,
    );
    await expect(updateMemberRole(owner.id, team.id, owner.id, "student")).rejects.toThrow(
      "不能撤销唯一的组长",
    );
  });

  it("指定新组长后，旧组长可以降级", async () => {
    const { owner, team } = await setupTeam();
    const next = await makeUser("next@example.com");
    await joinTeam(next.id, team.inviteCode);

    // 先把成员升为组长，再降级原组长
    await updateMemberRole(owner.id, team.id, next.id, "admin");
    const demoted = await updateMemberRole(owner.id, team.id, owner.id, "student");
    expect(demoted.role).toBe("student");
  });

  it("非组长无法通过改角色把唯一组长降级", async () => {
    const { owner, team } = await setupTeam();
    const member = await makeUser("member@example.com");
    await joinTeam(member.id, team.inviteCode);

    await expect(
      updateMemberRole(member.id, team.id, owner.id, "student"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("入组申请与审核（列表）", () => {
  beforeEach(resetDb);

  it("组长能看到待审申请（含申请人）", async () => {
    const { team } = await setupTeam();
    const applicant = await makeUser("applicant@example.com");
    await applyToJoinTeam(applicant.id, team.id);

    const rows = await listPendingJoinRequests(team.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].userName).toBe("applicant");
  });

  it("拒绝后可重新申请，状态复位 pending", async () => {
    const { owner, team } = await setupTeam();
    const applicant = await makeUser("applicant@example.com");
    const first = await applyToJoinTeam(applicant.id, team.id);
    await reviewJoinRequest(owner.id, first.id, "rejected");

    const again = await applyToJoinTeam(applicant.id, team.id);
    expect(again.status).toBe("pending");
    // 部分唯一索引只约束 pending 行：被拒后重新申请是新增一条 pending，而非原地复位
    expect(again.id).not.toBe(first.id);
  });

  it("申请携带「关注项目」意向", async () => {
    const { owner, team } = await setupTeam();
    const p = await createProject(owner.id, team.id, { name: "南屏晚钟" });
    const applicant = await makeUser("applicant@example.com");
    const req = await applyToJoinTeam(applicant.id, team.id, p.id);

    const rows = await listPendingJoinRequests(team.id);
    expect(req.projectId).toBe(p.id);
    expect(rows[0].projectName).toBe("南屏晚钟");
  });
});

describe("邀请链接生成（权限口径）", () => {
  beforeEach(resetDb);

  it("成员生成链接被拒，组长成功", async () => {
    const { owner, team } = await setupTeam();
    const member = await makeUser("member@example.com");
    await joinTeam(member.id, team.inviteCode);

    await expect(createInviteLink(member.id, team.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const { token, url } = await createInviteLink(owner.id, team.id);
    expect(url).toBe(`/join/${token}`);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });
});
