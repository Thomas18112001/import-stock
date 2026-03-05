import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOrderCheckpoint,
  comparePrestaCheckpoint,
  computeCheckpointLookbackStart,
  formatPrestaDateTime,
  isOrderAfterCheckpoint,
  maxPrestaCheckpoint,
  normalizePrestaCheckpoint,
  type PrestaCheckpoint,
} from "../app/utils/prestaCheckpoint";

type SimOrder = {
  id: number;
  dateUpd: string;
};

type SimState = {
  cursor: number;
  checkpoint: PrestaCheckpoint;
  imported: Set<number>;
};

function addSeconds(baseIso: string, seconds: number): string {
  return formatPrestaDateTime(new Date(Date.parse(baseIso) + seconds * 1000));
}

function runSimulation(input: {
  state: SimState;
  allOrders: SimOrder[];
  syncMaxPerRun: number;
  runUpperBound: string;
  computeBudgets: (syncMaxPerRun: number) => { idScanBudget: number; dateScanReserve: number };
  lookbackMinutes?: number;
}) {
  const lookbackMinutes = input.lookbackMinutes ?? 60;
  const currentState = {
    cursor: input.state.cursor,
    checkpoint: normalizePrestaCheckpoint(input.state.checkpoint),
    imported: new Set(input.state.imported),
  };
  let nextCheckpoint = currentState.checkpoint;
  const { idScanBudget } = input.computeBudgets(input.syncMaxPerRun);
  const processedIds: number[] = [];

  const idCandidates = input.allOrders
    .filter((order) => order.id > currentState.cursor)
    .sort((a, b) => a.id - b.id)
    .slice(0, idScanBudget);
  for (const order of idCandidates) {
    currentState.imported.add(order.id);
    processedIds.push(order.id);
    const candidate = buildOrderCheckpoint(order.dateUpd, order.id);
    if (candidate) nextCheckpoint = maxPrestaCheckpoint(nextCheckpoint, candidate);
  }
  if (idCandidates.length) {
    currentState.cursor = Math.max(currentState.cursor, idCandidates[idCandidates.length - 1]!.id);
  }

  let remaining = Math.max(0, input.syncMaxPerRun - idCandidates.length);
  const dateMin = computeCheckpointLookbackStart(currentState.checkpoint, lookbackMinutes);
  const dateCandidates = input.allOrders
    .filter((order) => order.dateUpd >= dateMin && order.dateUpd <= input.runUpperBound)
    .sort((a, b) => {
      if (a.dateUpd < b.dateUpd) return -1;
      if (a.dateUpd > b.dateUpd) return 1;
      return a.id - b.id;
    });
  for (const order of dateCandidates) {
    if (remaining <= 0) break;
    if (!isOrderAfterCheckpoint(order.dateUpd, order.id, currentState.checkpoint)) continue;
    currentState.imported.add(order.id);
    processedIds.push(order.id);
    const candidate = buildOrderCheckpoint(order.dateUpd, order.id);
    if (candidate) nextCheckpoint = maxPrestaCheckpoint(nextCheckpoint, candidate);
    remaining -= 1;
  }

  return {
    nextState: {
      cursor: currentState.cursor,
      checkpoint:
        comparePrestaCheckpoint(nextCheckpoint, currentState.checkpoint) >= 0
          ? nextCheckpoint
          : currentState.checkpoint,
      imported: currentState.imported,
    } satisfies SimState,
    processedIds,
  };
}

function ensureCoreEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.PRESTA_BASE_URL = process.env.PRESTA_BASE_URL || "https://btob.wearmoi.com";
  process.env.PRESTA_ALLOWED_HOST = process.env.PRESTA_ALLOWED_HOST || "btob.wearmoi.com";
  process.env.PRESTA_WS_KEY = process.env.PRESTA_WS_KEY || "test-key";
  process.env.PRESTA_BOUTIQUE_CUSTOMER_ID = process.env.PRESTA_BOUTIQUE_CUSTOMER_ID || "21749";
  process.env.SHOPIFY_DEFAULT_LOCATION_NAME = process.env.SHOPIFY_DEFAULT_LOCATION_NAME || "Boutique Toulon";
  process.env.SYNC_BATCH_SIZE = process.env.SYNC_BATCH_SIZE || "50";
  process.env.SYNC_MAX_PER_RUN = process.env.SYNC_MAX_PER_RUN || "200";
}

test("1000 nouvelles commandes ne sont pas perdues (catch-up sur runs successifs)", async () => {
  ensureCoreEnv();
  const { computeSyncScanBudgets } = await import("../app/services/receiptService");
  const orders: SimOrder[] = [];
  for (let i = 1; i <= 1000; i += 1) {
    orders.push({
      id: i,
      dateUpd: addSeconds("2026-03-01T00:00:00.000Z", i),
    });
  }
  let state: SimState = {
    cursor: 0,
    checkpoint: { dateUpd: "1970-01-01 00:00:00", orderId: 0 },
    imported: new Set<number>(),
  };
  for (let run = 0; run < 20; run += 1) {
    const { nextState } = runSimulation({
      state,
      allOrders: orders,
      syncMaxPerRun: 200,
      runUpperBound: "2026-03-02 00:00:00",
      computeBudgets: computeSyncScanBudgets,
    });
    state = nextState;
    if (state.imported.size === 1000) break;
  }
  assert.equal(state.imported.size, 1000);
});

test("commande créée pendant un run est récupérée au run suivant", async () => {
  ensureCoreEnv();
  const { computeSyncScanBudgets } = await import("../app/services/receiptService");
  const existing = Array.from({ length: 50 }, (_, idx) => ({
    id: idx + 1,
    dateUpd: addSeconds("2026-03-01T10:00:00.000Z", idx),
  }));
  const lateOrder: SimOrder = {
    id: 51,
    dateUpd: "2026-03-01 11:00:10",
  };
  const run1 = runSimulation({
    state: {
      cursor: 0,
      checkpoint: { dateUpd: "1970-01-01 00:00:00", orderId: 0 },
      imported: new Set<number>(),
    },
    allOrders: existing,
    syncMaxPerRun: 100,
    runUpperBound: "2026-03-01 11:00:00",
    computeBudgets: computeSyncScanBudgets,
  });
  assert.equal(run1.nextState.imported.has(51), false);

  const run2 = runSimulation({
    state: run1.nextState,
    allOrders: [...existing, lateOrder],
    syncMaxPerRun: 100,
    runUpperBound: "2026-03-01 11:01:00",
    computeBudgets: computeSyncScanBudgets,
  });
  assert.equal(run2.nextState.imported.has(51), true);
});

test("commande ancienne modifiée (date_upd plus récente) est re-scanée", async () => {
  ensureCoreEnv();
  const { computeSyncScanBudgets } = await import("../app/services/receiptService");
  const baseOrders: SimOrder[] = [
    { id: 1, dateUpd: "2026-03-01 09:00:00" },
    { id: 2, dateUpd: "2026-03-01 09:05:00" },
  ];
  const run1 = runSimulation({
    state: {
      cursor: 0,
      checkpoint: { dateUpd: "1970-01-01 00:00:00", orderId: 0 },
      imported: new Set<number>(),
    },
    allOrders: baseOrders,
    syncMaxPerRun: 50,
    runUpperBound: "2026-03-01 10:00:00",
    computeBudgets: computeSyncScanBudgets,
  });

  const modifiedOrderList: SimOrder[] = [
    { id: 1, dateUpd: "2026-03-01 11:30:00" },
    { id: 2, dateUpd: "2026-03-01 09:05:00" },
  ];
  const run2 = runSimulation({
    state: run1.nextState,
    allOrders: modifiedOrderList,
    syncMaxPerRun: 50,
    runUpperBound: "2026-03-01 12:00:00",
    computeBudgets: computeSyncScanBudgets,
  });
  assert.equal(run2.processedIds.includes(1), true);
});
