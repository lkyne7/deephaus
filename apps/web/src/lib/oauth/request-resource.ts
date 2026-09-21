import { headers } from "next/headers";
import { appOrigin } from "./urls";

/** Canonical resource for server components/actions and the backing REST API. */
export async function requestMcpResource(): Promise<string> {
  const requestHeaders = await headers();
  const req = new Request("http://localhost:3000", { headers: requestHeaders });
  return `${appOrigin(req)}/api/mcp`;
}
