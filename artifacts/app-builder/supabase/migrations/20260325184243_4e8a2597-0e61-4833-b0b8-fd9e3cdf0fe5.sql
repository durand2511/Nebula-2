
CREATE TABLE public.app_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection text NOT NULL DEFAULT 'default',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Allow the service role full access (edge function uses service role)
ALTER TABLE public.app_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.app_data
FOR ALL TO service_role USING (true) WITH CHECK (true);
