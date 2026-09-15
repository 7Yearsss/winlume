import { describe, expect, it } from "vitest";
import { applicationTools, applicationToolHref, defaultToolPresentation, normalizeToolPresentation, representativeTools, resolveApplicationTools, toolCategoryDescriptions } from "./application-tools";

describe("application tool directory", () => {
  it("has three representatives per category and retains additional tools", () => {
    const tools = resolveApplicationTools();
    for (const category of Object.keys(toolCategoryDescriptions)) {
      expect(representativeTools(tools.filter((tool) => tool.category === category))).toHaveLength(3);
    }
    const visual = tools.filter((tool) => tool.category === "视觉与媒体");
    expect(visual).toHaveLength(4);
    expect(representativeTools(visual).map((tool) => tool.id)).not.toContain("video-edit");
  });

  it("honors admin ordering, priority and disabled entries", () => {
    const settings = normalizeToolPresentation([
      { id: "video-edit", featured: true, imageUrl: "/replacement.webp" },
      { id: "poster", enabled: false },
    ]);
    const tools = resolveApplicationTools(settings).filter((tool) => tool.category === "视觉与媒体");
    expect(tools.map((tool) => tool.id)).not.toContain("poster");
    expect(representativeTools(tools)[0]).toMatchObject({ id: "video-edit", imageUrl: "/replacement.webp" });
  });

  it("backfills legacy records without accepting unknown ids, duplicate ids or unsafe image URLs", () => {
    expect(normalizeToolPresentation(undefined)).toEqual(defaultToolPresentation);
    const settings = normalizeToolPresentation([
      { id: "copywriting", imageUrl: "javascript:alert(1)", enabled: false },
      { id: "copywriting", enabled: true },
      { id: "unknown", imageUrl: "/unknown.png" },
    ]);
    expect(settings).toHaveLength(applicationTools.length);
    expect(settings[0]).toMatchObject({ id: "copywriting", imageUrl: "/tool-covers/copywriting.webp", enabled: false });
  });

  it("preserves explicit disable-all and fills fewer than three priority slots", () => {
    expect(resolveApplicationTools(normalizeToolPresentation(defaultToolPresentation.map((item) => ({ ...item, enabled: false }))))).toEqual([]);
    const tools = [{ id: "a", featured: false }, { id: "b", featured: true }, { id: "c", featured: false }, { id: "d", featured: false }];
    expect(representativeTools(tools).map((tool) => tool.id)).toEqual(["b", "a", "c"]);
  });

  it("opens each task using the existing studio entry contract", () => {
    for (const tool of applicationTools) {
      const url = new URL(applicationToolHref(tool), "https://example.test");
      expect(url.pathname).toBe("/studio");
      expect(url.searchParams.get("entry")).toBe("application-catalog");
      expect(url.searchParams.get("tool")).toBe(tool.name);
    }
  });
});
