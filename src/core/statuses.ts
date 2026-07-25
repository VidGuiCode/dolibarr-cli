/**
 * Per-resource status vocabulary for status-scoped bulk selection (`--all-draft`
 * and siblings, v0.5.1).
 *
 * Two things vary per resource and both are load-bearing:
 *
 *  - **The status codes are not a uniform 0..n sequence.** Expense reports run
 *    0/2/4/5/6/99, members -2/-1/0/1, knowledge and BOMs 0/1/9.
 *  - **The SQL column differs.** Most resources use `fk_statut`; contracts and
 *    members use `statut`; the newer MRP/knowledge tables use `status`.
 *
 * Selection goes through `sqlfilters` on the column below rather than the list
 * endpoint's `status` query param, because Dolibarr **silently ignores** a
 * numeric `status` value (verified on 20.0.4: `invoices list --status 0|1|2` all
 * return the same rows). A wrong sqlfilters column fails loudly with a 503
 * instead, which is the failure mode we want for a bulk mutation.
 */

/** Status column verified live on Dolibarr 20.0.4 where the module was reachable. */
export interface ResourceStatusSpec {
  /** API list path for resolving the selection, e.g. "invoices". */
  path: string;
  /** SQL column holding the status, used as `t.<column>` in sqlfilters. */
  column: string;
  /** Status name (as used in `--all-<name>`) → Dolibarr status code. */
  statuses: Record<string, number>;
  /** True when the column was confirmed against the live reference instance. */
  verified: boolean;
}

const INVOICE_LIKE = { draft: 0, validated: 1, paid: 2, abandoned: 3 };

/**
 * Keyed by command path prefix — the same string `walkLeaves` produces minus the
 * verb, so `mrp boms validate` looks up "mrp boms".
 */
export const RESOURCE_STATUSES: Record<string, ResourceStatusSpec> = {
  invoices: { path: "invoices", column: "fk_statut", statuses: INVOICE_LIKE, verified: true },
  "supplier-invoices": {
    path: "supplierinvoices",
    column: "fk_statut",
    statuses: INVOICE_LIKE,
    verified: true,
  },
  orders: {
    path: "orders",
    column: "fk_statut",
    statuses: {
      canceled: -1,
      draft: 0,
      validated: 1,
      "shipment-started": 2,
      delivered: 3,
    },
    verified: true,
  },
  proposals: {
    path: "proposals",
    column: "fk_statut",
    statuses: { draft: 0, validated: 1, signed: 2, refused: 3, billed: 4 },
    verified: true,
  },
  projects: {
    path: "projects",
    column: "fk_statut",
    statuses: { draft: 0, validated: 1, closed: 2 },
    verified: true,
  },
  contracts: {
    path: "contracts",
    column: "statut",
    statuses: { draft: 0, validated: 1, closed: 2 },
    verified: true,
  },
  "supplier-orders": {
    path: "supplierorders",
    column: "fk_statut",
    statuses: {
      draft: 0,
      validated: 1,
      approved: 2,
      ordered: 3,
      "partially-received": 4,
      received: 5,
      canceled: 6,
      refused: 9,
    },
    verified: true,
  },
  expensereports: {
    path: "expensereports",
    column: "fk_statut",
    statuses: {
      draft: 0,
      validated: 2,
      cancelled: 4,
      approved: 5,
      paid: 6,
      refused: 99,
    },
    verified: true,
  },
  tickets: {
    path: "tickets",
    column: "fk_statut",
    statuses: {
      unread: 0,
      read: 1,
      assigned: 3,
      "in-progress": 5,
      "need-more-info": 6,
      waiting: 7,
      closed: 8,
      deleted: 9,
    },
    verified: false,
  },
  shipments: {
    path: "shipments",
    column: "fk_statut",
    statuses: { draft: 0, validated: 1, processed: 2, closed: 3 },
    verified: false,
  },
  receptions: {
    path: "receptions",
    column: "fk_statut",
    statuses: { draft: 0, validated: 1, processed: 2, closed: 3 },
    verified: false,
  },
  interventions: {
    path: "interventions",
    column: "fk_statut",
    statuses: { draft: 0, validated: 1, billed: 2, closed: 3 },
    verified: false,
  },
  "supplier-proposals": {
    path: "supplierproposals",
    column: "fk_statut",
    statuses: { draft: 0, validated: 1, signed: 2, "not-signed": 3, closed: 4 },
    verified: false,
  },
  members: {
    path: "members",
    column: "statut",
    statuses: { excluded: -2, resiliated: -1, draft: 0, validated: 1 },
    verified: false,
  },
  knowledge: {
    path: "knowledgemanagement/knowledgerecords",
    column: "status",
    statuses: { draft: 0, validated: 1, obsolete: 9 },
    verified: false,
  },
  "mrp boms": {
    path: "boms",
    column: "status",
    statuses: { draft: 0, validated: 1, cancelled: 9 },
    verified: false,
  },
  "mrp mos": {
    path: "mos",
    column: "status",
    statuses: { draft: 0, validated: 1, "in-progress": 2, produced: 3, cancelled: 9 },
    verified: false,
  },
};

/** Read an item's status code, tolerating the field-name variants Dolibarr returns. */
export function readStatus(item: Record<string, unknown>): string {
  const s = item.status ?? item.fk_statut ?? item.statut;
  return String(s ?? "");
}

/**
 * Look up the status spec for a command path (e.g. "invoices validate" →
 * the `invoices` spec). Tries the two-word prefix first so nested groups like
 * `mrp boms` win over a bare `mrp`.
 */
export function specForPath(commandPath: string): ResourceStatusSpec | undefined {
  const parts = commandPath.split(" ");
  for (let take = Math.min(2, parts.length - 1); take >= 1; take--) {
    const spec = RESOURCE_STATUSES[parts.slice(0, take).join(" ")];
    if (spec) return spec;
  }
  return undefined;
}

/** The `--all-<name>` flag for a status name. */
export function statusFlag(name: string): string {
  return `--all-${name}`;
}

/**
 * Build the sqlfilters expression selecting one status, ANDed with any
 * user-supplied `--filter` so a bulk run can always be scoped.
 */
export function buildStatusFilter(
  spec: ResourceStatusSpec,
  code: number,
  userFilter?: string,
): string {
  const own = `(t.${spec.column}:=:${code})`;
  return userFilter ? `(${userFilter}) and ${own}` : own;
}
