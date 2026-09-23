import type { ArtworkProject } from '../models';

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

/** Local persistence of projects. IndexedDB implementation follows in part 8. */
export interface ProjectRepository {
  save(project: ArtworkProject): Promise<void>;
  load(id: string): Promise<ArtworkProject | null>;
  list(): Promise<readonly ProjectSummary[]>;
  remove(id: string): Promise<void>;
}
