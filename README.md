# Wardrobe Planner

A static web app that tells you where each piece of clothing should go:
wardrobe -> shelf -> section. Hosted on GitHub Pages, with optional Supabase login and sync.

## Local-only mode
Leave `config.js` empty. Data stays in the browser (export/import JSON from the Data tab).

## Cloud mode (Supabase)
1. Create a project at supabase.com.
2. SQL Editor: run `supabase/schema.sql`.
3. Project Settings -> API: copy the Project URL and the `anon` public key into `config.js`.
   Never use the `service_role` key.
4. Authentication -> URL Configuration: set Site URL to the GitHub Pages address
   (e.g. https://USERNAME.github.io/wardrobe-planner/) and add it to Redirect URLs.
5. Commit and push. Users sign up with email + password; each only sees their own data (RLS).
