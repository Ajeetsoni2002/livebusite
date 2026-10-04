// Apply the saved theme before CSS paints; storage may be unavailable in private contexts.
try {
  document.documentElement.dataset.theme =
    localStorage.getItem("buit-theme") === "light" ? "light" : "dark";
} catch {
  document.documentElement.dataset.theme = "dark";
}
