import { describe, expect, it } from "vitest";
import { defaultPortalContent, normalizePortalContent, toPublicPortalContent } from "./content-config";

describe("portal content configuration", () => {
  it("backfills tool covers and serves uploads through the public image endpoint", () => {
    const content = normalizePortalContent({ toolDirectory: [{ id: "copywriting", imageUrl: "data:image/png;base64,aGVsbG8=", featured: false, enabled: false }] });
    expect(content.toolDirectory).toHaveLength(25);
    expect(content.toolDirectory[0]).toMatchObject({ id: "copywriting", featured: false, enabled: false });
    const imageUrl = toPublicPortalContent(content).toolDirectory[0].imageUrl;
    expect(imageUrl).toMatch(/^\/api\/portal\/image\?section=toolDirectory&id=copywriting&v=/);
    expect(imageUrl).not.toContain("base64");
  });
  it("backfills the two managed homepage showcases for legacy records", () => {
    const content = normalizePortalContent({ carousel: [], notifications: [], modelVendors: [] });
    expect(content.applicationShowcase).toEqual(defaultPortalContent.applicationShowcase);
    expect(content.capabilityShowcase).toEqual(defaultPortalContent.capabilityShowcase);
  });

  it("keeps fallback showcases when stored sections are empty", () => {
    const content = normalizePortalContent({ applicationShowcase: [], capabilityShowcase: [] });
    expect(content.applicationShowcase).toEqual(defaultPortalContent.applicationShowcase);
    expect(content.capabilityShowcase).toEqual(defaultPortalContent.capabilityShowcase);
  });

  it("normalizes configurable tools, images, groups and capability tones", () => {
    const content = normalizePortalContent({
      applicationShowcase: [{ id: "custom app", title: "自定义工具", href: "/studio/tools/demo", imageUrl: "data:image/png;base64,abc", group: "latest", enabled: false }],
      capabilityShowcase: [{ id: "custom capability", title: "团队治理", eyebrow: "治理", href: "/account/team", imageUrl: "/custom.png", tone: "usage" }],
    });
    expect(content.applicationShowcase[0]).toMatchObject({ id: "custom-app", group: "latest", enabled: false, href: "/studio/tools/demo" });
    expect(content.capabilityShowcase[0]).toMatchObject({ id: "custom-capability", tone: "usage", imageUrl: "/custom.png" });
  });

  it("replaces managed data URLs with versioned public image endpoints", () => {
    const content = normalizePortalContent({
      carousel: [{ id: "banner", imageUrl: "data:image/png;base64,aGVsbG8=", alt: "Banner", href: "/" }],
      applicationShowcase: [{ id: "custom app", title: "自定义工具", href: "/studio", imageUrl: "data:image/png;base64,aGVsbG8=", group: "popular" }],
    });
    const publicContent = toPublicPortalContent(content);
    expect(publicContent.carousel[0].imageUrl).toMatch(/^\/api\/portal\/image\?section=carousel&id=banner&v=/);
    expect(publicContent.applicationShowcase[0].imageUrl).toMatch(/^\/api\/portal\/image\?section=applicationShowcase&id=custom-app&v=/);
    expect(publicContent.carousel[0].imageUrl).not.toContain("data:image");
  });
});
