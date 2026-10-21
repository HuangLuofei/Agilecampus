import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkbenchScope } from "@/lib/workbench";
import { scopedHref } from "@/lib/workbench-navigation";
import { ForbiddenError } from "@/lib/errors";
import { listMyTeamsWithProjects } from "@/lib/project";
import { assertTestDatabase } from "./db-safety";

vi.mock("@/lib/project", () => ({ listMyTeamsWithProjects: vi.fn() }));

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const foreign = "33333333-3333-4333-8333-333333333333";
const memberships = [
  { id: first, name: "甲组", role: "admin" as const, projects: [{ id: "project-a", name: "同名项目" }] },
  { id: second, name: "乙组", role: "student" as const, projects: [] },
];

describe("工作台访问范围", () => {
  beforeEach(() => {
    vi.mocked(listMyTeamsWithProjects).mockReset();
    vi.mocked(listMyTeamsWithProjects).mockResolvedValue(memberships);
  });

  it("全部模式只聚合本人小组，并保留没有项目的小组", async () => {
    const scope = await getWorkbenchScope("actor");
    expect(listMyTeamsWithProjects).toHaveBeenCalledWith("actor");
    expect(scope.teams).toEqual(memberships);
    expect(scope.selectedTeam).toBeNull();
    expect(scope.projectIds).toEqual(["project-a"]);
  });

  it("专注空小组时返回空项目范围，不能回退到全部项目", async () => {
    const scope = await getWorkbenchScope("actor", second);
    expect(scope.selectedTeam?.id).toBe(second);
    expect(scope.projectIds).toEqual([]);
  });

  it("专注只返回目标组项目，同时保留切换列表", async () => {
    const scope = await getWorkbenchScope("actor", first);
    expect(scope.projectIds).toEqual(["project-a"]);
    expect(scope.teams).toHaveLength(2);
  });

  it("未知、未加入和已退出的小组不能通过 URL 获得数据", async () => {
    await expect(getWorkbenchScope("actor", foreign)).rejects.toBeInstanceOf(ForbiddenError);
    vi.mocked(listMyTeamsWithProjects).mockResolvedValue([]);
    await expect(getWorkbenchScope("actor", first)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each(["", "undefined", "not-a-uuid"])("非法 team=%s 在查询前拒绝", async (team) => {
    await expect(getWorkbenchScope("actor", team)).rejects.toBeInstanceOf(ForbiddenError);
    expect(listMyTeamsWithProjects).not.toHaveBeenCalled();
  });
});

describe("专注模式导航", () => {
  it("从任务卡进入项目时保留任务深链、筛选和锚点", () => {
    const href = scopedHref("/projects/p?task=t&priority=high#discussion", first);
    const url = new URL(href, "https://example.test");
    expect(url.searchParams.get("team")).toBe(first);
    expect(url.searchParams.get("task")).toBe("t");
    expect(url.searchParams.get("priority")).toBe("high");
    expect(url.hash).toBe("#discussion");
  });

  it("切换小组替换旧范围，不累积多个 team", () => {
    const href = scopedHref(`/tasks?team=${first}&status=overdue`, second);
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.getAll("team")).toEqual([second]);
    expect(params.get("status")).toBe("overdue");
  });

  it("退出专注只移除 team，保留搜索词及状态", () => {
    const href = scopedHref(`/assets?team=${first}&q=%E5%AE%9E%E9%AA%8C`, null);
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.has("team")).toBe(false);
    expect(params.get("q")).toBe("实验");
    expect(scopedHref(`/projects?team=${first}`, null)).toBe("/projects");
  });
});

describe("集成测试数据库保护", () => {
  it.each([undefined, "postgres://localhost/agilecampus", "invalid", "https://localhost/agilecampus_test"])("拒绝非独立测试库 %s", (url) => {
    expect(() => assertTestDatabase(url)).toThrow("拒绝清理数据库");
  });

  it("相同库即使用户名、协议别名或端口写法不同也拒绝", () => {
    expect(() => assertTestDatabase("postgres://tester@localhost/demo_test", "postgresql://dev@localhost:5432/demo_test"))
      .toThrow("拒绝清理数据库");
    expect(() => assertTestDatabase("postgres://127.0.0.1/demo_test", "postgres://localhost/demo_test"))
      .toThrow("拒绝清理数据库");
  });

  it("允许与开发库分离且显式命名的测试库", () => {
    expect(() => assertTestDatabase("postgres://localhost/agilecampus_test", "postgres://localhost/agilecampus"))
      .not.toThrow();
  });
});
