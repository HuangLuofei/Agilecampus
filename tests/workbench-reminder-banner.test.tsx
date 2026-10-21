import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DueReminderBanner } from "@/app/(app)/due-reminder-banner";

const state = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query) }));

const summaries = [
  { teamId: "a", overdue: 1, dueSoon: 2, urgent: 2 },
  { teamId: "b", overdue: 4, dueSoon: 5, urgent: 6 },
];

function render() {
  return renderToStaticMarkup(<DueReminderBanner summaries={summaries} teamIds={["a", "b", "empty"]} />);
}

describe("专注模式提醒", () => {
  beforeEach(() => { state.query = ""; });

  it("全部模式显示汇总数量", () => {
    const html = render();
    expect(html).toContain("5 个逾期 · 7 个临期");
    expect(html).not.toContain("其他小组");
  });

  it("切换小组后只显示本组提醒，其他组强提醒保留数量入口", () => {
    state.query = "team=a";
    const html = render();
    expect(html).toContain("1 个逾期 · 2 个临期");
    expect(html).toContain("其他小组 6 个强提醒");
    expect(html).toContain('href="/projects?attention=due&amp;team=a"');
    expect(html).toContain('href="/projects?attention=urgent"');
    expect(html).not.toContain("4 个逾期");
  });

  it("空小组不能展示其他组提醒明细，但强提醒入口仍可访问", () => {
    state.query = "team=empty";
    const html = render();
    expect(html).toContain("当前小组暂无到期任务");
    expect(html).toContain("其他小组 8 个强提醒");
    expect(html).not.toContain("个临期");
  });

  it("没有任何到期风险时不占据顶部空间", () => {
    expect(renderToStaticMarkup(<DueReminderBanner summaries={[]} teamIds={[]} />)).toBe("");
  });

  it("单项目提醒直接跳看板并保留当前小组", () => {
    state.query = "team=a";
    const html = renderToStaticMarkup(<DueReminderBanner
      summaries={[{ ...summaries[0], projectIds: ["project-a"] }, { ...summaries[1], projectIds: ["project-b"] }]}
      teamIds={["a", "b"]}
    />);
    expect(html).toContain('href="/projects/project-a?team=a"');
    expect(html).toContain('href="/projects?attention=urgent"');
  });

  it("全部模式单项目仍直接跳看板，多项目转提醒列表", () => {
    const single = renderToStaticMarkup(<DueReminderBanner summaries={[{ ...summaries[0], projectIds: ["project-a"] }]} teamIds={["a"]} />);
    expect(single).toContain('href="/projects/project-a"');
    const multiple = renderToStaticMarkup(<DueReminderBanner summaries={[{ ...summaries[0], projectIds: ["project-a", "project-b"] }]} teamIds={["a"]} />);
    expect(multiple).toContain('href="/projects?attention=due"');
  });
});
