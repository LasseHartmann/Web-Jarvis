const DEFAULT_OWNER = process.env.GITHUB_DEFAULT_OWNER?.trim() || "LasseHartmann";
const DEFAULT_REPO = process.env.GITHUB_DEFAULT_REPO?.trim() || "Web-Jarvis";

async function githubFetch(
  path: string,
  init?: RequestInit
): Promise<{ status: number; ok: boolean; data: unknown }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return {
      status: 401,
      ok: false,
      data: {
        error:
          "GitHub is not configured yet. Add GITHUB_TOKEN (Personal Access Token) in Vercel Environment Variables.",
      },
    };
  }

  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Web-Jarvis-Assistant",
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

export async function handleGitHubAction(args: {
  action: string;
  owner?: string;
  repo?: string;
  title?: string;
  body?: string;
  confirmed?: boolean;
}): Promise<Record<string, unknown>> {
  const action = (args.action || "list_repos").toLowerCase();
  const owner = args.owner?.trim() || DEFAULT_OWNER;
  const repo = args.repo?.trim() || DEFAULT_REPO;

  switch (action) {
    case "list_repos": {
      const res = await githubFetch("/user/repos?sort=updated&per_page=10");
      if (!res.ok) return { ok: false, error: res.data };
      const repos = (
        (res.data as Array<{
          full_name: string;
          private: boolean;
          open_issues_count: number;
          updated_at: string;
          default_branch: string;
        }>) || []
      ).map((r) => ({
        repo: r.full_name,
        private: r.private,
        openIssues: r.open_issues_count,
        defaultBranch: r.default_branch,
        updatedAt: r.updated_at,
      }));
      return { ok: true, repos };
    }

    case "list_issues": {
      const res = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open&per_page=10`
      );
      if (!res.ok) return { ok: false, error: res.data };
      const items = (
        (res.data as Array<{
          number: number;
          title: string;
          pull_request?: unknown;
          created_at: string;
          user?: { login?: string };
        }>) || []
      )
        .filter((i) => !i.pull_request)
        .map((i) => ({
          number: i.number,
          title: i.title,
          author: i.user?.login,
          createdAt: i.created_at,
        }));
      return { ok: true, repository: `${owner}/${repo}`, openIssues: items };
    }

    case "list_prs": {
      const res = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&per_page=10`
      );
      if (!res.ok) return { ok: false, error: res.data };
      const prs = (
        (res.data as Array<{
          number: number;
          title: string;
          draft: boolean;
          user?: { login?: string };
          updated_at: string;
        }>) || []
      ).map((p) => ({
        number: p.number,
        title: p.title,
        draft: p.draft,
        author: p.user?.login,
        updatedAt: p.updated_at,
      }));
      return { ok: true, repository: `${owner}/${repo}`, openPullRequests: prs };
    }

    case "recent_commits": {
      const res = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=6`
      );
      if (!res.ok) return { ok: false, error: res.data };
      const commits = (
        (res.data as Array<{
          sha: string;
          commit?: { message?: string; author?: { name?: string; date?: string } };
        }>) || []
      ).map((c) => ({
        sha: c.sha.slice(0, 7),
        message: (c.commit?.message || "").split("\n")[0],
        author: c.commit?.author?.name,
        date: c.commit?.author?.date,
      }));
      return { ok: true, repository: `${owner}/${repo}`, commits };
    }

    case "workflow_runs": {
      const res = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?per_page=5`
      );
      if (!res.ok) return { ok: false, error: res.data };
      const runs = (
        (res.data as {
          workflow_runs?: Array<{
            name: string;
            status: string;
            conclusion: string | null;
            head_branch: string;
            created_at: string;
          }>;
        }).workflow_runs || []
      ).map((r) => ({
        name: r.name,
        branch: r.head_branch,
        status: r.status,
        conclusion: r.conclusion,
        createdAt: r.created_at,
      }));
      return { ok: true, repository: `${owner}/${repo}`, workflowRuns: runs };
    }

    case "create_issue": {
      if (!args.title?.trim()) {
        return { ok: false, error: "An issue title is required." };
      }
      if (!args.confirmed) {
        return {
          ok: false,
          confirmationRequired: true,
          preview: {
            repository: `${owner}/${repo}`,
            title: args.title.trim(),
            body: args.body?.trim() || "",
          },
          instruction:
            "Ask the user verbally to confirm creating this GitHub issue, then call github_action create_issue again with confirmed: true.",
        };
      }
      const res = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
        {
          method: "POST",
          body: JSON.stringify({
            title: args.title.trim(),
            body: args.body?.trim() || "",
          }),
        }
      );
      if (!res.ok) return { ok: false, error: res.data };
      const created = res.data as { number?: number; html_url?: string };
      return {
        ok: true,
        repository: `${owner}/${repo}`,
        issueNumber: created.number,
        url: created.html_url,
      };
    }

    default:
      return { ok: false, error: `Unsupported GitHub action: ${action}` };
  }
}
