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
  document.documentElement.dataset.theme = theme;
})();
