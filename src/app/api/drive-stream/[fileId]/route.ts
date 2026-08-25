import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { openDriveStream } from "@/lib/drive";

/**
 * Streams a Drive file into SIFT's review player.
 *
 * The browser <video> hits this endpoint; we verify the caller is an active
 * member of the org that owns the submission, then proxy Drive's bytes
 * straight through, forwarding the client's Range header so seeking stays
 * native. We deliberately do NOT 302 to Drive: its download responses carry
 * `Content-Disposition: attachment`, which Chrome's media stack refuses to
 * play, and a redirect would also leak the member's Google cookies to the
 * request. Stripping that header here is the whole reason playback works.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  const orgId = new URL(request.url).searchParams.get("org");
  if (!fileId || !orgId) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: member } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const upstream = await openDriveStream(
    fileId,
    request.headers.get("range"),
  );
  if (!upstream || !upstream.body) {
    return NextResponse.json({ error: "Unresolvable" }, { status: 502 });
  }

  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "private, max-age=300");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
