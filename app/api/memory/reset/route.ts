import { getSupabaseServerClient } from "@/lib/supabase/server";

interface ResetPayload {
  email?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ResetPayload;
    const email = body.email?.trim().toLowerCase();
    if (!email) {
      return Response.json({ error: "email is required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();

    const eventsDelete = await supabase
      .from("conversation_events")
      .delete()
      .eq("email", email);
    if (eventsDelete.error) {
      return Response.json({ error: eventsDelete.error.message }, { status: 500 });
    }

    const memoryDelete = await supabase
      .from("conversation_memory")
      .delete()
      .eq("email", email);
    if (memoryDelete.error) {
      return Response.json({ error: memoryDelete.error.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
