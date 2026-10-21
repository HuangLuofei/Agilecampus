// Database tests truncate their fixtures. Never accept a missing URL or the development database.
export function assertTestDatabase(databaseUrl: string | undefined, developmentUrl?: string) {
  const fail = () => { throw new Error("拒绝清理数据库：请配置独立的 *_test 测试库，且不能与 .env 开发库相同"); };
  if (!databaseUrl) return fail();
  let target: URL;
  try { target = new URL(databaseUrl); } catch { return fail(); }
  if (!["postgres:", "postgresql:"].includes(target.protocol)) return fail();
  if (!decodeURIComponent(target.pathname.slice(1)).endsWith("_test")) return fail();
  if (developmentUrl) {
    const development = new URL(developmentUrl);
    // Reject the same database name conservatively, even behind host aliases or a tunnel.
    if (decodeURIComponent(target.pathname) === decodeURIComponent(development.pathname)) return fail();
  }
}
