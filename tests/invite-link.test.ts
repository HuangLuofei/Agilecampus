import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import {
  applyToJoinTeam,
  createInviteLink,
  createTeam,
  getTeamMembership,
  reviewJoinRequest,
  joinTeam,
  listInviteLinks,
  revokeInviteLink,
  resolveInviteToken,
} from "@/lib/team";
import { ForbiddenError } from "@/lib/errors";
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

describe("createInviteLink（token 契约）", () => {
  beforeEach(resetDb);

  it("明文 token 只回传一次；库中仅存 sha256，两链接 token 不重复", async () => {
    const { owner, team } = await setupTeam();
    const a = await createInviteLink(owner.id, team.id);
    const b = await createInviteLink(owner.id, team.id);
    expect(a.token).not.toBe(b.token);
    expect(a.link.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.link.tokenHash).not.toContain(a.token);
    expect(a.link.revokedAt).toBeNull();
  });

  it("expiresInDays 写入过期时间；缺省为长期", async () => {
    const { owner, team } = await setupTeam();
    const { link } = await createInviteLink(owner.id, team.id, { expiresInDays: 7 });
    expect(link.expiresAt).not.toBeNull();
    const diff = link.expiresAt!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(6 * 24 * 3600 * 1000);
    expect(diff).toBeLessThan(8 * 24 * 3600 * 1000);

    const longLived = await createInviteLink(owner.id, team.id);
    expect(longLived.link.expiresAt).toBeNull();
  });

  it("关联项目：项目必须属于本团队", async () => {
    const { owner, team } = await setupTeam();
    const other = await makeUser("other@example.com");
    const otherTeam = await createTeam(other.id, "曹魏参谋部");
    const foreignProject = await createProject(other.id, otherTeam.id, { name: "他组项目" });

    await expect(
      createInviteLink(owner.id, team.id, { projectId: foreignProject.id }),
    ).rejects.toThrow("项目不属于该团队");

    const mine = await createProject(owner.id, team.id, { name: "本组项目" });
    const { link } = await createInviteLink(owner.id, team.id, { projectId: mine.id });
    expect(link.projectId).toBe(mine.id);
  });
});

describe("resolveInviteToken（落地页解析）", () => {
  beforeEach(resetDb);

  it("有效链接解析出团队与项目", async () => {
    const { owner, team } = await setupTeam();
    const p = await createProject(owner.id, team.id, { name: "本组项目" });
    const { token } = await createInviteLink(owner.id, team.id, { projectId: p.id });

    const resolved = await resolveInviteToken(token);
    expect(resolved).not.toBeNull();
    expect(resolved!.team.id).toBe(team.id);
    expect(resolved!.project?.id).toBe(p.id);
  });

  it("不存在的 token 返回 null（不泄露细节）", async () => {
    expect(await resolveInviteToken("no-such-token")).toBeNull();
  });

  it("已撤销链接不能继续申请", async () => {
    const { owner, team } = await setupTeam();
    const { link, token } = await createInviteLink(owner.id, team.id);
    await revokeInviteLink(owner.id, link.id);
    expect(await resolveInviteToken(token)).toBeNull();
  });

  it("过期链接失效", async () => {
    const { owner, team } = await setupTeam();
    const expired = await createInviteLink(owner.id, team.id, { expiresInDays: 1 });

    // 直接改库模拟已过期的 expiresAt
    const { eq } = await import("drizzle-orm");
    const { teamInviteLinks } = await import("@/db/schema");
    const { db } = await import("@/db");
    await db
      .update(teamInviteLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(teamInviteLinks.id, expired.link.id));

    expect(await resolveInviteToken(expired.token)).toBeNull();
  });
});

describe("revokeInviteLink", () => {
  beforeEach(resetDb);

  it("组长可撤销；重复撤销报可展示错误；成员撤销被拒", async () => {
    const { owner, team } = await setupTeam();
    const member = await makeUser("member@example.com");
    await joinTeam(member.id, team.inviteCode);
    const { link } = await createInviteLink(owner.id, team.id);

    await expect(revokeInviteLink(member.id, link.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const updated = await revokeInviteLink(owner.id, link.id);
    expect(updated.revokedAt).not.toBeNull();
    await expect(revokeInviteLink(owner.id, link.id)).rejects.toThrow("链接已撤销");
  });

  it("组长列表能看到撤销状态", async () => {
    const { owner, team } = await setupTeam();
    const { link } = await createInviteLink(owner.id, team.id);
    await revokeInviteLink(owner.id, link.id);

    const rows = await listInviteLinks(owner.id, team.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).not.toBeNull();
    void link;
  });
});

describe("邀请链接完整流程：未登录→登录→申请→审核", () => {
  beforeEach(resetDb);

  it("申请→待审→通过→入组（只加入小组语义）", async () => {
    const { owner, team } = await setupTeam();
    const applicant = await makeUser("applicant@example.com");
    const { token } = await createInviteLink(owner.id, team.id);
    const resolved = await resolveInviteToken(token);
    expect(resolved!.team.id).toBe(team.id);

    const req = await applyToJoinTeam(applicant.id, resolved!.team.id);
    expect(req.status).toBe("pending");

    // 待审期间不在成员表
    expect(await getTeamMembership(applicant.id, team.id)).toBeNull();

    await reviewJoinRequest(owner.id, req.id, "approved");
    const m = await getTeamMembership(applicant.id, team.id);
    expect(m?.role).toBe("student");
  });

  it("「加入小组并关注某项目」语义：记录意向项目，项目权限仍随小组成员关系", async () => {
    const { owner, team } = await setupTeam();
    const p = await createProject(owner.id, team.id, { name: "本组项目" });
    const { token } = await createInviteLink(owner.id, team.id, { projectId: p.id });
    const resolved = await resolveInviteToken(token);
    expect(resolved!.project?.id).toBe(p.id);

    const applicant = await makeUser("applicant@example.com");
    const req = await applyToJoinTeam(applicant.id, team.id, p.id);
    expect(req.projectId).toBe(p.id);
    await reviewJoinRequest(owner.id, req.id, "approved");

    // 入组即拥有项目访问权（通过小组成员关系推导），无需单独项目授权表
    const m = await getTeamMembership(applicant.id, team.id);
    expect(m).not.toBeNull();
  });

  it("重复申请：pending 期间报错；审核通过后再申请提示已在团队", async () => {
    const { owner, team } = await setupTeam();
    const applicant = await makeUser("applicant@example.com");
    const first = await applyToJoinTeam(applicant.id, team.id);
    await expect(applyToJoinTeam(applicant.id, team.id)).rejects.toThrow("已提交过申请");

    await reviewJoinRequest(owner.id, first.id, "approved");
    await expect(applyToJoinTeam(applicant.id, team.id)).rejects.toThrow("已在该团队中");
  });
});
