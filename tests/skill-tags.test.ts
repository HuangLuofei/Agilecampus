import { describe, it, expect, beforeEach } from "vitest";
import { createUser, updateMySkillTags } from "@/lib/user";
import { createTeam, listTeamMembers } from "@/lib/team";
import { createProject } from "@/lib/project";
import { buildProjectSnapshot } from "@/lib/agent/snapshot";
import { normalizeSkillTags, PRESET_SKILL_TAGS, SKILL_TAG_MAX_COUNT } from "@/lib/skill-tags";
import { resetDb } from "./helpers";

describe("normalizeSkillTags", () => {
  it("trim、去空、去重且保序", () => {
    expect(normalizeSkillTags([" 前端 ", "", "算法", "前端"])).toEqual(["前端", "算法"]);
  });

  it("单个标签超长抛错", () => {
    expect(() => normalizeSkillTags(["一二三四五六七八九十十一十二十三"])).toThrow(
      "超过 12 个字",
    );
  });

  it("超过 10 个抛错", () => {
    expect(() => normalizeSkillTags(Array.from({ length: 11 }, (_, i) => `技能${i}`))).toThrow(
      "最多 10 个",
    );
  });

  it("预设标签库本身全部合法", () => {
    // 预设库是「目录」，可宽于个人上限；但每个标签须合规，且目录不超个人上限的合理范围
    for (const t of PRESET_SKILL_TAGS) {
      expect(() => normalizeSkillTags([t])).not.toThrow();
    }
    expect(PRESET_SKILL_TAGS.length).toBeLessThanOrEqual(2 * SKILL_TAG_MAX_COUNT);
  });
});

describe("updateMySkillTags", () => {
  beforeEach(resetDb);

  it("保存后读回，并随 listTeamMembers 返回", async () => {
    const u = await createUser({ email: "skill@e.com", password: "password123", name: "术士" });
    const team = await createTeam(u.id, "东吴实验室");
    await updateMySkillTags(u.id, [" 前端 ", "算法", "前端"]);

    const members = await listTeamMembers(team.id);
    expect(members).toHaveLength(1);
    expect(members[0].skillTags).toEqual(["前端", "算法"]);
  });

  it("可清空为空数组", async () => {
    const u = await createUser({ email: "skill2@e.com", password: "password123", name: "哨探" });
    const team = await createTeam(u.id, "江东水军");
    await updateMySkillTags(u.id, ["测试"]);
    await updateMySkillTags(u.id, []);

    const members = await listTeamMembers(team.id);
    expect(members[0].skillTags).toEqual([]);
  });
});

describe("快照含技能标签", () => {
  beforeEach(resetDb);

  it("成员段附技能，供 AI 分工参考", async () => {
    const owner = await createUser({
      email: "owner@e.com",
      password: "password123",
      name: "主帅",
    });
    const team = await createTeam(owner.id, "东吴实验室");
    const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
    await updateMySkillTags(owner.id, ["算法", "数据分析"]);

    const snap = await buildProjectSnapshot(owner.id, project.id);
    expect(snap).toContain("主帅｜admin｜技能 算法/数据分析｜id=");
  });
});
