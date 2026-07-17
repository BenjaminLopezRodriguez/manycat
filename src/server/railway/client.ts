import { env } from "@/env";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

/**
 * Workload-plane only. Never create user services in the control-plane project.
 * Service names encode account + workflow for isolation and GC.
 */

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
  const acct = accountId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 24);
  const wf = workflowId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 32);
  return `mc-${acct}-${wf}`.slice(0, 63);
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
  );

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
    await railwayGraphql(
      opts.config.token,
      `mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) { id }
      }`,
      {
        input: {
          serviceId: opts.serviceId,
          environmentId: opts.config.environmentId,
        },
      },
    );
  } catch {
    // Domain may already exist
  }

  const data = await railwayGraphql<{
    domains: Array<{ domain?: string | null; serviceId?: string | null }>;
  }>(
    opts.config.token,
    `query domains($environmentId: String!, $projectId: String!, $serviceId: String) {
      domains(
        environmentId: $environmentId
        projectId: $projectId
        serviceId: $serviceId
      ) {
        domain
        serviceId
      }
    }`,
    {
      environmentId: opts.config.environmentId,
      projectId: opts.config.projectId,
      serviceId: opts.serviceId,
    },
  );

  const domain = data.domains.find((d) => d.domain)?.domain;
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

  const url = await ensureServiceDomain({
    config: opts.config,
    serviceId,
  });

  return { serviceId, url, deploymentId };
}
