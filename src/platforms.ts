import type { Platform } from "./catalog.ts";

/**
 * Known vibe-coding platforms and the hosting services their apps run on.
 *
 * A domain matches itself and every subdomain. For `hosted_app` and `backend`
 * signals, everything left of the domain names the app or project:
 * `crm-dashboard.lovable.app` is the app `crm-dashboard`.
 */
export const platforms: readonly Platform[] = [
  {
    id: "lovable",
    name: "Lovable",
    url: "https://lovable.dev",
    signals: [
      { kind: "builder", domains: ["lovable.dev"] },
      { kind: "hosted_app", domains: ["lovable.app"] },
    ],
  },
  {
    id: "bolt",
    name: "Bolt",
    url: "https://bolt.new",
    signals: [
      { kind: "builder", domains: ["bolt.new"] },
      { kind: "hosted_app", domains: ["bolt.host"] },
    ],
  },
  {
    id: "v0",
    name: "v0",
    url: "https://v0.app",
    signals: [{ kind: "builder", domains: ["v0.app", "v0.dev"] }],
  },
  {
    id: "replit",
    name: "Replit",
    url: "https://replit.com",
    signals: [
      { kind: "builder", domains: ["replit.com"] },
      { kind: "hosted_app", domains: ["replit.app", "replit.dev", "repl.co"] },
    ],
  },
  {
    id: "base44",
    name: "Base44",
    url: "https://base44.com",
    signals: [
      { kind: "builder", domains: ["base44.com"] },
      { kind: "hosted_app", domains: ["base44.app"] },
    ],
  },
  {
    id: "google-ai-studio",
    name: "Google AI Studio",
    url: "https://aistudio.google.com",
    signals: [{ kind: "builder", domains: ["aistudio.google.com"] }],
  },
  {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai",
    signals: [{ kind: "hosted_app", domains: ["frame.claudeusercontent.com", "claude.site"] }],
  },
  {
    id: "chatgpt",
    name: "ChatGPT Sites",
    url: "https://chatgpt.com",
    signals: [{ kind: "hosted_app", domains: ["chatgpt.site"] }],
  },
  {
    id: "vercel",
    name: "Vercel",
    url: "https://vercel.com",
    signals: [{ kind: "hosted_app", domains: ["vercel.app"] }],
  },
  {
    id: "netlify",
    name: "Netlify",
    url: "https://netlify.com",
    signals: [{ kind: "hosted_app", domains: ["netlify.app"] }],
  },
  {
    id: "cloudflare",
    name: "Cloudflare Pages and Workers",
    url: "https://cloudflare.com",
    signals: [{ kind: "hosted_app", domains: ["pages.dev", "workers.dev"] }],
  },
  {
    id: "firebase",
    name: "Firebase Hosting",
    url: "https://firebase.google.com",
    signals: [{ kind: "hosted_app", domains: ["web.app", "firebaseapp.com"] }],
  },
  {
    id: "render",
    name: "Render",
    url: "https://render.com",
    signals: [{ kind: "hosted_app", domains: ["onrender.com"] }],
  },
  {
    id: "railway",
    name: "Railway",
    url: "https://railway.com",
    signals: [{ kind: "hosted_app", domains: ["up.railway.app"] }],
  },
  {
    id: "fly",
    name: "Fly.io",
    url: "https://fly.io",
    signals: [{ kind: "hosted_app", domains: ["fly.dev"] }],
  },
  {
    id: "supabase",
    name: "Supabase",
    url: "https://supabase.com",
    signals: [{ kind: "backend", domains: ["supabase.co"] }],
  },
  {
    id: "convex",
    name: "Convex",
    url: "https://convex.dev",
    signals: [{ kind: "backend", domains: ["convex.cloud"] }],
  },
];
