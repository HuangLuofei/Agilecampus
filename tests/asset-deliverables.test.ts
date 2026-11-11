import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import {
  createAsset,
  bindTaskToAsset,
  unbindTaskFromAsset,
  updateAsset,
  listProjectAssets,
} from "@/lib/asset";
import { inferDeliverableKind } from "@/lib/asset-deliverables";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({
    email: "owner@test.com",
    password: "pw123456",
    name: "组长",
    studentId: "20260001",
  });
  const member = await createUser({
    email: "member@test.com",
    password: "pw123456",
    name: "组员",
    studentId: "20260002",
  });
  const team = await createTeam(owner.id, "测试团队");
  await joinTeam(member.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "项目" });
  const task = await createTask(owner.id, project.id, { title: "任务" });
  return { owner, member, team, project, task };
}

describe("交付物类型自动预判 inferDeliverableKind", () => {
  it("ppt 系文件 → 演示文稿（MIME 与扩展名、大小写不敏感）", () => {
    expect(
      inferDeliverableKind(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "a.pptx",
        "file",
      ),
    ).toBe("presentation");
    expect(inferDeliverableKind(null, "季度汇报.PPTX", "file")).toBe("presentation");
    expect(inferDeliverableKind(null, "答辩.ppt", "file")).toBe("presentation");
  });

  it("压缩包系文件 → 代码包", () => {
    expect(inferDeliverableKind("application/zip", "src.zip", "file")).toBe("code");
    expect(inferDeliverableKind(null, "code-package.rar", "file")).toBe("code");
    expect(inferDeliverableKind(null, "release.tar.gz", "file")).toBe("code");
    expect(inferDeliverableKind("application/x-7z-compressed", "x", "file")).toBe("code");
  });

  it("名称或链接含问卷特征 → 问卷", () => {
    expect(inferDeliverableKind(null, "用户调研问卷", "link")).toBe("survey");
    expect(inferDeliverableKind(null, "第3期反馈", "link", "https://wj.qq.com/s2/123")).toBe("survey");
    expect(inferDeliverableKind(null, "Survey-Results", "file")).toBe("survey");
  });

  it("无法判断 → null（普通文件）", () => {
    expect(inferDeliverableKind("application/pdf", "需求文档.pdf", "file")).toBeNull();
    expect(inferDeliverableKind(null, "会议纪要", "link", "https://example.com/a")).toBeNull();
    expect(inferDeliverableKind(null, "no-ext", "file")).toBeNull();
  });
});

describe("创建资产写入交付物类型", () => {
  beforeEach(resetDb);

  it("显式指定 deliverableKind 优先生效", async () => {
    const { owner, project } = await scene();
    const asset = await createAsset(owner.id, {
      projectId: project.id,
      name: "汇报材料",
      assetType: "file",
      url: "/uploads/a.pptx",
      deliverableKind: "code",
    });
    expect(asset.deliverableKind).toBe("code");
  });

  it("不指定时按名称/链接自动预判", async () => {
    const { owner, project } = await scene();
    const ppt = await createAsset(owner.id, {
      projectId: project.id,
      name: "期中汇报.pptx",
      assetType: "file",
      url: "/uploads/p.pptx",
    });
    expect(ppt.deliverableKind).toBe("presentation");

    const zip = await createAsset(owner.id, {
      projectId: project.id,
      name: "源码包.zip",
      assetType: "file",
      url: "/uploads/s.zip",
    });
    expect(zip.deliverableKind).toBe("code");

    const survey = await createAsset(owner.id, {
      projectId: project.id,
      name: "满意度调研",
      assetType: "link",
      url: "https://wj.qq.com/s2/999",
    });
    expect(survey.deliverableKind).toBe("survey");

    const plain = await createAsset(owner.id, {
      projectId: project.id,
      name: "会议纪要.pdf",
      assetType: "file",
      url: "/uploads/m.pdf",
    });
    expect(plain.deliverableKind).toBeNull();
  });
});

describe("绑定/解绑任务与类型联动", () => {
  beforeEach(resetDb);

  it("绑定任务后 taskId 落库，列表可按交付物类型分组", async () => {
    const { owner, project, task } = await scene();
    const asset = await createAsset(owner.id, {
      projectId: project.id,
      name: "答辩PPT.pptx",
      assetType: "file",
      url: "/uploads/p.pptx",
    });
    await bindTaskToAsset(owner.id, asset.id, task.id);

    const list = await listProjectAssets(owner.id, project.id);
    const found = list.find((a) => a.id === asset.id);
    expect(found?.taskId).toBe(task.id);
    expect(found?.deliverableKind).toBe("presentation");
  });

  it("绑定时可顺带指定交付物类型", async () => {
    const { owner, project, task } = await scene();
    const asset = await createAsset(owner.id, {
      projectId: project.id,
      name: "资料包.zip",
      assetType: "file",
      url: "/uploads/x.zip",
      deliverableKind: null,
    });
    expect(asset.deliverableKind).toBeNull();

    const updated = await bindTaskToAsset(owner.id, asset.id, task.id, "code");
    expect(updated.taskId).toBe(task.id);
    expect(updated.deliverableKind).toBe("code");
  });

  it("绑定不传类型时沿用原值", async () => {
    const { owner, project, task } = await scene();
    const asset = await createAsset(owner.id, {
      projectId: project.id,
      name: "调研问卷",
      assetType: "link",
      url: "https://wj.qq.com/s2/1",
    });
    expect(asset.deliverableKind).toBe("survey");

    const updated = await bindTaskToAsset(owner.id, asset.id, task.id);
    expect(updated.deliverableKind).toBe("survey");
  });

  it("解除绑定：taskId 清空、资产保留、类型可顺带改", async () => {
    const { owner, project, task } = await scene();
    const asset = await createAsset(owner.id, {
      projectId: project.id,
      name: "汇报.pptx",
      assetType: "file",
      url: "/uploads/p.pptx",
      taskId: task.id,
    });
    const updated = await unbindTaskFromAsset(owner.id, asset.id, null);
    expect(updated.taskId).toBeNull();
    expect(updated.deliverableKind).toBeNull();

    const list = await listProjectAssets(owner.id, project.id);
    expect(list.some((a) => a.id === asset.id)).toBe(true);
  });

  it("改交付物类型：updateAsset 支持改与清空", async () => {
    const { owner, project } = await scene();
    const asset = await createAsset(owner.id, {
      projectId: project.id,
      name: "混合材料",
      assetType: "file",
      url: "/uploads/m.bin",
    });
    expect(asset.deliverableKind).toBeNull();

    const typed = await updateAsset(owner.id, asset.id, { deliverableKind: "presentation" });
    expect(typed.deliverableKind).toBe("presentation");

    const cleared = await updateAsset(owner.id, asset.id, { deliverableKind: null });
    expect(cleared.deliverableKind).toBeNull();
  });

  it("归档资产禁止绑定与改类型", async () => {
    const { owner, project, task } = await scene();
    const asset = await createAsset(owner.id, {
      projectId: project.id,
      name: "旧资料.zip",
      assetType: "file",
      url: "/uploads/o.zip",
    });
    await updateAsset(owner.id, asset.id, { isArchived: true });

    await expect(bindTaskToAsset(owner.id, asset.id, task.id)).rejects.toThrow();
    await expect(
      updateAsset(owner.id, asset.id, { deliverableKind: "code" }),
    ).rejects.toThrow();
  });

  it("任务不存在于项目时绑定被拒", async () => {
    const { owner, member, project } = await scene();
    const otherProject = await createProject(owner.id, (await createTeam(owner.id, "另一个团队")).id, {
      name: "别组项目",
    });
    const otherTask = await createTask(owner.id, otherProject.id, { title: "别组任务" });

    const asset = await createAsset(owner.id, {
      projectId: project.id,
      name: "本组文件.pdf",
      assetType: "file",
      url: "/uploads/b.pdf",
    });
    await expect(bindTaskToAsset(owner.id, asset.id, otherTask.id)).rejects.toThrow();
    void member;
  });
});
