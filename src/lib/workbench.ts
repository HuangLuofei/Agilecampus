import { z } from "zod";
import { listMyTeamsWithProjects } from "./project";
import { ForbiddenError } from "./errors";

// Only resolve against the caller's memberships; a URL parameter never grants access.
export async function getWorkbenchScope(actorId: string, teamId?: string | null) {
  if (teamId != null && !z.uuid().safeParse(teamId).success) throw new ForbiddenError();
  const teams = await listMyTeamsWithProjects(actorId);
  const selectedTeam = teamId == null ? null : teams.find((team) => team.id === teamId);
  if (teamId != null && !selectedTeam) throw new ForbiddenError();
  const visibleTeams = selectedTeam ? [selectedTeam] : teams;
  return {
    teams,
    selectedTeam: selectedTeam ?? null,
    projectIds: visibleTeams.flatMap((team) => team.projects.map((project) => project.id)),
  };
}
