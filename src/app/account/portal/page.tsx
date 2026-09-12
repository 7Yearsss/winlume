import PortalContentAdminContent from "@/components/account/PortalContentAdminContent";

export default async function PortalContentAdminPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  const initialSection = section === "models" || section === "applications" || section === "capabilities" || section === "notifications" ? section : "carousel";
  return <PortalContentAdminContent initialSection={initialSection} />;
}
