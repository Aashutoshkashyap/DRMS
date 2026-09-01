# Guarded DRMS demo data

The demo commands create only fictional, clearly labelled `DEMO DATA` records for a dedicated demo account. They never call WhatsApp, SMS, OpenWA, Meta, or any official data source.

## Safety boundary

```text
DEMO DATA
  -> normalized DRMS contacts, conversations, incidents, locations, teams, vehicles, inventory

Future official data
  -> future source-specific import or adapter
  -> the same normalized DRMS entities
```

No NDRRMA/NDRMA integration or scraping exists in this project. A future adapter must have a documented source contract, account-scoping, provenance fields, and coordinator review before it writes operational records.

## Prerequisite

Apply migrations through `049_coordinator_accountability.sql`, create a dedicated account, and mark only that account as a demo account using an administrator SQL session:

```sql
UPDATE accounts SET is_demo = TRUE WHERE id = '<dedicated-demo-account-id>';
```

Never set this flag on a production account.

## Commands

Set these locally for the explicitly designated demo account:

```bash
export DEMO_ACCOUNT_ID='<dedicated-demo-account-id>'
export DEMO_ACTOR_USER_ID='<member-user-id>'
# Optional: a second existing member of this same DEMO DATA account. When set,
# demo timeline entries illustrate separate coordinator attribution.
export DEMO_SECOND_ACTOR_USER_ID='<second-member-user-id>'
export DEMO_CONFIRM='DEMO DATA'
export NEXT_PUBLIC_SUPABASE_URL='https://<project>.supabase.co'
export SUPABASE_SECRET_KEY='<server-only-secret>'
npm run demo:seed
```

To remove that one recorded demo run:

```bash
npm run demo:reset
```

Both commands refuse a missing confirmation, account, actor, non-member actor, or an account without `is_demo = TRUE`. The seed creates two independent fictional incidents for one fictional citizen and, when the optional second actor is supplied, shows two coordinator identities in the append-only timeline. Reset deletes only IDs recorded for the selected demo run, in dependency order; it does not perform table-wide or account-wide deletion.
