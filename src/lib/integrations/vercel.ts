function teamQuery(prefix = "?"): string {
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  return teamId ? `${prefix}teamId=${encodeURIComponent(teamId)}` : "";
}

async function vercelFetch(
  path: string,
  init?: RequestInit
): Promise<{ status: number; ok: boolean; data: unknown }> {
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    return {
      status: 401,
      ok: false,
      data: {
        error:
          "Vercel API is not configured yet. Add VERCEL_TOKEN (from vercel.com/account/tokens) in Vercel Environment Variables.",
      },
    };
  }

  const res = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

export async function handleVercelAction(args: {
  action: string;
  project?: string;
  confirmed?: boolean;
}): Promise<Record<string, unknown>> {
  const action = (args.action || "deployment_status").toLowerCase();
  const project =
    args.project?.trim() || process.env.VERCEL_DEFAULT_PROJECT?.trim() || "web-jarvis";

  switch (action) {
    case "list_projects": {
      const res = await vercelFetch(`/v9/projects?limit=12${teamQuery("&")}`);
      if (!res.ok) return { ok: false, error: res.data };
      const projects = (
        (res.data as {
          projects?: Array<{
            id: string;
            name: string;
            framework?: string;
            updatedAt?: number;
          }>;
        }).projects || []
      ).map((p) => ({
        id: p.id,
        name: p.name,
        framework: p.framework,
        updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
      }));
      return { ok: true, projects };
    }

    case "list_deployments":
    case "deployment_status": {
      const limit = action === "deployment_status" ? 2 : 6;
      const res = await vercelFetch(
        `/v6/deployments?limit=${limit}&app=${encodeURIComponent(project)}${teamQuery("&")}`
      );
      if (!res.ok) return { ok: false, error: res.data };
      const deps = (
        (res.data as {
          deployments?: Array<{
            uid: string;
            name: string;
            url: string;
            state?: string;
            readyState?: string;
            target?: string;
            created?: number;
            meta?: { githubCommitMessage?: string };
          }>;
        }).deployments || []
      ).map((d) => ({
        id: d.uid,
        name: d.name,
        url: d.url ? `https://${d.url}` : null,
        state: d.readyState || d.state,
        target: d.target || "preview",
        commitMessage: d.meta?.githubCommitMessage,
        createdAt: d.created ? new Date(d.created).toISOString() : null,
      }));
      return { ok: true, project, deployments: deps };
    }

    case "redeploy_latest": {
      if (!args.confirmed) {
        return {
          ok: false,
          confirmationRequired: true,
          preview: { project },
          instruction:
            "Ask the user verbally to confirm triggering a fresh Vercel production redeployment, then call vercel_action redeploy_latest again with confirmed: true.",
        };
      }

      const listRes = await vercelFetch(
        `/v6/deployments?limit=1&app=${encodeURIComponent(project)}${teamQuery("&")}`
      );
      if (!listRes.ok) return { ok: false, error: listRes.data };
      const latest = (
        listRes.data as {
          deployments?: Array<{ uid: string; name: string }>;
        }
      ).deployments?.[0];

      if (!latest) {
        return { ok: false, error: `No previous deployment found for "${project}".` };
      }

      const redeployRes = await vercelFetch(
        `/v13/deployments?forceNew=1${teamQuery("&")}`,
        {
          method: "POST",
          body: JSON.stringify({
            name: latest.name,
            deploymentId: latest.uid,
            target: "production",
          }),
        }
      );

      if (!redeployRes.ok) return { ok: false, error: redeployRes.data };
      const created = redeployRes.data as { id?: string; url?: string; readyState?: string };
      return {
        ok: true,
        project: latest.name,
        deploymentId: created.id,
        url: created.url ? `https://${created.url}` : null,
        state: created.readyState || "QUEUED",
      };
    }

    default:
      return { ok: false, error: `Unsupported Vercel action: ${action}` };
  }
}
