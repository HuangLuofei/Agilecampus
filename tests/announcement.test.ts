import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { publishAnnouncement, listNotifications } from "@/lib/notification";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "项目A" });
  return { owner, team, project, student, teacher, outsider };
}

describe("publishAnnouncement", () => {
  beforeEach(resetDb);

  it("成员发布公告：广播给团队他人，写明发布者与项目", async () => {
    const { owner, student, teacher, project } = await scene();
    await publishAnnouncement(owner.id, project.id, {
      title: "组会通知",
      content: "周三下午开会",
    });

    const stuItems = await listNotifications(student.id);
    expect(stuItems).toHaveLength(1);
    expect(stuItems[0].type).toBe("announcement");
    expect(stuItems[0].title).toBe("组会通知");
    expect(stuItems[0].actorName).toBe("owner");
    expect(stuItems[0].projectName).toBe("项目A");

    expect(await listNotifications(teacher.id)).toHaveLength(1);
    expect(await listNotifications(owner.id)).toHaveLength(0); // 发布者本人不收
  });

  it("非成员发布被拒", async () => {
    const { outsider, project } = await scene();
    await expect(
      publishAnnouncement(outsider.id, project.id, { title: "x", content: "y" }),
    ).rejects.toThrow("没有权限");
  });

  it("空标题 / 空内容被拒", async () => {
    const { owner, project } = await scene();
    await expect(
      publishAnnouncement(owner.id, project.id, { title: "  ", content: "y" }),
    ).rejects.toThrow("标题");
    await expect(
      publishAnnouncement(owner.id, project.id, { title: "x", content: "  " }),
    ).rejects.toThrow("内容");
  });
});
