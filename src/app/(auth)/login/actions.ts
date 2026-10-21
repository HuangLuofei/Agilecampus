"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export type FormState = { error: string } | null;

// 仅接受站内相对路径（以单个 / 开头），防开放重定向
function safeRedirectTarget(raw: FormData | null): string {
  const v = raw?.get("redirectTo");
  if (typeof v !== "string") return "/teams";
  if (!v.startsWith("/") || v.startsWith("//")) return "/teams";
  return v;
}

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: safeRedirectTarget(formData),
    });
    return null;
  } catch (e) {
    if (e instanceof AuthError) return { error: "账号（邮箱/学号）或密码不正确" };
    throw e; // signIn 成功时抛出的 redirect 必须继续上抛
  }
}
