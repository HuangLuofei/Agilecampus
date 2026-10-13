import { redirect } from "next/navigation";

// 设置入口收敛为「技能标签 / 访问令牌」两个子页，此页不再承载内容。
export default async function SettingsPage() {
  redirect("/settings/profile");
}
