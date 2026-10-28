// Apply the theme before CSS paints: a saved choice wins, otherwise follow the OS. Storage may be unavailable.
(function () {
  var theme;
  try {
    var saved = localStorage.getItem("buit-theme");
    if (saved === "light" || saved === "dark") theme = saved;
  } catch (e) {}
  if (!theme)
    theme =
      window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
  var root = document.documentElement;
  root.dataset.theme = theme;
  // The home page opens with the intro (src/intro): keep the prerendered page hidden until it mounts.
  // If the app never starts, show the page anyway.
  if (location.pathname === "/") {
    root.setAttribute("data-pq-boot", "");
    root.style.visibility = "hidden";
    root.style.backgroundColor = "#17211c";
    setTimeout(function () {
      if (!root.hasAttribute("data-pq-boot")) return;
      root.removeAttribute("data-pq-boot");
      root.style.visibility = "";
      root.style.backgroundColor = "";
    }, 8000);
  }
})();
