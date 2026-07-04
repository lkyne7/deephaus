import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/data/server-auth";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();
  if (!user) redirect("/signup");
  return <>{children}</>;
}
