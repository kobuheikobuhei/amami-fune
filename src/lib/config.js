// data/*.yml の読み込み

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import YAML from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');

function loadYaml(relPath) {
  return YAML.parse(readFileSync(join(ROOT, relPath), 'utf8'));
}

export function loadConfig() {
  const routes = loadYaml('data/routes.yml');
  const sources = loadYaml('data/sources.yml');
  const timetables = loadYaml('data/timetable.yml');

  const userAgent = sources.user_agent
    .replace('<サイトURL>', process.env.SITE_URL || 'https://example.blogspot.com')
    .replace('<連絡用メール>', process.env.CONTACT_EMAIL || 'contact@example.com');

  return {
    routes: routes.routes,
    operators: routes.operators,
    sources: sources.sources,
    referenceLinks: sources.reference_links ?? [],
    timetables,
    userAgent,
  };
}

/** phase以下かつenabledな航路のIDの集合 */
export function activeRouteIds(routes, maxPhase) {
  return new Set(
    routes.filter((r) => r.enabled && r.phase <= maxPhase).map((r) => r.id)
  );
}

/** 指定した航路のいずれかを担当し、かつ役割が合致するソース */
export function selectSources(sources, { routeIds, roles }) {
  return sources.filter((s) => {
    if (!roles.includes(s.role)) return false;
    if (!s.route_ids || s.route_ids.length === 0) return roles.includes(s.role);
    return s.route_ids.some((id) => routeIds.has(id));
  });
}
