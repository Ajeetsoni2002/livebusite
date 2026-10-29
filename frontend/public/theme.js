// Apply the theme before CSS paints: a saved choice wins, otherwise light. Storage may be unavailable.
(function () {
  var theme = "light";
  try {
    if (localStorage.getItem("buit-theme") === "dark") theme = "dark";
  } catch (e) {}
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
