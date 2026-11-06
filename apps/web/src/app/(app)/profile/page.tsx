import { redirect } from "next/navigation";
import { settingsPath } from "@/lib/settings/tabs";

/** Older links and desktop builds still open /profile. */
export default function ProfilePage() {
  redirect(settingsPath("account"));
}
