import type { PortalModelCategory, PortalModelVendor } from "./content-config";

const categories: { id: PortalModelCategory; label: string; icon: string }[] = [
  { id: "llm", label: "语言推理", icon: "/figma-home/icon-chat.svg" },
  { id: "image", label: "图像处理", icon: "/figma-home/icon-image.svg" },
  { id: "video", label: "视频处理", icon: "/figma-home/icon-video.svg" },
  { id: "audio", label: "音频处理", icon: "/figma-home/icon-voice.svg" },
  { id: "other", label: "信息检索", icon: "/figma-home/icon-search.svg" },
  { id: "embed", label: "RAG知识库", icon: "/figma-home/icon-db.svg" },
];

/** The published configuration is the only source of homepage suppliers. */
export function homepageApiCategories(vendors: readonly PortalModelVendor[]) {
  return categories.map((category) => ({
    ...category,
    href: "/products?cate=api",
    brands: vendors.filter((vendor) => vendor.enabled && vendor.category === category.id)
      .map((vendor) => ({
        label: vendor.name,
        icon: vendor.logoUrl || "/vendors/other.svg",
        href: `/products?cate=api&brand=${encodeURIComponent(vendor.key)}`,
        description: vendor.models.map((model) => model.name).join(" · "),
      })),
  }));
}
