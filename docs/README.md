---
summary: "Project notes for the Lacey graduation washers tournament app."
read_when:
  - "Changing tournament behavior"
  - "Changing deployment or Supabase setup"
---

# Lacey Washers Tourney

Mobile-first React/Vite app for making random washers teams, editing seeds, entering bracket scores, and syncing tournament state across phones through Supabase realtime.

## Deployment

- Static build: `npm run build`
- GitHub Pages workflow: `.github/workflows/deploy.yml`
- Custom domain file: `public/CNAME`

## Data

The app uses `public.tournament_states` in Supabase. Policies intentionally allow anonymous read/write access for the party site.
