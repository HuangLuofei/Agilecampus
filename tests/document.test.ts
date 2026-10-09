import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import {
  createDocument,
  updateDocument,
  deleteDocument,
  listProjectDocuments,
  listDocumentCategories,
  getDocument,
} from "@/lib/document";
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

describe("createDocument", () => {
  beforeEach(resetDb);

  it("项目成员可创建文档（含分类与正文）", async () => {
    const { student, project } = await scene();
    const doc = await createDocument(student.id, project.id, {
      title: "需求文档",
      content: "# 标题\n内容",
      category: "需求",
    });
    expect(doc.projectId).toBe(project.id);
    expect(doc.createdById).toBe(student.id);
    expect(doc.category).toBe("需求");
  });

  it("空标题被拒", async () => {
    const { student, project } = await scene();
    await expect(createDocument(student.id, project.id, { title: "   " })).rejects.toThrow(
      "标题",
    );
  });

  it("非成员创建被拒", async () => {
    const { outsider, project } = await scene();
    await expect(
      createDocument(outsider.id, project.id, { title: "越权" }),
    ).rejects.toThrow("没有权限");
  });
});

describe("updateDocument / deleteDocument", () => {
  beforeEach(resetDb);

  it("成员可编辑他人文档（全员可编辑口径），并刷新更新人", async () => {
    const { student, teacher, project } = await scene();
    const doc = await createDocument(student.id, project.id, { title: "旧标题" });
    const updated = await updateDocument(teacher.id, doc.id, { title: "新标题" });
    expect(updated.title).toBe("新标题");
    expect(updated.updatedById).toBe(teacher.id);

    const fetched = await getDocument(teacher.id, doc.id);
    expect(fetched?.title).toBe("新标题");
    expect(fetched?.updatedByName).toBe("teacher");
    expect(fetched?.createdByName).toBe("student");
  });

  it("编辑空标题被拒", async () => {
    const { student, project } = await scene();
    const doc = await createDocument(student.id, project.id, { title: "合法" });
    await expect(updateDocument(student.id, doc.id, { title: "  " })).rejects.toThrow("标题");
  });

  it("成员可删除文档", async () => {
    const { student, teacher, project } = await scene();
    const doc = await createDocument(student.id, project.id, { title: "要删" });
    await deleteDocument(teacher.id, doc.id);
    expect(await getDocument(student.id, doc.id)).toBeNull();
  });

  it("非成员编辑/删除被拒", async () => {
    const { student, outsider, project } = await scene();
    const doc = await createDocument(student.id, project.id, { title: "护盾" });
    await expect(updateDocument(outsider.id, doc.id, { title: "篡改" })).rejects.toThrow(
      "没有权限",
    );
    await expect(deleteDocument(outsider.id, doc.id)).rejects.toThrow("没有权限");
  });
});

describe("listProjectDocuments / listDocumentCategories / getDocument", () => {
  beforeEach(resetDb);

  it("按标题/正文关键词搜索，按分类过滤", async () => {
    const { student, project } = await scene();
    await createDocument(student.id, project.id, {
      title: "需求文档",
      content: "系统的功能清单",
      category: "需求",
    });
    await createDocument(student.id, project.id, {
      title: "会议纪要",
      content: "讨论部署方案",
      category: "会议",
    });

    // 正文命中「部署」仅会议纪要
    const byContent = await listProjectDocuments(student.id, project.id, { q: "部署" });
    expect(byContent.map((d) => d.title)).toEqual(["会议纪要"]);

    // 标题命中「需求」仅需求文档
    const byTitle = await listProjectDocuments(student.id, project.id, { q: "需求" });
    expect(byTitle.map((d) => d.title)).toEqual(["需求文档"]);

    // 分类过滤
    const byCategory = await listProjectDocuments(student.id, project.id, {
      category: "需求",
    });
    expect(byCategory.map((d) => d.title)).toEqual(["需求文档"]);
  });

  it("列出分类（去重，忽略空分类）", async () => {
    const { student, project } = await scene();
    await createDocument(student.id, project.id, { title: "A", category: "需求" });
    await createDocument(student.id, project.id, { title: "B", category: "需求" });
    await createDocument(student.id, project.id, { title: "C", category: "会议" });
    await createDocument(student.id, project.id, { title: "D" }); // 无分类

    const categories = await listDocumentCategories(student.id, project.id);
    expect(categories).toEqual(["会议", "需求"]); // 按中文排序
  });

  it("列表按更新时间倒序", async () => {
    const { student, project } = await scene();
    const a = await createDocument(student.id, project.id, { title: "早" });
    const b = await createDocument(student.id, project.id, { title: "晚" });
    await updateDocument(student.id, a.id, { title: "早（更新）" });

    const docs = await listProjectDocuments(student.id, project.id);
    expect(docs[0].id).toBe(a.id); // a 更新时间最晚
    expect(docs[1].id).toBe(b.id);
  });

  it("非成员查看被拒，越权取单文档返回 null", async () => {
    const { student, outsider, project } = await scene();
    const doc = await createDocument(student.id, project.id, { title: "私密" });

    await expect(listProjectDocuments(outsider.id, project.id)).rejects.toThrow("没有权限");
    expect(await getDocument(outsider.id, doc.id)).toBeNull();
    expect(await getDocument(student.id, crypto.randomUUID())).toBeNull();
  });
});
