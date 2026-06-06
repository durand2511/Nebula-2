INSERT INTO storage.buckets (id, name, public) 
VALUES ('published-apps', 'published-apps', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read access for published apps"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'published-apps');

CREATE POLICY "Service role can upload published apps"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'published-apps');