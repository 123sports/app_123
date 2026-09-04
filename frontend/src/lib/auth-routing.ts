export type ApplicationRole = "admin" | "professor" | "aluno";

export function destinationForRoles(
  roles: ReadonlyArray<{ role: ApplicationRole | string }>,
): "/admin" | "/app" {
  return roles.some(({ role }) => role === "admin" || role === "professor") ? "/admin" : "/app";
}
