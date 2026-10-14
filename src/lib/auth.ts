import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "./password";

const credentialsSchema = z.object({
  // 登录标识：邮箱或学号二选一
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const identifier = parsed.data.email;
        // 含 @ 按邮箱匹配（统一小写），否则按学号精确匹配
        const [user] = await db
          .select()
          .from(users)
          .where(
            identifier.includes("@")
              ? eq(users.email, identifier.toLowerCase())
              : or(eq(users.studentId, identifier), eq(users.email, identifier.toLowerCase())),
          );
        if (!user) return null;

        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = token.id as string;
      return session;
    },
  },
});
