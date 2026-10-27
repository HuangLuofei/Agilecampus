import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { createDocument, updateDocument, deleteDocument } from "@/lib/document";
import { createDocumentAction, updateDocumentAction, deleteDocumentAction } from "@/app/(app)/projects/[projectId]/docs/actions";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/document", () => ({ createDocument: vi.fn(), updateDocument: vi.fn(), deleteDocument: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));

const projectId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const teamId = "33333333-3333-4333-8333-333333333333";

function form(team: string | null = teamId) {
  const data = new FormData();
  data.set("projectId", projectId);
  data.set("documentId", documentId);
  data.set("title", "文档标题");
  if (team != null) data.set("team", team);
  return data;
}

describe("文档操作后保留工作台专注范围", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Auth.js overloads its callable; these actions only use the no-argument session form.
    vi.mocked(auth).mockResolvedValue({ user: { id: "actor" } } as never);
    vi.mocked(createDocument).mockResolvedValue({ id: documentId } as Awaited<ReturnType<typeof createDocument>>);
  });

  it("创建完成后进入当前小组的文档，并继续使用服务端登录身份", async () => {
    await expect(createDocumentAction(null, form())).rejects
      .toThrow(`REDIRECT:/projects/${projectId}/docs/${documentId}?team=${teamId}`);
    expect(createDocument).toHaveBeenCalledWith("actor", projectId, expect.objectContaining({ title: "文档标题" }));
  });

  it("保存和删除均保留小组 URL", async () => {
    await expect(updateDocumentAction(null, form())).rejects
      .toThrow(`REDIRECT:/projects/${projectId}/docs/${documentId}?team=${teamId}`);
    await expect(deleteDocumentAction(form())).rejects
      .toThrow(`REDIRECT:/projects/${projectId}/docs?team=${teamId}`);
  });

  it("从全部模式操作时不会凭空开启专注", async () => {
    await expect(createDocumentAction(null, form(null))).rejects
      .toThrow(`REDIRECT:/projects/${projectId}/docs/${documentId}`);
  });

  it("非法小组值在写入前拒绝，不能被当作跳转地址", async () => {
    expect(await createDocumentAction(null, form("https://example.test"))).toHaveProperty("error");
    expect(await updateDocumentAction(null, form("invalid"))).toHaveProperty("error");
    await expect(deleteDocumentAction(form("invalid"))).rejects.toThrow("参数无效");
    expect(createDocument).not.toHaveBeenCalled();
    expect(updateDocument).not.toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("未登录时不写文档", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await createDocumentAction(null, form())).toEqual({ error: "请先登录" });
    expect(createDocument).not.toHaveBeenCalled();
  });
});
