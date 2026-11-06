import { redirect } from "next/navigation";
import { settingsPath } from "@/lib/settings/tabs";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of [value].flat()) {
      if (item !== undefined) query.append(key, item);
    }
  }
  const search = query.toString();
  redirect(search ? `${settingsPath()}?${search}` : settingsPath());
}
