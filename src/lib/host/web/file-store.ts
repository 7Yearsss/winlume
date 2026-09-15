import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Artifact, Message, Project, Session } from "@/lib/agent/types";
import type { ArtifactStore, ProjectStore, SessionStore } from "@/lib/host/ports";
import type { ToolJobStore } from "@/lib/studio/tool-jobs";
import { createLocalArtifactBlobStore, type ArtifactBlobStore } from "./artifact-blob-store";
import { createToolJobStore } from "./tool-job-store";
import {
  artifactsIndexPath,
  projectFilePath,
  projectsIndexPath,
  sessionFilePath,
  sessionsIndexPath,
  storageKeyFor,
  userDir,
} from "./paths";

interface SessionFile {
  session: Session;
  messages: Message[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** Atomic write: temp file in same dir + rename. */
function atomicWriteFile(filePath: string, data: string | Buffer): void {
  ensureDir(dirname(filePath));
  const tmp = join(dirname(filePath), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore cleanup errors */
    }
    throw err;
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  const raw = readFileSync(filePath, "utf8");
  if (!raw.trim()) return fallback;
  return JSON.parse(raw) as T;
}

function writeJsonFile(filePath: string, value: unknown): void {
  atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createSessionStore(rootDir: string): SessionStore {
  function readIndex(userId: string): Session[] {
    return readJsonFile<Session[]>(sessionsIndexPath(rootDir, userId), []);
  }

  function writeIndex(userId: string, sessions: Session[]): void {
    writeJsonFile(sessionsIndexPath(rootDir, userId), sessions);
  }

  function readSessionFile(userId: string, sessionId: string): SessionFile | null {
    const path = sessionFilePath(rootDir, userId, sessionId);
    if (!existsSync(path)) return null;
    return readJsonFile<SessionFile | null>(path, null);
  }

  function writeSessionFile(userId: string, data: SessionFile): void {
    writeJsonFile(sessionFilePath(rootDir, userId, data.session.id), data);
  }

  return {
    async listSessions(userId, projectId) {
      const sessions = readIndex(userId);
      return [...sessions]
        .filter((session) => projectId === undefined || session.projectId === projectId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async getSession(userId, sessionId) {
      const file = readSessionFile(userId, sessionId);
      if (file) return file.session;
      const fromIndex = readIndex(userId).find((s) => s.id === sessionId);
      return fromIndex ?? null;
    },

    async createSession(input) {
      ensureDir(userDir(rootDir, input.userId));
      const createdAt = input.createdAt ?? nowIso();
      const session: Session = {
        id: input.id,
        userId: input.userId,
        title: input.title,
        model: input.model,
        ...(input.archived !== undefined ? { archived: input.archived } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.pinnedSkillIds !== undefined
          ? { pinnedSkillIds: input.pinnedSkillIds }
          : {}),
        ...(input.capabilityPresetId !== undefined
          ? { capabilityPresetId: input.capabilityPresetId }
          : {}),
        ...(input.codexThreadId !== undefined
          ? { codexThreadId: input.codexThreadId }
          : {}),
        createdAt,
        updatedAt: createdAt,
      };

      const index = readIndex(input.userId);
      if (index.some((s) => s.id === session.id)) {
        throw new Error(`Session already exists: ${session.id}`);
      }
      index.push(session);
      writeIndex(input.userId, index);
      writeSessionFile(input.userId, { session, messages: [] });
      return session;
    },

    async updateSession(userId, sessionId, patch) {
      const file = readSessionFile(userId, sessionId);
      if (!file) throw new Error(`Session not found: ${sessionId}`);

      const session: Session = {
        ...file.session,
        ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        // Allow [] to clear pins; omit key when undefined so pins are unchanged
        ...(patch.pinnedSkillIds !== undefined
          ? { pinnedSkillIds: patch.pinnedSkillIds }
          : {}),
        ...(patch.codexThreadId !== undefined
          ? { codexThreadId: patch.codexThreadId }
          : {}),
        updatedAt: nowIso(),
      };
      if (patch.capabilityPresetId !== undefined) {
        if (patch.capabilityPresetId === null) {
          delete session.capabilityPresetId;
        } else {
          session.capabilityPresetId = patch.capabilityPresetId;
        }
      }
      if (patch.projectId !== undefined) {
        if (patch.projectId === null) delete session.projectId;
        else session.projectId = patch.projectId;
      }
      writeSessionFile(userId, { session, messages: file.messages });

      const index = readIndex(userId);
      const i = index.findIndex((s) => s.id === sessionId);
      if (i >= 0) {
        index[i] = session;
      } else {
        index.push(session);
      }
      writeIndex(userId, index);
      return session;
    },

    async deleteSession(userId, sessionId) {
      const path = sessionFilePath(rootDir, userId, sessionId);
      if (existsSync(path)) unlinkSync(path);
      writeIndex(
        userId,
        readIndex(userId).filter((s) => s.id !== sessionId),
      );
    },

    async listMessages(userId, sessionId) {
      const file = readSessionFile(userId, sessionId);
      return file?.messages ?? [];
    },

    async appendMessages(userId, sessionId, messages) {
      const file = readSessionFile(userId, sessionId);
      if (!file) throw new Error(`Session not found: ${sessionId}`);

      const session: Session = {
        ...file.session,
        updatedAt: nowIso(),
      };
      writeSessionFile(userId, {
        session,
        messages: [...file.messages, ...messages],
      });

      const index = readIndex(userId);
      const i = index.findIndex((s) => s.id === sessionId);
      if (i >= 0) {
        index[i] = session;
        writeIndex(userId, index);
      }
    },
  };
}

function createProjectStore(
  rootDir: string,
  sessions?: SessionStore,
): ProjectStore {
  function readIndex(userId: string): Project[] {
    return readJsonFile<Project[]>(projectsIndexPath(rootDir, userId), []);
  }

  function writeIndex(userId: string, projects: Project[]): void {
    writeJsonFile(projectsIndexPath(rootDir, userId), projects);
  }

  function readProjectFile(userId: string, projectId: string): Project | null {
    const path = projectFilePath(rootDir, userId, projectId);
    if (!existsSync(path)) return null;
    return readJsonFile<Project | null>(path, null);
  }

  function writeProjectFile(project: Project, ownerId = project.userId): void {
    if (!ownerId) throw new Error(`Project owner missing: ${project.id}`);
    writeJsonFile(projectFilePath(rootDir, ownerId, project.id), project);
  }

  return {
    async listProjects(userId) {
      return [...readIndex(userId)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async getProject(userId, projectId) {
      return readProjectFile(userId, projectId) ?? readIndex(userId).find((p) => p.id === projectId) ?? null;
    },

    async createProject(input) {
      ensureDir(userDir(rootDir, input.userId));
      const createdAt = input.createdAt ?? nowIso();
      const project: Project = {
        id: input.id,
        userId: input.userId,
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
        ...(input.pinnedSkillIds !== undefined ? { pinnedSkillIds: input.pinnedSkillIds } : {}),
        createdAt,
        updatedAt: createdAt,
      };
      const index = readIndex(input.userId);
      if (index.some((p) => p.id === project.id)) throw new Error(`Project already exists: ${project.id}`);
      index.push(project);
      writeIndex(input.userId, index);
      writeProjectFile(project);
      return project;
    },

    async updateProject(userId, projectId, patch) {
      const project = await this.getProject(userId, projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      const updated: Project = {
        ...project,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.pinnedSkillIds !== undefined ? { pinnedSkillIds: patch.pinnedSkillIds } : {}),
        updatedAt: nowIso(),
      };
      if (patch.description !== undefined) {
        if (patch.description === null) delete updated.description;
        else updated.description = patch.description;
      }
      if (patch.instructions !== undefined) {
        if (patch.instructions === null) delete updated.instructions;
        else updated.instructions = patch.instructions;
      }
      writeProjectFile(updated, userId);
      const index = readIndex(userId);
      const i = index.findIndex((p) => p.id === projectId);
      if (i >= 0) index[i] = updated;
      else index.push(updated);
      writeIndex(userId, index);
      return updated;
    },

    async deleteProject(userId, projectId) {
      // Preserve conversations when a workspace is removed, but detach them so
      // no session continues to reference a project that no longer exists.
      if (sessions) {
        const attached = await sessions.listSessions(userId, projectId);
        for (const session of attached) {
          await sessions.updateSession(userId, session.id, { projectId: null });
        }
      }
      const path = projectFilePath(rootDir, userId, projectId);
      if (existsSync(path)) unlinkSync(path);
      const index = readIndex(userId);
      writeIndex(userId, index.filter((p) => p.id !== projectId));
    },
  };
}

function createArtifactStore(rootDir: string, blobs: ArtifactBlobStore): ArtifactStore {
  function readIndex(userId: string): Artifact[] {
    return readJsonFile<Artifact[]>(artifactsIndexPath(rootDir, userId), []);
  }

  function writeIndex(userId: string, artifacts: Artifact[]): void {
    writeJsonFile(artifactsIndexPath(rootDir, userId), artifacts);
  }

  function visible(artifacts: Artifact[]): Artifact[] {
    return artifacts.filter((artifact) => artifact.visibility !== "hidden");
  }

  return {
    async listByUser(userId) {
      return visible(readIndex(userId));
    },

    async listBySession(userId, sessionId) {
      return visible(readIndex(userId)).filter((artifact) => artifact.sessionId === sessionId);
    },

    async listByProject(userId, projectId) {
      return visible(readIndex(userId)).filter((artifact) => artifact.projectId === projectId);
    },

    async get(userId, artifactId) {
      return readIndex(userId).find((a) => a.id === artifactId) ?? null;
    },

    async write(meta, content) {
      const artifact: Artifact = {
        ...meta,
        storageKey: meta.storageKey || storageKeyFor(meta.userId, meta.id),
      };
      await blobs.write(storageKeyFor(artifact.userId, artifact.id), content);

      const index = readIndex(artifact.userId).filter((a) => a.id !== artifact.id);
      index.push(artifact);
      writeIndex(artifact.userId, index);
      return artifact;
    },

    async writeStream(meta, content, options) {
      const artifact: Artifact = {
        ...meta,
        storageKey: meta.storageKey || storageKeyFor(meta.userId, meta.id),
      };
      await blobs.writeStream(storageKeyFor(artifact.userId, artifact.id), content, options);

      const index = readIndex(artifact.userId).filter((a) => a.id !== artifact.id);
      index.push(artifact);
      writeIndex(artifact.userId, index);
      return artifact;
    },

    async readContent(userId, artifactId) {
      return blobs.read(storageKeyFor(userId, artifactId));
    },

    async createReadStream(userId, artifactId, options) {
      return blobs.createReadStream(storageKeyFor(userId, artifactId), options);
    },

    async contentSize(userId, artifactId) {
      return blobs.contentSize(storageKeyFor(userId, artifactId));
    },
  };
}

export interface WebFileStore {
  sessions: SessionStore;
  projects: ProjectStore;
  artifacts: ArtifactStore;
  toolJobs: ToolJobStore;
}

/**
 * File-backed SessionStore + ArtifactStore under `rootDir`
 * (typically project `data/`):
 * - users/{userId}/sessions.json
 * - users/{userId}/sessions/{sessionId}.json → { session, messages }
 * - users/{userId}/artifacts.json
 * - tool-jobs.json
 * - artifact content uses the injected blob store (local files by default)
 */
export function createWebFileStore(
  rootDir: string,
  options: { artifactBlobs?: ArtifactBlobStore } = {},
): WebFileStore {
  ensureDir(rootDir);
  const sessions = createSessionStore(rootDir);
  return {
    sessions,
    projects: createProjectStore(rootDir, sessions),
    artifacts: createArtifactStore(
      rootDir,
      options.artifactBlobs ?? createLocalArtifactBlobStore(rootDir),
    ),
    toolJobs: createToolJobStore(rootDir),
  };
}
