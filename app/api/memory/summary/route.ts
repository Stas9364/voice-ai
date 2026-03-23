import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email")?.trim().toLowerCase();
    if (!email) {
      return Response.json({ summary: null });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("conversation_memory")
      .select("summary")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ summary: data?.summary ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
