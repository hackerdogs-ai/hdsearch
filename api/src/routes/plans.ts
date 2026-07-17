// Public plan catalog — price/credits from g_pdt_plans when core is reachable.
import { Hono } from 'hono';
import { buildPlanCards } from '../planCatalog.js';
import { coreListPlansForCatalog } from '../coreClient.js';
import { log, errFields } from '../logger.js';

export const plansRoutes = new Hono();

plansRoutes.get('/', async (c) => {
  try {
    const corePlans = await coreListPlansForCatalog();
    return c.json({ plans: buildPlanCards(corePlans) });
  } catch (e) {
    log.error('GET /v1/plans failed', errFields(e));
    return c.json({ error: 'internal', message: 'plan catalog error' }, 500);
  }
});
