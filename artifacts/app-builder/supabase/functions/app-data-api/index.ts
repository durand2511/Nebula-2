import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, collection, data, filters } = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Ensure the app_data table exists
    const tableName = "app_data";

    if (action === "insert") {
      const record = {
        collection: collection || "default",
        data: data || {},
        created_at: new Date().toISOString(),
      };

      const { data: inserted, error } = await supabase
        .from(tableName)
        .insert(record)
        .select()
        .single();

      if (error) throw error;
      return new Response(JSON.stringify({ success: true, record: inserted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "select") {
      let query = supabase.from(tableName).select("*");
      if (collection) query = query.eq("collection", collection);
      if (filters?.limit) query = query.limit(filters.limit);

      const { data: rows, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, records: rows || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      if (!filters?.id) throw new Error("ID vereist voor verwijderen");
      const { error } = await supabase.from(tableName).delete().eq("id", filters.id);
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update") {
      if (!filters?.id) throw new Error("ID vereist voor bijwerken");
      const { data: updated, error } = await supabase
        .from(tableName)
        .update({ data: data || {} })
        .eq("id", filters.id)
        .select()
        .single();
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, record: updated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Onbekende actie: ${action}`);
  } catch (e) {
    console.error("app-data-api error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Onbekende fout" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
