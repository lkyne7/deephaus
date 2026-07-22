import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { loadBillingStatus } from "@/lib/billing/server";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    return NextResponse.json(await loadBillingStatus(user!.id));
  } catch (error) {
    console.error("Billing status lookup failed:", error);
    return NextResponse.json({ error: "Failed to load billing status" }, { status: 500 });
  }
}
