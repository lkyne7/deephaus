import { redirect } from "next/navigation";

/** The profile page now lives in the settings overlay, opened via ?settings=. */
export default function ProfilePage() {
  redirect("/dashboard?settings=account");
}
