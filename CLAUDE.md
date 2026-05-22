READ ~/Developer/agent-scripts/AGENTS.MD BEFORE ANYTHING (skip if missing).

Project-specific notes:
- This is a mobile-first party tournament app for washers.
- The site intentionally has no authentication. Anyone with the URL can change teams, seeds, scores, and bracket state.
- Supabase stores one shared tournament state row for live cross-device updates.
- Keep the app deployable as a static Vite build.
