import { createClient } from "@supabase/supabase-js";

const DEMO_CONFIRMATION = "DEMO DATA";
const DEMO_VERSION = "phase-6.0";
const command = process.argv[2];

function fail(message) {
  throw new Error(message);
}

function required(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required.`);
  return value;
}

function assertCommandInput() {
  if (!['seed', 'reset'].includes(command)) {
    fail("Usage: npm run demo:seed or npm run demo:reset");
  }
  required("DEMO_ACCOUNT_ID");
  required("DEMO_ACTOR_USER_ID");
  if (process.env.DEMO_CONFIRM !== DEMO_CONFIRMATION) {
    fail(`Refusing to operate. Set DEMO_CONFIRM=${DEMO_CONFIRMATION}.`);
  }
}

function serviceClient() {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) fail("SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is required.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireDemoContext(db) {
  const accountId = required("DEMO_ACCOUNT_ID");
  const actorUserId = required("DEMO_ACTOR_USER_ID");
  const { data: account, error: accountError } = await db
    .from("accounts")
    .select("id, name, is_demo")
    .eq("id", accountId)
    .maybeSingle();
  if (accountError) fail(`Could not verify the target account: ${accountError.message}`);
  if (!account?.is_demo) {
    fail("Refusing to operate: the selected account is not explicitly marked is_demo=true.");
  }

  const { data: actor, error: actorError } = await db
    .from("profiles")
    .select("user_id, account_id")
    .eq("user_id", actorUserId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (actorError) fail(`Could not verify the demo actor: ${actorError.message}`);
  if (!actor) fail("Refusing to operate: DEMO_ACTOR_USER_ID is not a member of the selected demo account.");

  return { accountId, actorUserId, accountName: account.name };
}

async function single(db, query, label) {
  const { data, error } = await query.single();
  if (error || !data) fail(`Could not ${label}: ${error?.message ?? "unknown error"}`);
  return data;
}

async function record(db, runId, accountId, entityType, entityId) {
  const { error } = await db.from("demo_seed_records").insert({
    run_id: runId,
    account_id: accountId,
    entity_type: entityType,
    entity_id: entityId,
  });
  if (error) fail(`Could not record demo ${entityType}: ${error.message}`);
}

async function insertAndRecord(db, runId, context, table, entityType, values) {
  const row = await single(db, db.from(table).insert(values).select("id"), `create demo ${entityType}`);
  await record(db, runId, context.accountId, entityType, row.id);
  return row.id;
}

const stages = [
  ["RECEIVED", "#3b82f6", 0, "received"],
  ["VERIFIED", "#eab308", 1, "verified"],
  ["ASSIGNED", "#8b5cf6", 2, "assigned"],
  ["DISPATCHED", "#f97316", 3, "dispatched"],
  ["IN PROGRESS", "#ef4444", 4, "in_progress"],
  ["RESOLVED", "#22c55e", 5, "resolved"],
];

async function seed(db, context) {
  const { data: activeRun, error: activeRunError } = await db
    .from("demo_seed_runs")
    .select("id")
    .eq("account_id", context.accountId)
    .eq("status", "active")
    .maybeSingle();
  if (activeRunError) fail(`Could not check demo seed history: ${activeRunError.message}`);
  if (activeRun) fail(`Demo data already exists for this account (run ${activeRun.id}). Run npm run demo:reset first.`);

  const run = await single(db, db.from("demo_seed_runs").insert({
    account_id: context.accountId,
    actor_user_id: context.actorUserId,
    version: DEMO_VERSION,
  }).select("id"), "create demo seed run");
  const runId = run.id;

  const pipelineId = await insertAndRecord(db, runId, context, "pipelines", "pipeline", {
    account_id: context.accountId,
    user_id: context.actorUserId,
    name: "DEMO DATA — Response Workflow",
  });
  const stageIds = {};
  for (const [name, color, position, incidentStatus] of stages) {
    stageIds[incidentStatus] = await insertAndRecord(db, runId, context, "pipeline_stages", "pipeline_stage", {
      pipeline_id: pipelineId,
      name,
      color,
      position,
      incident_status: incidentStatus,
    });
  }

  const locationIds = {};
  for (const location of [
    ["Kathmandu Relief Centre — DEMO DATA", "relief_center", "Boudha, Kathmandu", 27.7219, 85.3624, "DEMO ONLY", "available"],
    ["Bharatpur Relief Centre — DEMO DATA", "relief_center", "Bharatpur, Chitwan", 27.6766, 84.4350, "DEMO ONLY", "available"],
    ["Pokhara Medical Facility — DEMO DATA", "medical_facility", "Lakeside, Pokhara", 28.2096, 83.9595, "DEMO ONLY", "limited"],
    ["Kathmandu Response Base — DEMO DATA", "team_location", "Chabahil, Kathmandu", 27.7172, 85.3467, "DEMO ONLY", "available"],
  ]) {
    const [name, locationType, address, latitude, longitude, contact, availability] = location;
    locationIds[name] = await insertAndRecord(db, runId, context, "operational_locations", "operational_location", {
      account_id: context.accountId,
      user_id: context.actorUserId,
      name,
      location_type: locationType,
      address,
      latitude,
      longitude,
      contact,
      availability,
    });
  }

  const kathmanduTeam = await insertAndRecord(db, runId, context, "response_teams", "response_team", {
    account_id: context.accountId,
    user_id: context.actorUserId,
    name: "Kathmandu Search & Rescue — DEMO DATA",
    contact: "DEMO ONLY",
    location_id: locationIds["Kathmandu Response Base — DEMO DATA"],
    availability: "available",
  });
  const pokharaTeam = await insertAndRecord(db, runId, context, "response_teams", "response_team", {
    account_id: context.accountId,
    user_id: context.actorUserId,
    name: "Pokhara Medical Response — DEMO DATA",
    contact: "DEMO ONLY",
    location_id: locationIds["Pokhara Medical Facility — DEMO DATA"],
    availability: "limited",
  });
  await insertAndRecord(db, runId, context, "vehicles", "vehicle", {
    account_id: context.accountId,
    user_id: context.actorUserId,
    vehicle_type: "Ambulance",
    identifier: "DEMO-AMB-01",
    team_id: kathmanduTeam,
    location_id: locationIds["Kathmandu Response Base — DEMO DATA"],
    contact: "DEMO ONLY",
    availability: "available",
  });
  await insertAndRecord(db, runId, context, "vehicles", "vehicle", {
    account_id: context.accountId,
    user_id: context.actorUserId,
    vehicle_type: "Medical van",
    identifier: "DEMO-MED-01",
    team_id: pokharaTeam,
    location_id: locationIds["Pokhara Medical Facility — DEMO DATA"],
    contact: "DEMO ONLY",
    availability: "limited",
  });
  for (const inventory of [
    ["food", "Food kits — DEMO DATA", 120, "kits", "Bharatpur Relief Centre — DEMO DATA"],
    ["water", "Water containers — DEMO DATA", 300, "litres", "Bharatpur Relief Centre — DEMO DATA"],
    ["medicine", "First-aid packs — DEMO DATA", 40, "packs", "Pokhara Medical Facility — DEMO DATA"],
  ]) {
    const [itemCategory, itemName, quantity, unit, locationName] = inventory;
    await insertAndRecord(db, runId, context, "relief_inventory", "relief_inventory", {
      account_id: context.accountId,
      user_id: context.actorUserId,
      item_category: itemCategory,
      item_name: itemName,
      quantity,
      unit,
      location_id: locationIds[locationName],
      availability: "available",
    });
  }

  const cases = [
    ["DEMO-RESCUE-001", "Aasha Gurung — DEMO DATA", "977000000001", "rescue", "critical", "received", "Boudha, Kathmandu", "Fictional citizen reports people trapped after a landslide.", 27.7210, 85.3612, 4, null, null],
    ["DEMO-FOOD-002", "Bikash Thapa — DEMO DATA", "977000000002", "food_water", "high", "verified", "Bharatpur, Chitwan", "Fictional family needs food and water after flooding.", 27.6770, 84.4360, 6, null, null],
    ["DEMO-MED-003", "Chandra Rai — DEMO DATA", "977000000003", "medicine", "high", "assigned", "Lakeside, Pokhara", "Fictional urgent medical assistance request.", 28.2102, 83.9602, 2, "Pokhara Medical Response — DEMO DATA", "DEMO-MED-01"],
    ["DEMO-SHELTER-004", "Dawa Sherpa — DEMO DATA", "977000000004", "shelter", "medium", "dispatched", "Nepalgunj, Banke", "Fictional household requires temporary shelter.", 28.0500, 81.6167, 5, "Kathmandu Search & Rescue — DEMO DATA", "DEMO-AMB-01"],
    ["DEMO-MISSING-005", "Esha Karki — DEMO DATA", "977000000005", "missing_person", "critical", "in_progress", "Dhangadhi, Kailali", "Fictional missing-person report awaiting coordinator follow-up.", 28.7010, 80.5890, 1, "Kathmandu Search & Rescue — DEMO DATA", "DEMO-AMB-01"],
    ["DEMO-INFO-006", "Farid Alam — DEMO DATA", "977000000006", "information", "low", "resolved", "Lalitpur, Bagmati", "Fictional request for verified relief-centre information.", 27.6644, 85.3188, 3, null, null],
  ];

  const incidentIds = {};
  const conversationIds = {};
  for (const entry of cases) {
    const [requestId, name, phone, category, priority, status, location, description, latitude, longitude, peopleAffected, assignedTeam, assignedResource] = entry;
    const contactId = await insertAndRecord(db, runId, context, "contacts", "contact", {
      account_id: context.accountId,
      user_id: context.actorUserId,
      name,
      phone,
      company: "DEMO DATA — Fictional citizen",
    });
    const conversationId = await insertAndRecord(db, runId, context, "conversations", "conversation", {
      account_id: context.accountId,
      user_id: context.actorUserId,
      contact_id: contactId,
      status: "open",
      last_message_text: `DEMO DATA: ${description}`,
      last_message_at: new Date().toISOString(),
      unread_count: 1,
    });
    conversationIds[requestId] = conversationId;
    const incidentId = await insertAndRecord(db, runId, context, "deals", "incident", {
      account_id: context.accountId,
      user_id: context.actorUserId,
      pipeline_id: pipelineId,
      stage_id: stageIds[status],
      contact_id: contactId,
      conversation_id: conversationId,
      title: `${requestId} — ${category.replaceAll("_", " ")}`,
      request_id: requestId,
      requester_name: name,
      category,
      priority,
      incident_status: status,
      location,
      latitude,
      longitude,
      people_affected: peopleAffected,
      description,
      assigned_team: assignedTeam,
      assigned_resource: assignedResource,
      value: 0,
      currency: "NPR",
      status: status === "resolved" ? "won" : "open",
    });
    incidentIds[requestId] = incidentId;
    await insertAndRecord(db, runId, context, "messages", "message", {
      conversation_id: conversationId,
      sender_type: "customer",
      content_type: "text",
      content_text: `DEMO DATA — ${description}`,
      message_id: `demo-inbound-${requestId}`,
      status: "read",
    });
    await insertAndRecord(db, runId, context, "messages", "message", {
      conversation_id: conversationId,
      sender_type: "bot",
      content_type: "text",
      content_text: `DEMO DATA — Request ${requestId} has been recorded for coordinator review.`,
      message_id: `demo-outbound-${requestId}`,
      status: "delivered",
    });
  }

  await insertAndRecord(db, runId, context, "incident_status_deliveries", "incident_status_delivery", {
    account_id: context.accountId,
    deal_id: incidentIds["DEMO-FOOD-002"],
    conversation_id: conversationIds["DEMO-FOOD-002"],
    channel: "whatsapp",
    incident_status: "verified",
    delivery_status: "failed",
    error_message: "DEMO DATA — simulated provider delivery failure; no message was sent.",
  });

  console.log(`Created fictional DEMO DATA run ${runId} for ${context.accountName}. No WhatsApp, SMS, or external service was contacted.`);
}

async function reset(db, context) {
  const { data: run, error: runError } = await db
    .from("demo_seed_runs")
    .select("id, account_id")
    .eq("account_id", context.accountId)
    .eq("status", "active")
    .maybeSingle();
  if (runError) fail(`Could not check demo seed history: ${runError.message}`);
  if (!run) fail("No active demo-data run exists for this explicitly marked demo account.");

  const { data: records, error: recordsError } = await db
    .from("demo_seed_records")
    .select("entity_type, entity_id, account_id")
    .eq("run_id", run.id);
  if (recordsError) fail(`Could not load demo seed registry: ${recordsError.message}`);
  if ((records ?? []).some((item) => item.account_id !== context.accountId)) {
    fail("Refusing to reset: the demo seed registry does not match the selected account.");
  }

  const byType = new Map();
  for (const item of records ?? []) {
    const ids = byType.get(item.entity_type) ?? [];
    ids.push(item.entity_id);
    byType.set(item.entity_type, ids);
  }
  const deletes = [
    ["incident_status_delivery", "incident_status_deliveries", true],
    ["message", "messages", false],
    ["incident", "deals", true],
    ["vehicle", "vehicles", true],
    ["relief_inventory", "relief_inventory", true],
    ["response_team", "response_teams", true],
    ["operational_location", "operational_locations", true],
    ["conversation", "conversations", true],
    ["contact", "contacts", true],
    ["pipeline_stage", "pipeline_stages", false],
    ["pipeline", "pipelines", true],
  ];
  for (const [entityType, table, accountScoped] of deletes) {
    const ids = byType.get(entityType);
    if (!ids?.length) continue;
    let query = db.from(table).delete().in("id", ids);
    if (accountScoped) query = query.eq("account_id", context.accountId);
    const { error } = await query;
    if (error) fail(`Could not reset demo ${entityType}: ${error.message}`);
  }

  const { error: recordError } = await db.from("demo_seed_records").delete().eq("run_id", run.id).eq("account_id", context.accountId);
  if (recordError) fail(`Could not clear the demo registry: ${recordError.message}`);
  const { error: runUpdateError } = await db.from("demo_seed_runs").update({ status: "reset", reset_at: new Date().toISOString() }).eq("id", run.id).eq("account_id", context.accountId);
  if (runUpdateError) fail(`Could not finalize demo reset: ${runUpdateError.message}`);

  console.log(`Reset only fictional DEMO DATA run ${run.id} for ${context.accountName}. No other account or operational record was targeted.`);
}

try {
  assertCommandInput();
  const db = serviceClient();
  const context = await requireDemoContext(db);
  if (command === "seed") await seed(db, context);
  else await reset(db, context);
} catch (error) {
  console.error(`DEMO DATA command stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
