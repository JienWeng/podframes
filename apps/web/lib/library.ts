import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, sep } from "node:path";
import {
  Project,
  applyShowTemplate,
  withProjectLock,
  clearStages,
  DEFAULT_HOSTS,
  type Host,
} from "@podframes/core";
import { findRepoRoot } from "./root";
import { isRunActiveAnywhere } from "./runs";
import { brollUploadExtension } from "./broll-upload";

export interface SavedCast {
  id: string;
  name: string;
  host: Host;
  createdAt: string;
  portraitUrl: string;
}
export interface SavedSeries {
  id: string;
  title: string;
  description: string;
  templateSlug: string;
  createdAt: string;
  hosts: string[];
}

export function libraryRoot(root = findRepoRoot()): string {
  return join(root, "library");
}
export function libraryId(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid library ID.");
  return id;
}

async function saveRecord(
  kind: "cast" | "series",
  record: SavedCast | SavedSeries,
  root: string,
) {
  const dir = join(libraryRoot(root), kind);
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `${record.id}.tmp`);
  await writeFile(temporary, JSON.stringify(record, null, 2));
  await rename(temporary, join(dir, `${record.id}.json`));
}

export async function readCast(
  id: string,
  root = findRepoRoot(),
): Promise<SavedCast> {
  return JSON.parse(
    await readFile(
      join(libraryRoot(root), "cast", `${libraryId(id)}.json`),
      "utf8",
    ),
  );
}
export async function readSeries(
  id: string,
  root = findRepoRoot(),
): Promise<SavedSeries> {
  return JSON.parse(
    await readFile(
      join(libraryRoot(root), "series", `${libraryId(id)}.json`),
      "utf8",
    ),
  );
}

export async function listLibrary(
  root = findRepoRoot(),
): Promise<{ cast: SavedCast[]; series: SavedSeries[] }> {
  async function list<T extends { createdAt: string }>(
    kind: string,
  ): Promise<T[]> {
    const dir = join(libraryRoot(root), kind);
    const files = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const records = await Promise.all(
      files
        .filter((name) => name.endsWith(".json"))
        .map(
          async (name) =>
            JSON.parse(await readFile(join(dir, name), "utf8")) as T,
        ),
    );
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return {
    cast: await list<SavedCast>("cast"),
    series: await list<SavedSeries>("series"),
  };
}

export async function saveCast(
  host: Host,
  bytes: Uint8Array,
  root = findRepoRoot(),
): Promise<SavedCast> {
  brollUploadExtension(bytes);
  const id = randomUUID();
  const savedHost = structuredClone(host);
  delete savedHost.avatarKey;
  const record: SavedCast = {
    id,
    name: savedHost.name,
    host: savedHost,
    createdAt: new Date().toISOString(),
    portraitUrl: `/api/library/cast/${id}/portrait`,
  };
  const dir = join(libraryRoot(root), "cast");
  await mkdir(dir, { recursive: true });
  const portrait = join(dir, `${id}.image`);
  await writeFile(portrait, bytes);
  try {
    await saveRecord("cast", record, root);
  } catch (error) {
    await rm(portrait, { force: true });
    throw error;
  }
  return record;
}

export async function saveProjectCast(
  slug: string,
  hostId: string,
  root = findRepoRoot(),
): Promise<SavedCast> {
  return withProjectLock(slug, async () => {
    if (isRunActiveAnywhere(slug))
      throw new Error(
        "Wait for generation to finish before saving this cast member.",
      );
    const project = await Project.load(root, slug);
    const host = project?.state.config.hosts.find((host) => host.id === hostId);
    if (!project || !host) throw new Error("Host not found.");
    const image =
      project.state.uploads?.[hostId] ??
      project.state.stills?.hosts[hostId]?.imagePath;
    if (!image) throw new Error("Save a portrait for this host first.");
    const directory = await realpath(project.dir);
    const file = await realpath(project.abs(image));
    if (!file.startsWith(directory + sep))
      throw new Error("Portrait must be inside its project.");
    return saveCast(host, await readFile(file), root);
  });
}

export async function createSeries(
  title: string,
  description: string,
  sourceSlug: string,
  root = findRepoRoot(),
): Promise<SavedSeries> {
  return withProjectLock(sourceSlug, async () => {
    if (isRunActiveAnywhere(sourceSlug))
      throw new Error("Wait for the template's generation to finish.");
    const source = await Project.load(root, sourceSlug);
    if (!source) throw new Error("Template not found.");
    const id = randomUUID();
    const snapshotRoot = libraryRoot(root);
    const config = {
      ...structuredClone(source.state.config),
      topic: title,
      sourceUrls: [],
      options: structuredClone(source.state.options),
    };
    const template = await Project.create(config, snapshotRoot, `series-${id}`);
    try {
      await applyShowTemplate(template, source);
      const record: SavedSeries = {
        id,
        title,
        description,
        templateSlug: template.slug,
        hosts: config.hosts.map((host) => host.name),
        createdAt: new Date().toISOString(),
      };
      await saveRecord("series", record, root);
      return record;
    } catch (error) {
      await Project.delete(snapshotRoot, template.slug);
      throw error;
    }
  });
}

export async function createSeriesEpisode(
  id: string,
  root = findRepoRoot(),
): Promise<Project> {
  const series = await readSeries(id, root);
  const source = await Project.load(libraryRoot(root), series.templateSlug);
  if (!source) throw new Error("Series template is unavailable.");
  const config = {
    ...structuredClone(source.state.config),
    topic: "New episode",
    sourceUrls: [],
    options: structuredClone(source.state.options),
  };
  const episode = await Project.create(config, root, `episode-${randomUUID()}`);
  try {
    await applyShowTemplate(episode, source);
    episode.state.seriesId = series.id;
    await episode.save();
    return episode;
  } catch (error) {
    await Project.delete(root, episode.slug);
    throw error;
  }
}

export async function applySavedCast(
  project: Project,
  id: string,
  hostId: string,
): Promise<void> {
  const entry = await readCast(id, project.root);
  const target = project.state.config.hosts.find((host) => host.id === hostId);
  if (!target) throw new Error("Host not found.");
  const bytes = await readFile(
    join(libraryRoot(project.root), "cast", `${libraryId(id)}.image`),
  );
  const extension = brollUploadExtension(bytes);
  const relative = `assets/cast/${id}.${extension}`;
  await mkdir(project.abs("assets/cast"), { recursive: true });
  await writeFile(project.abs(relative), bytes);
  const host = {
    ...structuredClone(entry.host),
    id: target.id,
    side: target.side,
    speaker: target.speaker,
  };
  const [first, second] = project.state.config.hosts;
  project.state.config.hosts = [
    first.id === hostId ? host : first,
    second.id === hostId ? host : second,
  ];
  project.state.uploads = { ...project.state.uploads, [hostId]: relative };
  await clearStages(project, [
    "speech",
    "stills",
    "video",
    "broll",
    "compose",
    "render",
  ]);
  await project.save();
}

export async function createCastVideo(
  id: string,
  root = findRepoRoot(),
): Promise<Project> {
  const project = await Project.create(
    {
      topic: "New episode",
      hosts: structuredClone(DEFAULT_HOSTS),
      language: "en",
      aspectRatio: "9:16",
    },
    root,
    `episode-${randomUUID()}`,
  );
  try {
    await applySavedCast(project, id, project.state.config.hosts[0].id);
    return project;
  } catch (error) {
    await Project.delete(root, project.slug);
    throw error;
  }
}
