import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  setTaskSuccessors: vi.fn(),
  setTaskLabels: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/task", () => ({
  createTask: mocks.createTask,
  updateTask: mocks.updateTask,
  deleteTask: mocks.deleteTask,
  setTaskSuccessors: mocks.setTaskSuccessors,
}));
vi.mock("@/lib/label", () => ({ setTaskLabels: mocks.setTaskLabels }));

import {
  createTaskAction, deleteTaskAction, moveTaskAction, updateTaskAction,
} from "@/app/(app)/projects/[projectId]/actions";

const projectId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";

function form() {
  const data = new FormData();
  data.set("projectId", projectId);
  data.set("taskId", taskId);
  data.set("title", "当前任务");
  data.set("priority", "high");
  return data;
}

const cases = [
  { name: "创建", run: () => createTaskAction(null, form()), write: mocks.createTask },
  { name: "拖拽状态", run: () => moveTaskAction({ projectId, taskId, patch: { status: "done" } }), write: mocks.updateTask },
  { name: "编辑", run: () => updateTaskAction(null, form()), write: mocks.updateTask },
  { name: "删除", run: () => deleteTaskAction(null, form()), write: mocks.deleteTask },
];

describe("任务操作与工作台、共享提醒同步", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "actor" } });
  });

  it.each(cases)("$name：等待写入成功后刷新项目和共享布局", async ({ run, write }) => {
    let finish!: () => void;
    write.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const operation = run();
    await vi.waitFor(() => expect(write).toHaveBeenCalled());
    expect(write.mock.calls[0][0]).toBe("actor");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    finish();
    await operation;
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${projectId}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each(cases)("$name：写入失败不刷新为成功状态", async ({ run, write }) => {
    write.mockRejectedValue(new AppError("操作失败"));
    expect(await run()).toHaveProperty("error");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(cases)("$name：未登录不写入或刷新", async ({ run, write }) => {
    mocks.auth.mockResolvedValue(null);
    expect(await run()).toEqual({ error: "请先登录" });
    expect(write).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
