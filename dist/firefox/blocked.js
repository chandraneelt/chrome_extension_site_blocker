// blocked.js
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(location.search);
  const orig = params.get("orig");
  if (orig) {
    const el = document.getElementById("orig");
    const decodedUrl = decodeURIComponent(orig);
    const label = document.createElement("strong");
    label.textContent = "Attempted URL:";
    const link = document.createElement("a");
    link.className = "url";
    link.href = decodedUrl;
    link.textContent = decodedUrl;
    link.target = "_self";

    el.replaceChildren(label, document.createElement("br"), link);
  }
  document.getElementById("goBack").addEventListener("click", () => {
    history.back();
  });
});
