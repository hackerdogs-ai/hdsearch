// CLI to mint / list / revoke API keys without the HTTP layer. Useful for first
// boot and ops.  Examples:
//   tsx scripts/hds-keys.ts issue --user auth0|abc --name laptop
//   tsx scripts/hds-keys.ts list  --user auth0|abc
//   tsx scripts/hds-keys.ts revoke --user auth0|abc --id key_ab12cd34
import { issueKey, listKeys, revokeKey, type Scope } from '../src/apikeys.js';
import { SCHEMA, tryQuery, closeDb } from '../src/db.js';
import { closeRedis } from '../src/store.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function ensureUser(userId: string) {
  await tryQuery(`insert into ${SCHEMA}.users (id, plan) values ($1,'enterprise') on conflict (id) do nothing`, [userId]);
}

async function main() {
  const cmd = process.argv[2];
  const user = arg('user');
  try {
    if (cmd === 'issue') {
      if (!user) throw new Error('--user required');
      await ensureUser(user);
      const scopes = (arg('scopes')?.split(',') as Scope[]) || undefined;
      const { key, record } = await issueKey({ userId: user, name: arg('name') || 'cli', scopes });
      console.log(JSON.stringify({ key, record }, null, 2));
      console.log('\n⚠️  Store the key now — it will not be shown again.');
    } else if (cmd === 'list') {
      if (!user) throw new Error('--user required');
      console.log(JSON.stringify(await listKeys(user), null, 2));
    } else if (cmd === 'revoke') {
      if (!user) throw new Error('--user required');
      const id = arg('id');
      if (!id) throw new Error('--id required');
      console.log(JSON.stringify({ revoked: await revokeKey(user, id) }));
    } else {
      console.log('usage: hds-keys <issue|list|revoke> --user <id> [--name <n>] [--scopes a,b] [--id key_x]');
      process.exit(1);
    }
  } finally {
    await Promise.allSettled([closeDb(), closeRedis()]);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
