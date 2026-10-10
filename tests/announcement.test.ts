import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { listNotifications } from "@/lib/notification";
import {
  createAnnouncementComment,
  deleteAnnouncementComment,
  getAnnouncementForUser,
  getAnnouncementReadStats,
  listAnnouncementComments,
  markAnnouncementRead,
  publishAnnouncement,
  updateAnnouncementComment,
} from "@/lib/announcement";
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

  it("成员发布公告：广播给团队全员（含发布者），每行指向公告详情页", async () => {
    const { owner, student, teacher, project } = await scene();
    const ann = await publishAnnouncement(owner.id, project.id, {
      title: "组会通知",
      content: "周三下午开会",
    });

    // 公告实体
    expect(ann.title).toBe("组会通知");
    expect(ann.content).toBe("周三下午开会");
    expect(ann.authorId).toBe(owner.id);
    expect(ann.projectId).toBe(project.id);

    const stuItems = await listNotifications(student.id);
    expect(stuItems).toHaveLength(1);
    expect(stuItems[0].type).toBe("announcement");
    expect(stuItems[0].title).toBe("组会通知");
    expect(stuItems[0].actorName).toBe("owner");
    expect(stuItems[0].projectName).toBe("项目A");
    expect(stuItems[0].linkUrl).toBe(`/messages/announcements/${ann.id}`);

    const teaItems = await listNotifications(teacher.id);
    const ownItems = await listNotifications(owner.id);
    expect(teaItems).toHaveLength(1);
    expect(ownItems).toHaveLength(1); // 发布者本人也收

    // 三行共享同一 announcementId（分组键）
    expect(stuItems[0].announcementId).toBe(ann.id);
    expect(teaItems[0].announcementId).toBe(ann.id);
    expect(ownItems[0].announcementId).toBe(ann.id);
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

describe("getAnnouncementForUser", () => {
  beforeEach(resetDb);

  it("成员可读，返回发布者与项目名", async () => {
    const { owner, student, project } = await scene();
    const ann = await publishAnnouncement(owner.id, project.id, { title: "t", content: "c" });
    const detail = await getAnnouncementForUser(student.id, ann.id);
    expect(detail.announcement.id).toBe(ann.id);
    expect(detail.authorName).toBe("owner");
    expect(detail.projectName).toBe("项目A");
  });

  it("非成员查看被拒", async () => {
    const { owner, outsider, project } = await scene();
    const ann = await publishAnnouncement(owner.id, project.id, { title: "t", content: "c" });
    await expect(getAnnouncementForUser(outsider.id, ann.id)).rejects.toThrow("没有权限");
  });

  it("公告不存在抛可展示错误", async () => {
    const { student } = await scene();
    await expect(
      getAnnouncementForUser(student.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow("公告不存在");
  });
});

describe("公告评论", () => {
  beforeEach(resetDb);

  it("项目成员可评论，列表可读（trim 生效）", async () => {
    const { owner, student, project } = await scene();
    const ann = await publishAnnouncement(owner.id, project.id, { title: "t", content: "c" });
    const c = await createAnnouncementComment(student.id, ann.id, "  收到！  ");
    expect(c.content).toBe("收到！");

    const list = await listAnnouncementComments(owner.id, ann.id);
    expect(list).toHaveLength(1);
    expect(list[0].authorName).toBe("student");
    expect(list[0].content).toBe("收到！");
  });

  it("空评论 / 超长评论被拒", async () => {
    const { owner, student, project } = await scene();
    const ann = await publishAnnouncement(owner.id, project.id, { title: "t", content: "c" });
    await expect(createAnnouncementComment(student.id, ann.id, "   ")).rejects.toThrow("不能为空");
    await expect(createAnnouncementComment(student.id, ann.id, "x".repeat(2001))).rejects.toThrow(
      "2000",
    );
  });

  it("非作者不能编辑，作者可编辑", async () => {
    const { owner, student, project } = await scene();
    const ann = await publishAnnouncement(owner.id, project.id, { title: "t", content: "c" });
    const c = await createAnnouncementComment(student.id, ann.id, "初稿");
    await expect(updateAnnouncementComment(owner.id, c.id, "改")).rejects.toThrow("没有权限");
    const updated = await updateAnnouncementComment(student.id, c.id, "改后");
    expect(updated.content).toBe("改后");
  });

  it("作者可删；管理员可删；软删后不再出现在列表", async () => {
    const { owner, student, teacher, project } = await scene();
    const ann = await publishAnnouncement(owner.id, project.id, { title: "t", content: "c" });
    const c1 = await createAnnouncementComment(student.id, ann.id, "a");
    const c2 = await createAnnouncementComment(teacher.id, ann.id, "b");
    await deleteAnnouncementComment(student.id, c1.id); // 作者删自己的
    await deleteAnnouncementComment(owner.id, c2.id); // owner 是 admin
    expect(await listAnnouncementComments(student.id, ann.id)).toHaveLength(0);
  });

  it("非成员不能评论、不能看评论", async () => {
    const { owner, outsider, project } = await scene();
    const ann = await publishAnnouncement(owner.id, project.id, { title: "t", content: "c" });
    await expect(createAnnouncementComment(outsider.id, ann.id, "x")).rejects.toThrow("没有权限");
    await expect(listAnnouncementComments(outsider.id, ann.id)).rejects.toThrow("没有权限");
  });
});

describe("公告已读统计", () => {
  beforeEach(resetDb);

  it("发布者行发布即已读（1/3）；他人标读后增长且幂等", async () => {
    const { owner, student, project } = await scene();
    const ann = await publishAnnouncement(owner.id, project.id, { title: "t", content: "c" });

    let stats = await getAnnouncementReadStats(owner.id, ann.id);
    expect(stats.total).toBe(3);
    expect(stats.readCount).toBe(1); // 发布者本人

    await markAnnouncementRead(student.id, ann.id);
    stats = await getAnnouncementReadStats(owner.id, ann.id);
    expect(stats.readCount).toBe(2);
    expect(stats.readers.find((r) => r.userId === student.id)?.isRead).toBe(true);

    await markAnnouncementRead(student.id, ann.id); // 幂等
    stats = await getAnnouncementReadStats(owner.id, ann.id);
    expect(stats.readCount).toBe(2);
  });

  it("非收件人标读为 no-op；非成员看统计被拒", async () => {
    const { owner, student, outsider, project } = await scene();
    const ann = await publishAnnouncement(owner.id, project.id, { title: "t", content: "c" });

    const before = await getAnnouncementReadStats(student.id, ann.id);
    await markAnnouncementRead(outsider.id, ann.id); // 无本人行 → no-op
    const after = await getAnnouncementReadStats(student.id, ann.id);
    expect(after.readCount).toBe(before.readCount);

    await expect(getAnnouncementReadStats(outsider.id, ann.id)).rejects.toThrow("没有权限");
  });
});
