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
    const { html } = await req.json();
    if (!html) throw new Error("No HTML provided");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Generate a unique slug
    const slug = crypto.randomUUID().slice(0, 8);
    const fileName = `${slug}/index.html`;

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from("published-apps")
      .upload(fileName, html, {
        contentType: "text/html",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("published-apps")
      .getPublicUrl(fileName);

    return new Response(
      JSON.stringify({ url: urlData.publicUrl, slug }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("publish-app error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Publish failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
