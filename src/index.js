export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      url.pathname = "/index.html";
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }
    // Handle other common routes without .html extension
    const routes = ["/index", "/jobs", "/thanks", "/employers", "/job-detail"];
    if (routes.includes(url.pathname)) {
      url.pathname = `${url.pathname}.html`;
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }
    
    // Check if the file exists with .html if it doesn't have an extension
    if (!url.pathname.includes('.') && url.pathname !== '/') {
      const htmlUrl = new URL(url);
      htmlUrl.pathname = `${url.pathname}.html`;
      const response = await env.ASSETS.fetch(new Request(htmlUrl.toString(), request));
      if (response.status !== 404) {
        return response;
      }
    }
    
    return env.ASSETS.fetch(request);
  },
};

