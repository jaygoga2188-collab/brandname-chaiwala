(() => {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  let currentRoute = `${location.pathname}${location.search}`;
  const scrollToTop = () => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };
  const resetForNewRoute = () => {
    const nextRoute = `${location.pathname}${location.search}`;
    if (nextRoute === currentRoute) return;
    currentRoute = nextRoute;
    requestAnimationFrame(() => requestAnimationFrame(scrollToTop));
  };

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      resetForNewRoute();
      return result;
    };
  }

  addEventListener("popstate", resetForNewRoute);
  addEventListener("pageshow", scrollToTop);
  addEventListener("load", scrollToTop);
})();
