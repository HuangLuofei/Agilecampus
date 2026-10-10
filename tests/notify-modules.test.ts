import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createDocument, deleteDocument, updateDocument } from "@/lib/document";
import { createResourceUsage, endResourceUsage } from "@/lib/resource";
import { listNotifications } from "@/lib/notification";
import { resetDb } from "./helpers";

type Notif = Awaited<ReturnType<typeof listNotifications>>[number];

// 文档/资源通知都是 fire-and-forget（游离 Promise），轮询等落库再断言
async function waitForNotif(
  userId: string,
  predicate: (n: Notif) => boolean,
  maxMs = 2000,
): Promise<Notif> {
  const start = Date.now();
  for (;;) {
    const hit = (await listNotifications(userId)).find(predicate);
    if (hit) return hit;
    if (Date.now() - start > maxMs) throw new Error("通知未在预期时间内出现");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "通知团队");
  const member = await makeUser("member@example.com");
  await joinTeam(member.id, team.inviteCode);
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "项目A" });
  return { owner, member, outsider, team, project };
}

describe("文档变更通知", () => {
  beforeEach(resetDb);

  it("新建文档 → 团队全员收到，linkUrl 指向文档页，操作者本人已读", async () => {
    const { owner, member, project } = await scene();
    const doc = await createDocument(member.id, project.id, { title: "需求说明" });

    const n = await waitForNotif(owner.id, (i) => i.type === "document_created");
    expect(n.linkUrl).toBe(`/projects/${project.id}/docs/${doc.id}`);
    expect(n.content).toBe("文档《需求说明》已创建");
    expect(n.actorName).toBe("member");
    expect(n.projectName).toBe("项目A");
    expect(n.isRead).toBe(false);

    const own = await waitForNotif(member.id, (i) => i.type === "document_created");
    expect(own.isRead).toBe(true);
  });

  it("编辑文档 → document_updated，linkUrl 指向该文档页", async () => {
    const { owner, member, project } = await scene();
    const doc = await createDocument(member.id, project.id, { title: "需求说明" });
    await updateDocument(member.id, doc.id, { title: "需求说明 v2" });

    const n = await waitForNotif(owner.id, (i) => i.type === "document_updated");
    expect(n.linkUrl).toBe(`/projects/${project.id}/docs/${doc.id}`);
    expect(n.content).toBe("文档《需求说明 v2》发生了更新");
  });

  it("删除文档 → document_deleted，linkUrl 回退到文档列表", async () => {
    const { owner, member, project } = await scene();
    const doc = await createDocument(member.id, project.id, { title: "临时稿" });
    await deleteDocument(member.id, doc.id);

    const n = await waitForNotif(owner.id, (i) => i.type === "document_deleted");
    expect(n.linkUrl).toBe(`/projects/${project.id}/docs`);
    expect(n.content).toBe("文档《临时稿》已被删除");
  });

  it("非团队成员收不到文档通知", async () => {
    const { owner, member, outsider, project } = await scene();
    await createDocument(member.id, project.id, { title: "x" });
    await waitForNotif(owner.id, (i) => i.type === "document_created"); // 确保 fan-out 完成
    expect(await listNotifications(outsider.id)).toHaveLength(0);
  });
});

describe("资源占用通知", () => {
  beforeEach(resetDb);

  it("登记 / 结束占用 → 团队全员收到，linkUrl 指向资源页，操作者本人已读", async () => {
    const { owner, member, team } = await scene();
    const usage = await createResourceUsage(member.id, team.id, {
      resourceName: "3D 打印机",
      startTime: new Date(),
    });

    const logged = await waitForNotif(owner.id, (i) => i.type === "resource_logged");
    expect(logged.linkUrl).toBe(`/teams/${team.id}/resources`);
    expect(logged.content).toBe("登记了资源占用：3D 打印机");
    expect(logged.projectName).toBeNull();

    const own = await waitForNotif(member.id, (i) => i.type === "resource_logged");
    expect(own.isRead).toBe(true);

    await endResourceUsage(member.id, usage.id);
    const ended = await waitForNotif(owner.id, (i) => i.type === "resource_ended");
    expect(ended.linkUrl).toBe(`/teams/${team.id}/resources`);
    expect(ended.content).toBe("结束了资源占用：3D 打印机");
  });

  it("非团队成员收不到资源通知", async () => {
    const { owner, member, outsider, team } = await scene();
    await createResourceUsage(member.id, team.id, {
      resourceName: "示波器",
      startTime: new Date(),
    });
    await waitForNotif(owner.id, (i) => i.type === "resource_logged");
    expect(await listNotifications(outsider.id)).toHaveLength(0);
  });
});
