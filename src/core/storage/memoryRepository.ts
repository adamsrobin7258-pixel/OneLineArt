import type { ArtworkProject } from '../models';
import type { ProjectRepository, ProjectSummary } from './types';

/** In-memory repository for tests and as a fallback. */
export function createMemoryRepository(): ProjectRepository {
  const projects = new Map<string, ArtworkProject>();
  return {
    async save(project) {
      projects.set(project.id, project);
    },
    async load(id) {
      return projects.get(id) ?? null;
    },
    async list() {
      return [...projects.values()]
        .map((p): ProjectSummary => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async remove(id) {
      projects.delete(id);
    },
  };
}
