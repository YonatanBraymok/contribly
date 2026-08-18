/**
 * Alias table mapping how people write a technology to what we call it.
 *
 * GitHub tells us a repository is 62% TypeScript. It does not tell us the
 * repository is a Next.js app, and that is most of what a developer means when
 * they describe their stack. v1 recovers it from repository topics, repository
 * descriptions and starred repositories, run through the table below.
 *
 * This file is the honest seam where the AI phase lands. Swapping a
 * hand-written alias table for a model that reads a README is a change to this
 * module and nothing else — the callers ask for "canonical names found in this
 * text" and do not care how the answer is produced.
 *
 * Precision matters more than recall here. Telling a developer they know
 * Kubernetes when they starred one Helm chart is worse than missing it: the
 * detected stack is shown back to them as a statement about who they are, and
 * a wrong one costs trust in every recommendation that follows.
 */

import type { FrameworkSource } from './types.js';

/** Canonical name → the spellings that should resolve to it. */
const FRAMEWORKS: Record<string, string[]> = {
  // --- Frontend ------------------------------------------------------------
  React: ['react', 'reactjs', 'react-js'],
  'Next.js': ['nextjs', 'next.js', 'next-js', 'next'],
  'Vue.js': ['vue', 'vuejs', 'vue-js', 'vue3'],
  Nuxt: ['nuxt', 'nuxtjs', 'nuxt.js'],
  Angular: ['angular', 'angularjs'],
  Svelte: ['svelte', 'sveltejs'],
  SvelteKit: ['sveltekit', 'svelte-kit'],
  'Solid.js': ['solidjs', 'solid-js'],
  Astro: ['astro', 'astrojs'],
  Remix: ['remix', 'remix-run'],
  jQuery: ['jquery'],
  'Tailwind CSS': ['tailwind', 'tailwindcss', 'tailwind-css'],
  Bootstrap: ['bootstrap'],
  Sass: ['sass', 'scss'],
  Redux: ['redux', 'redux-toolkit'],
  Vite: ['vite', 'vitejs'],
  Webpack: ['webpack'],
  Storybook: ['storybook'],
  'Three.js': ['threejs', 'three.js', 'three-js'],
  D3: ['d3', 'd3js', 'd3.js'],
  Electron: ['electron', 'electronjs'],
  Tauri: ['tauri'],
  WebAssembly: ['wasm', 'webassembly'],

  // --- Mobile --------------------------------------------------------------
  'React Native': ['react-native', 'reactnative'],
  Flutter: ['flutter'],
  SwiftUI: ['swiftui'],
  'Jetpack Compose': ['jetpack-compose', 'compose-multiplatform'],
  Ionic: ['ionic'],
  Expo: ['expo'],

  // --- Backend -------------------------------------------------------------
  'Node.js': ['nodejs', 'node.js', 'node-js', 'node'],
  Express: ['express', 'expressjs', 'express.js'],
  NestJS: ['nestjs', 'nest.js'],
  Fastify: ['fastify'],
  Deno: ['deno'],
  Bun: ['bun'],
  Django: ['django'],
  Flask: ['flask'],
  FastAPI: ['fastapi'],
  'Ruby on Rails': ['rails', 'ruby-on-rails', 'rubyonrails'],
  Laravel: ['laravel'],
  Symfony: ['symfony'],
  Spring: ['spring', 'spring-boot', 'springboot'],
  '.NET': ['dotnet', '.net', 'aspnet', 'asp.net', 'dotnetcore'],
  Gin: ['gin', 'gin-gonic'],
  Actix: ['actix', 'actix-web'],
  Axum: ['axum'],
  Phoenix: ['phoenix-framework'],
  GraphQL: ['graphql', 'apollo', 'apollo-server'],
  tRPC: ['trpc'],
  gRPC: ['grpc'],
  WebSocket: ['websocket', 'websockets', 'socket.io', 'socketio'],

  // --- Data and ML ---------------------------------------------------------
  PyTorch: ['pytorch', 'torch'],
  TensorFlow: ['tensorflow', 'tf'],
  Keras: ['keras'],
  'scikit-learn': ['scikit-learn', 'sklearn'],
  pandas: ['pandas'],
  NumPy: ['numpy'],
  Jupyter: ['jupyter', 'jupyter-notebook'],
  'Hugging Face': ['huggingface', 'hugging-face', 'transformers'],
  LangChain: ['langchain'],
  OpenCV: ['opencv'],
  Spark: ['spark', 'apache-spark', 'pyspark'],
  Airflow: ['airflow', 'apache-airflow'],
  dbt: ['dbt'],

  // --- Databases -----------------------------------------------------------
  PostgreSQL: ['postgres', 'postgresql', 'pgsql'],
  MySQL: ['mysql', 'mariadb'],
  MongoDB: ['mongodb', 'mongo', 'mongoose'],
  Redis: ['redis'],
  SQLite: ['sqlite', 'sqlite3'],
  Elasticsearch: ['elasticsearch', 'elastic'],
  Supabase: ['supabase'],
  Firebase: ['firebase'],
  Prisma: ['prisma'],
  SQLAlchemy: ['sqlalchemy'],
  ClickHouse: ['clickhouse'],
  Neo4j: ['neo4j'],
  DuckDB: ['duckdb'],
  pgvector: ['pgvector'],

  // --- Infrastructure ------------------------------------------------------
  Docker: ['docker', 'dockerfile', 'docker-compose'],
  Kubernetes: ['kubernetes', 'k8s', 'helm'],
  Terraform: ['terraform'],
  Ansible: ['ansible'],
  AWS: ['aws', 'amazon-web-services'],
  'Google Cloud': ['gcp', 'google-cloud'],
  Azure: ['azure'],
  Nginx: ['nginx'],
  'GitHub Actions': ['github-actions', 'gh-actions'],
  Prometheus: ['prometheus'],
  Grafana: ['grafana'],
  Kafka: ['kafka', 'apache-kafka'],
  RabbitMQ: ['rabbitmq'],
  Serverless: ['serverless'],
  Vercel: ['vercel'],
  Cloudflare: ['cloudflare', 'cloudflare-workers'],

  // --- Testing -------------------------------------------------------------
  Jest: ['jest'],
  Vitest: ['vitest'],
  Playwright: ['playwright'],
  Cypress: ['cypress'],
  pytest: ['pytest'],
  Selenium: ['selenium'],

  // --- Other ---------------------------------------------------------------
  Unity: ['unity', 'unity3d'],
  Godot: ['godot'],
  'Unreal Engine': ['unreal', 'unreal-engine'],
  Arduino: ['arduino'],
  'Raspberry Pi': ['raspberry-pi', 'raspberrypi'],
  Solidity: ['solidity', 'ethereum', 'web3'],
  Neovim: ['neovim', 'nvim'],
  Emacs: ['emacs'],
};

/**
 * Aliases that only count when they come from a repository topic.
 *
 * Topics are user-declared and unambiguous — someone who tags a repo `next`
 * means Next.js. The same word in a description usually does not: "the next
 * generation of...", "written in Go", "a gin and tonic recipe app". Matching
 * these in free text produces exactly the confident-and-wrong output this
 * table exists to avoid.
 */
const TOPIC_ONLY_ALIASES = new Set([
  'next', 'node', 'spring', 'gin', 'expo', 'astro', 'remix', 'torch', 'tf',
  'elastic', 'spark', 'd3', 'bun', 'mongo', 'unity', 'vite', 'sass', 'scss',
]);

/** alias → canonical, built once at module load. */
const ALIASES = new Map<string, string>();

for (const [canonical, aliases] of Object.entries(FRAMEWORKS)) {
  for (const alias of aliases) {
    ALIASES.set(alias, canonical);
  }
}

/** Resolves one GitHub topic. Topics arrive lowercased and hyphenated already. */
export function matchTopic(topic: string): string | null {
  return ALIASES.get(topic.trim().toLowerCase()) ?? null;
}

/**
 * Splits text into technology-shaped tokens.
 *
 * Keeps `.`, `-`, `+` and `#` inside a token so `next.js`, `scikit-learn` and
 * `asp.net` survive, then strips the punctuation a sentence leaves clinging to
 * the end of a word.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.+#_-]+/)
    .map((token) => token.replace(/^[.\-_]+|[.\-_]+$/g, ''))
    .filter(Boolean);
}

/**
 * Canonical names found in free text, deduplicated.
 *
 * Token lookup rather than a regex per alias: one pass over the words instead
 * of two hundred passes over the string, and word boundaries come for free.
 */
export function matchText(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }

  const found = new Set<string>();

  for (const token of tokenize(text)) {
    if (TOPIC_ONLY_ALIASES.has(token)) {
      continue;
    }

    const canonical = ALIASES.get(token);
    if (canonical) {
      found.add(canonical);
    }
  }

  return [...found];
}

/** Every canonical name the table knows. Used by the fixture script. */
export function knownFrameworks(): string[] {
  return Object.keys(FRAMEWORKS);
}

export type { FrameworkSource };
