// A signed-in session with no membership is sent to project creation rather
// than to a project route, which would redirect straight back to login.
// Removing someone from their only project leaves them in exactly this state.
export function landingRoute(auth) {
  const project = auth.projects[0];

  return project
    ? { name: 'deliveries', params: { projectId: project.id } }
    : { name: 'new-project' };
}
