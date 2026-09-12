import { redirect } from "next/navigation";

export default function ModelProvidersPage() {
  redirect("/account/portal?section=models");
}
