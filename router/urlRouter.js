import axios from "axios";

const redirectDomains = [
  "tinyurl.com",
  "bit.ly",
  "t.co",
  "rb.gy",
  "rebrand.ly",
  "is.gd"
];

export async function classifyUrl(rawUrl) {
  let url = rawUrl;

  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname.replace("www.", "");

    if (redirectDomains.includes(host)) {
      url = await expandUrl(url);
    }

    const finalUrlObj = new URL(url);
    const finalHost = finalUrlObj.hostname.replace("www.", "");
    const path = finalUrlObj.pathname.toLowerCase();

    // GitHub
    if (
      finalHost.includes("github.com") ||
      finalHost.includes("gitlab.com") ||
      finalHost.includes("bitbucket.org")
    ) {
      return { route: "project", confidence: 97, url };
    }

    // LinkedIn profile
    if (
      finalHost.includes("linkedin.com") &&
      path.includes("/in/")
    ) {
      return { route: "linkedin_profile", confidence: 95, url };
    }

    // Job boards
    const jobDomains = [
      "greenhouse.io",
      "lever.co",
      "wellfound.com",
      "unstop.com",
      "internshala.com",
      "naukri.com",
      "indeed.com",
      "ashbyhq.com",
      "smartrecruiters.com"
    ];

    if (jobDomains.some(d => finalHost.includes(d))) {
      return { route: "evaluate", confidence: 94, url };
    }

    // LinkedIn jobs
    if (
      finalHost.includes("linkedin.com") &&
      path.includes("/jobs/")
    ) {
      return { route: "evaluate", confidence: 96, url };
    }

    // Portfolio
    if (
      finalHost.includes("vercel.app") ||
      finalHost.includes("netlify.app") ||
      finalHost.includes("github.io")
    ) {
      return { route: "portfolio", confidence: 88, url };
    }

    // YouTube
    if (
      finalHost.includes("youtube.com") ||
      finalHost.includes("youtu.be")
    ) {
      return { route: "youtube", confidence: 92, url };
    }

    // Blogs
    const blogDomains = [
      "medium.com",
      "dev.to",
      "hashnode.dev",
      "notion.site",
      "substack.com"
    ];

    if (blogDomains.some(d => finalHost.includes(d))) {
      return { route: "blog", confidence: 90, url };
    }

    return { route: "generic_url", confidence: 60, url };

  } catch {
    return { route: "invalid", confidence: 0, url: rawUrl };
  }
}

async function expandUrl(url) {
  try {
    const res = await axios.head(url, {
      maxRedirects: 5,
      timeout: 3000
    });

    return res.request?.res?.responseUrl || url;
  } catch {
    // If HEAD fails, try GET but without downloading body
    try {
        const res = await axios.get(url, { maxRedirects: 5, timeout: 3000 });
        return res.request?.res?.responseUrl || url;
    } catch {
        return url;
    }
  }
}
