import { createHash } from "node:crypto";
import { env } from "@/env";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

/** Railway rejects service names longer than this (DNS-style labels). */
const RAILWAY_SERVICE_NAME_MAX = 32;

/**
 * Workload-plane only. Never create user services in the control-plane project.
 * Service names encode a short account/workflow slug + hash for uniqueness;
 * full IDs live in MANYCAT_* env tags for isolation and GC.
 */

function railwaySlug(s: string, max: number) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export type RailwayConfig = {
  token: string;
  projectId: string;
  environmentId: string;
};

export function getWorkloadRailwayConfig(): RailwayConfig | null {
  if (
    !env.RAILWAY_API_TOKEN ||
    !env.RAILWAY_WORKLOAD_PROJECT_ID ||
    !env.RAILWAY_WORKLOAD_ENVIRONMENT_ID
  ) {
    return null;
  }
  return {
    token: env.RAILWAY_API_TOKEN,
    projectId: env.RAILWAY_WORKLOAD_PROJECT_ID,
    environmentId: env.RAILWAY_WORKLOAD_ENVIRONMENT_ID,
  };
}

export function railwayServiceName(accountId: string, workflowId: string) {
  // Emails / long ids used to produce >32-char names ending in "-" (invalid).
  const hash = createHash("sha256")
    .update(`${accountId}\0${workflowId}`)
    .digest("hex")
    .slice(0, 8);
  const acct = railwaySlug(accountId, 8) || "acct";
  const wf = railwaySlug(workflowId, 8) || "wf";
  // mc-(3) + acct(≤8) + - + wf(≤8) + - + hash(8) ≤ 29
  const name = `mc-${acct}-${wf}-${hash}`;
  return name.slice(0, RAILWAY_SERVICE_NAME_MAX).replace(/-+$/g, "");
}

/**
 * Refuse control-plane or admin Neon URLs as workload DATABASE_URL.
 */
export function assertWorkloadDatabaseUrl(url: string) {
  if (!url) throw new Error("workload DATABASE_URL required");
  if (url === env.DATABASE_URL) {
    throw new Error("Refusing to inject control DATABASE_URL into Railway");
  }
  if (env.NEON_SHARED_DATABASE_URL && url === env.NEON_SHARED_DATABASE_URL) {
    throw new Error("Refusing to inject admin shared Neon URL into Railway");
  }
}

function buildWorkloadVariables(opts: {
  accountId: string;
  workflowId: string;
  workloadEnv?: Record<string, string>;
}): Record<string, string> {
  if (opts.workloadEnv?.DATABASE_URL) {
    assertWorkloadDatabaseUrl(opts.workloadEnv.DATABASE_URL);
  }
  return {
    PORT: "3000",
    NIXPACKS_NODE_VERSION: "22",
    MANYCAT_ACCOUNT_ID: opts.accountId,
    MANYCAT_WORKFLOW_ID: opts.workflowId,
    MANYCAT_PLANE: "workload",
    ...opts.workloadEnv,
  };
}

type GraphQLResult<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

async function railwayGraphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = (await res.json()) as GraphQLResult<T>;
  if (!res.ok || body.errors?.length) {
    const msg =
      body.errors?.map((e) => e.message).join("; ") ??
      `Railway API HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!body.data) throw new Error("Railway API returned no data");
  return body.data;
}

/**
 * Upsert service env vars without triggering an extra deploy
 * (caller deploys via serviceInstanceDeployV2).
 * Uses Railway `variableCollectionUpsert` (merge; not replace).
 */
export async function upsertServiceVariables(opts: {
  config: RailwayConfig;
  serviceId: string;
  variables: Record<string, string>;
}): Promise<void> {
  await railwayGraphql(
    opts.config.token,
    `mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId: opts.config.projectId,
        environmentId: opts.config.environmentId,
        serviceId: opts.serviceId,
        variables: opts.variables,
        skipDeploys: true,
      },
    },
  );
}

/**
 * Create a minimal-resource service from a GitHub repo in the WORKLOAD project.
 * Injects Manycat scope tags + PORT + optional workloadEnv (never control secrets).
 */
export async function createWorkloadService(opts: {
  config: RailwayConfig;
  accountId: string;
  workflowId: string;
  githubRepo: string; // owner/repo
  branch?: string;
  /** Must include DATABASE_URL when Neon has been provisioned */
  workloadEnv?: Record<string, string>;
}): Promise<{ serviceId: string; name: string }> {
  const name = railwayServiceName(opts.accountId, opts.workflowId);
  const variables = buildWorkloadVariables({
    accountId: opts.accountId,
    workflowId: opts.workflowId,
    workloadEnv: opts.workloadEnv,
  });
  const data = await railwayGraphql<{
    serviceCreate: { id: string; name: string };
  }>(
    opts.config.token,
    `mutation serviceCreate($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name }
    }`,
    {
      input: {
        projectId: opts.config.projectId,
        name,
        source: { repo: opts.githubRepo },
        ...(opts.branch ? { branch: opts.branch } : {}),
        variables,
      },
    },
  ).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found or is not accessible|no github installation/i.test(msg)) {
      throw new Error(
        `${msg} — Install the Railway GitHub App on org "${opts.githubRepo.split("/")[0]}" with access to All repositories (new mirrors are created dynamically). GitHub → Organization settings → GitHub Apps → Railway.`,
      );
    }
    throw err;
  });

  const serviceId = data.serviceCreate.id;

  // Minimal footprint: single replica, no fancy restart thrash.
  try {
    await railwayGraphql(
      opts.config.token,
      `mutation serviceInstanceUpdate(
        $serviceId: String!
        $environmentId: String!
        $input: ServiceInstanceUpdateInput!
      ) {
        serviceInstanceUpdate(
          serviceId: $serviceId
          environmentId: $environmentId
          input: $input
        )
      }`,
      {
        serviceId,
        environmentId: opts.config.environmentId,
        input: {
          numReplicas: 1,
          restartPolicyType: "ON_FAILURE",
          restartPolicyMaxRetries: 3,
        },
      },
    );
  } catch {
    // Resource fields vary by Railway API version — create still succeeds.
  }

  return { serviceId, name: data.serviceCreate.name };
}

export async function deployWorkloadService(opts: {
  config: RailwayConfig;
  serviceId: string;
}): Promise<string> {
  const data = await railwayGraphql<{ serviceInstanceDeployV2: string }>(
    opts.config.token,
    `mutation serviceInstanceDeployV2($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    {
      serviceId: opts.serviceId,
      environmentId: opts.config.environmentId,
    },
  );
  return data.serviceInstanceDeployV2;
}

export async function ensureServiceDomain(opts: {
  config: RailwayConfig;
  serviceId: string;
}): Promise<string | undefined> {
  try {
    const created = await railwayGraphql<{
      serviceDomainCreate: { domain?: string | null };
    }>(
      opts.config.token,
      `mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) { id domain }
      }`,
      {
        input: {
          serviceId: opts.serviceId,
          environmentId: opts.config.environmentId,
        },
      },
    );
    const createdDomain = created.serviceDomainCreate.domain;
    if (createdDomain) {
      return createdDomain.startsWith("http")
        ? createdDomain
        : `https://${createdDomain}`;
    }
  } catch {
    // Domain may already exist — fall through to list.
  }

  // `domains` returns AllDomains { serviceDomains, customDomains }, not a flat list.
  const data = await railwayGraphql<{
    domains: {
      serviceDomains: Array<{ domain: string }>;
      customDomains: Array<{ domain: string }>;
    };
  }>(
    opts.config.token,
    `query domains($environmentId: String!, $projectId: String!, $serviceId: String!) {
      domains(
        environmentId: $environmentId
        projectId: $projectId
        serviceId: $serviceId
      ) {
        serviceDomains { domain }
        customDomains { domain }
      }
    }`,
    {
      environmentId: opts.config.environmentId,
      projectId: opts.config.projectId,
      serviceId: opts.serviceId,
    },
  );

  const domain =
    data.domains.serviceDomains[0]?.domain ??
    data.domains.customDomains[0]?.domain;
  if (!domain) return undefined;
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

/**
 * Full path: create-or-reuse service → deploy → public domain.
 * Caller must persist serviceId on the project row.
 */
export async function deployProjectToRailway(opts: {
  config: RailwayConfig;
  accountId: string;
  workflowId: string;
  githubRepo: string;
  existingServiceId?: string | null;
  /** Must include DATABASE_URL when Neon has been provisioned */
  workloadEnv?: Record<string, string>;
}): Promise<{ serviceId: string; url?: string; deploymentId: string }> {
  let serviceId = opts.existingServiceId ?? undefined;

  if (!serviceId) {
    const created = await createWorkloadService({
      config: opts.config,
      accountId: opts.accountId,
      workflowId: opts.workflowId,
      githubRepo: opts.githubRepo,
      workloadEnv: opts.workloadEnv,
    });
    serviceId = created.serviceId;
  } else {
    const variables = buildWorkloadVariables({
      accountId: opts.accountId,
      workflowId: opts.workflowId,
      workloadEnv: opts.workloadEnv,
    });
    await upsertServiceVariables({
      config: opts.config,
      serviceId,
      variables,
    });
  }

  const deploymentId = await deployWorkloadService({
    config: opts.config,
    serviceId,
  });

  let url: string | undefined;
  try {
    url = await ensureServiceDomain({
      config: opts.config,
      serviceId,
    });
  } catch {
    // Deploy succeeded; domain attach is best-effort (user can still open via Railway dashboard).
  }

  return { serviceId, url, deploymentId };
}
