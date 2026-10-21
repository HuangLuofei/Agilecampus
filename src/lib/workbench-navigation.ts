// Client-safe helpers; keep membership/database imports out of navigation components.
export function scopedHref(href: string, teamId?: string | null): string {
  const [pathAndQuery, hash] = href.split("#", 2);
  const [pathname, query] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(query);
  if (teamId) params.set("team", teamId);
  else params.delete("team");
  const suffix = params.toString();
  return `${pathname}${suffix ? `?${suffix}` : ""}${hash ? `#${hash}` : ""}`;
}

export function displayStudentRole(role: string) {
  return role === "admin" ? "组长" : "成员";
}
